// The Forge — crafting minigame modal (M3). A full-screen overlay that plays the
// two-phase heat economy from engine/crafting/forge.ts and, on completion, writes the
// earned quality tier by calling craft(recipeKey, score01).
//
// UI discipline follows ArmoryBreak.tsx: a single rAF loop reads REFS (never React state)
// each frame, calls the pure reducer, and writes heat/needle/zone/progress straight to DOM
// element styles (MineRunOverlay charge-bar pattern) — React state only flips at phase
// transitions. Hammer releases use the projectReleasePower idea (armoryBreak.ts): one
// sub-frame stepForge from the last frame to the true pointer-up instant so strike accuracy
// isn't quantized to frame boundaries.

import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { useGameStore } from '@/store/useGameStore';
import {
  getRecipe,
  scoreToTier,
  reforgeCost,
  reforgeAnchorOf,
  asCraftTier,
  CRAFT_TIERS,
  FINE,
  MASTERWORK,
  type CraftTier,
} from '@/engine/crafting';
import {
  initForge,
  stepForge,
  commitStoke,
  forgeScore,
  heatBandWidth,
  strikeSweetHalf,
  strikePower,
  effectiveStrikeHalf,
  boostMods,
  HEAT_BAND_START,
  type ForgeRunState,
  type ForgeMods,
  type ForgeBoosts,
} from '@/engine/crafting/forge';
import { shakeOffset } from '@/engine/crawl';
import { townPerks } from '@/engine/town';
import { getGear } from '@/engine/gear';
import { getWeapon } from '@/engine/weapons';
import { getMaterial } from '@/engine/materials';
import { gearCrest, weaponCrest, type CrestLook } from '@/lib/sprites';
import * as sfx from '@/lib/sfx';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Sprite } from '@/components/ui/Sprite';
import { SceneArt } from '@/components/ui/SceneArt';

interface ForgeMinigameProps {
  recipeKey: string;
  /** Unused in M3 — 'reforge' is wired in M5. Stored so the signature is stable. */
  mode?: 'craft' | 'reforge';
  onClose: () => void;
}

interface ForgeResult {
  score01: number;
  tier: CraftTier;
  heat01: number;
  strikes: number;
}

/** Per-tier flavour so a Crude reads as an honest outcome, not a bug (§7 M6 accessibility). */
const TIER_FLAVOUR: Record<CraftTier, string> = {
  0: 'The tempering went poorly — a rough but serviceable piece.',
  1: 'A sound, honest piece — struck true to spec.',
  2: 'Clean lines and a keen temper — fine work.',
  3: 'Flawless balance and a mirror finish — a masterwork.',
};

/** Sprite key + crest for a recipe's gear/weapon result. */
function resultArt(kind: string, key: string): { spriteKey: string; look: CrestLook; name: string } {
  if (kind === 'weapon') {
    const w = getWeapon(key);
    return { spriteKey: `weapon:${key}`, look: weaponCrest(w.name, w.attackStat), name: w.name };
  }
  const g = getGear(key);
  return { spriteKey: `gear:${key}`, look: gearCrest(g?.name ?? key, g?.slot), name: g?.name ?? key };
}

/** One Fuel & Flux slot (§6): toggle button, disabled + dimmed when the player can't pay. */
function BoostSlot({
  label,
  desc,
  count,
  need,
  selected,
  onToggle,
}: {
  label: string;
  desc: string;
  count: number;
  need: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const affordable = count >= need;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!affordable}
      aria-pressed={selected}
      className={
        'flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left ' +
        (selected
          ? 'border-gold-bright bg-gold-bright/20'
          : 'border-gold-deep/30 bg-parchment-100/60') +
        (affordable ? '' : ' cursor-not-allowed opacity-40')
      }
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink">{label}</div>
        <div className="text-[11px] text-ink-muted">{desc}</div>
      </div>
      <span className={'shrink-0 text-[11px] ' + (affordable ? 'text-ink-muted' : 'text-ember')}>
        have {count}/{need}
      </span>
    </button>
  );
}

/**
 * Reduced-motion accommodations, layered on top of any Fuel & Flux boosts (composed
 * by multiplication, never replaced): sweet zones ×1.5 wider and heat decay ×0.5
 * slower. The sim dt is also scaled ×1/1.5 at the loop (slower needle); the decay
 * mult is an ADDITIONAL 50% slowdown of the passive drain so a low-dexterity player
 * gets a genuinely longer runway. §7 M6 accessibility.
 */
function runMods(boosts: ForgeBoosts, reducedMotion: boolean): ForgeMods {
  const m = boostMods(boosts);
  if (reducedMotion) {
    m.zoneMult *= 1.5;
    m.decayMult *= 0.5;
  }
  return m;
}

export function ForgeMinigame({ recipeKey, mode = 'craft', onClose }: ForgeMinigameProps) {
  const recipe = getRecipe(recipeKey);
  const craft = useGameStore((s) => s.craft);
  const reforge = useGameStore((s) => s.reforge);
  const materials = useGameStore((s) => s.materials);
  const gearQuality = useGameStore((s) => s.gearQuality);
  const weaponQuality = useGameStore((s) => s.weaponQuality);
  const soundEnabled = useGameStore((s) => s.settings.soundEnabled);

  // Sync the shared synth mute with the store setting (sibling-overlay idiom).
  useEffect(() => {
    sfx.setMuted(!soundEnabled);
  }, [soundEnabled]);

  // Snapshot the combat stat levels once at mount (§4: chips + true zone widths).
  const dxRef = useRef(useGameStore.getState().character.statLevels?.DX ?? 0);
  const stRef = useRef(useGameStore.getState().character.statLevels?.ST ?? 0);
  // Homestead Smithy (forge_focus perk): +0.03 sweet-zone half-width, snapshotted once at
  // mount and threaded (additively) into stepForge / effectiveStrikeHalf alongside dx/st.
  const forgeSweetRef = useRef(townPerks(useGameStore.getState().town).forgeSweetBonus);

  // Reduced motion: scale the WHOLE sim dt by 1/1.5 (slower needle + decay) and widen both
  // sweet zones ×1.5 via mods.zoneMult. Baking zoneMult into initForge widens the Phase A
  // band too (commitStoke reads the seeded zoneMult). First gameplay-affecting a11y accom.
  const reducedMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ).current;

  // Fuel & Flux selection (§6). One fuel + one flux max. The pre-run panel gates the sim start.
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false);
  const [fuel, setFuel] = useState<'wood' | 'stone' | null>(null);
  const [flux, setFlux] = useState(false);
  const boosts: ForgeBoosts = fuel ? { fuel, flux } : { flux };
  // Final mods = selected boosts, then the reduced-motion widening. Set at start into the ref.
  const modsRef = useRef<ForgeMods>(runMods({ flux: false }, reducedMotion));

  const [phase, setPhase] = useState<'stoke' | 'strike' | 'done'>('stoke');
  const [result, setResult] = useState<ForgeResult | null>(null);

  // Live run state + inputs live in refs so the rAF loop and pointer/key callbacks never
  // read stale React state.
  const stateRef = useRef<ForgeRunState>(initForge(dxRef.current, stRef.current, modsRef.current));
  const hammerRef = useRef(false);
  const bellowsRef = useRef(false);
  const lastFrameRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // DOM targets updated imperatively each frame.
  const heatBarFillRef = useRef<HTMLDivElement>(null); // Phase A fill
  const heatFillRef = useRef<HTMLDivElement>(null); // Phase B heat gauge
  const heatCeilRef = useRef<HTMLDivElement>(null); // Phase B fatigue ceiling
  const needleRef = useRef<HTMLDivElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const strikeBadgeRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLDivElement>(null); // shake target (whole play area)
  const strikeBarRef = useRef<HTMLDivElement>(null); // hit-flash target on strike

  // Camera-shake state for strikes (shakeOffset, crawl.ts). Heavy strikes shake harder;
  // stays {mag:0} under reduced motion so shakeOffset returns a zero offset every frame.
  const shakeRef = useRef({ mag: 0, t0: 0, dur: 0 });
  // Latch so a double-clicked Continue can't call craft/reforge twice before unmount.
  const continueConsumedRef = useRef(false);
  const triggerShake = useCallback(
    (mag: number) => {
      if (reducedMotion) return;
      shakeRef.current = { mag, t0: performance.now(), dur: 260 };
    },
    [reducedMotion],
  );

  const writeDom = useCallback((s: ForgeRunState) => {
    if (heatBarFillRef.current) heatBarFillRef.current.style.height = `${s.heatBar * 100}%`;
    if (heatFillRef.current) heatFillRef.current.style.height = `${Math.max(0, s.heat) * 100}%`;
    if (heatCeilRef.current) heatCeilRef.current.style.bottom = `${s.heatMax * 100}%`;
    if (needleRef.current) needleRef.current.style.left = `${s.needlePos * 100}%`;
    if (zoneRef.current) {
      // Render the sweet-zone at its TRUE size (DX/flux widening, a11y floor, in-charge
      // shrink) via the same engine helper stepForge scores with — no twin drift.
      const halfW = effectiveStrikeHalf(dxRef.current, modsRef.current.zoneMult, s.chargeT, forgeSweetRef.current);
      const left = Math.max(0, s.zoneCentre - halfW);
      const right = Math.min(1, s.zoneCentre + halfW);
      zoneRef.current.style.left = `${left * 100}%`;
      zoneRef.current.style.width = `${Math.max(0, right - left) * 100}%`;
    }
    if (progressFillRef.current) progressFillRef.current.style.width = `${Math.min(1, s.progress) * 100}%`;
    if (strikeBadgeRef.current) strikeBadgeRef.current.textContent = String(s.strikes.length);
  }, []);

  const finishRun = useCallback((s: ForgeRunState) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (contentRef.current) contentRef.current.style.transform = ''; // clear any residual shake
    const score = forgeScore(s);
    setResult({ score01: score, tier: scoreToTier(score), heat01: s.heat01, strikes: s.strikes.length });
    setPhase('done');
    sfx.play('forgeComplete');
  }, []);

  // Single rAF loop for the whole run — stoke fill + strike sim. Stops at 'done'.
  // Gated on `started` so the Fuel & Flux panel can be reviewed before the fire is lit.
  useEffect(() => {
    if (!started) return;
    const loop = (ts: number) => {
      const s = stateRef.current;
      if (s.phase === 'done') return;
      const last = lastFrameRef.current;
      lastFrameRef.current = ts;
      const dt = last == null ? 0 : (ts - last) / 1000;
      const eff = reducedMotion ? dt / 1.5 : dt;
      const next = stepForge(
        s,
        { hammerHeld: hammerRef.current, bellowsHeld: bellowsRef.current },
        eff,
        dxRef.current,
        stRef.current,
        modsRef.current,
        forgeSweetRef.current,
      );
      stateRef.current = next;
      writeDom(next);
      // Decaying strike shake — zero offset under reduced motion (mag stays 0).
      if (contentRef.current) {
        const sh = shakeRef.current;
        const { sx, sy } = shakeOffset(sh.mag, ts - sh.t0, sh.dur, Math.random(), Math.random());
        contentRef.current.style.transform = sx || sy ? `translate3d(${sx}px,${sy}px,0)` : '';
      }
      if (next.phase === 'done') {
        finishRun(next);
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [started, reducedMotion, writeDom, finishRun]);

  // Light the fire: bake the chosen boosts (+ reduced motion) into mods, seed the run, go.
  const startForge = useCallback(() => {
    modsRef.current = runMods(boosts, reducedMotion);
    stateRef.current = initForge(dxRef.current, stRef.current, modsRef.current);
    lastFrameRef.current = null;
    startedRef.current = true;
    setStarted(true);
  }, [boosts, reducedMotion]);

  // ── Phase A (stoke): hold to fill, release to commit ───────────────────────────
  const onStokePress = useCallback(() => {
    if (stateRef.current.phase !== 'stoke') return;
    hammerRef.current = true;
    sfx.play('forgeStoke');
  }, []);

  const commit = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'stoke') return;
    hammerRef.current = false;
    bellowsRef.current = false;
    stateRef.current = commitStoke(s, dxRef.current);
    setPhase('strike');
  }, []);

  // ── Phase B (strike): hammer tap/hold, bellows re-stoke ────────────────────────
  const onHammerPress = useCallback(() => {
    if (stateRef.current.phase !== 'strike') return;
    hammerRef.current = true;
  }, []);

  const onHammerRelease = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'strike' || !hammerRef.current) return;
    hammerRef.current = false;
    // Sub-frame projection: advance the needle from the last frame to the true release
    // instant, then let stepForge resolve the strike there (armoryBreak.ts:33 pattern).
    const releaseTs = performance.now();
    const dt = lastFrameRef.current == null ? 0 : Math.max(0, (releaseTs - lastFrameRef.current) / 1000);
    const eff = reducedMotion ? dt / 1.5 : dt;
    const next = stepForge(
      s,
      { hammerHeld: false, bellowsHeld: bellowsRef.current },
      eff,
      dxRef.current,
      stRef.current,
      modsRef.current,
      forgeSweetRef.current,
    );
    lastFrameRef.current = releaseTs; // so the next rAF frame doesn't double-count this dt
    stateRef.current = next;
    writeDom(next);
    // A strike fired this release → audio + shake + hit-flash keyed to accuracy/weight.
    if (next.strikes.length > s.strikes.length) {
      const { acc, weight } = next.strikes[next.strikes.length - 1];
      sfx.play(acc > 0.5 ? 'forgeStrikeGood' : 'forgeStrikeMiss');
      triggerShake(weight > 1 ? 8 : 4); // heavy strikes shake harder
      const bar = strikeBarRef.current;
      if (bar) {
        bar.classList.add('crawler-hit-flash');
        setTimeout(() => bar.classList.remove('crawler-hit-flash'), 220);
      }
    }
    if (next.phase === 'done') finishRun(next);
  }, [reducedMotion, writeDom, finishRun, triggerShake]);

  const onBellowsPress = useCallback(() => {
    if (stateRef.current.phase !== 'strike') return;
    bellowsRef.current = true;
    sfx.play('forgeStoke');
  }, []);

  const onBellowsRelease = useCallback(() => {
    bellowsRef.current = false;
  }, []);

  // Keyboard: Space = stoke-hold / hammer; Shift or B = bellows. Registers once (stable deps).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || !startedRef.current) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (stateRef.current.phase === 'stoke') onStokePress();
        else onHammerPress();
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyB') {
        e.preventDefault();
        onBellowsPress();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (!startedRef.current) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (stateRef.current.phase === 'stoke') commit();
        else onHammerRelease();
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyB') {
        e.preventDefault();
        onBellowsRelease();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [onStokePress, commit, onHammerPress, onHammerRelease, onBellowsPress, onBellowsRelease]);

  if (!recipe) return null;

  const dx = dxRef.current;
  const st = stRef.current;
  // Include the Smithy forge_focus bonus so the pre-run zone chip matches the live sweet zone
  // (effectiveStrikeHalf threads forgeSweetRef too); denominator stays the un-perked DX-0 base.
  const zonePct = Math.round((strikeSweetHalf(dx, forgeSweetRef.current) / strikeSweetHalf(0) - 1) * 100);
  const powerPct = Math.round((strikePower(st) / strikePower(0) - 1) * 100);
  const art = resultArt(recipe.result.kind, recipe.result.key);
  // Phase A band drawn at its true DX/flux-scaled size (matches commitStoke's scoring band).
  const bandWidth = heatBandWidth(dx) * modsRef.current.zoneMult;

  // Re-forge (§5): honest cost copy + current→target tier. Anchor material shown by name.
  const isReforge = mode === 'reforge';
  const anchorKey = reforgeAnchorOf(recipe);
  const anchorName = getMaterial(anchorKey)?.name ?? anchorKey;
  const rfCost = reforgeCost(recipe);
  const storedTier =
    recipe.result.kind === 'weapon'
      ? weaponQuality[recipe.result.key]
      : gearQuality[recipe.result.key];
  const currentTier = asCraftTier(storedTier);

  // Fuel & Flux slot affordability (§6): disable a slot the player can't pay for.
  const woodHave = materials['wood'] ?? 0;
  const stoneHave = materials['stone'] ?? 0;
  const gemHave = materials['gemstone'] ?? 0;

  const handleContinue = () => {
    if (result && !continueConsumedRef.current) {
      continueConsumedRef.current = true;
      if (isReforge) reforge(recipeKey, result.score01, boosts);
      else craft(recipeKey, result.score01, boosts);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-wood-900/95 backdrop-blur-sm overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gold-deep/30 px-4 py-3 texture-wood">
        <div>
          <div className="font-display text-sm font-bold text-parchment-100">
            {isReforge ? `Re-forge ${recipe.name}` : recipe.name}
          </div>
          {isReforge ? (
            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-parchment-300">
              <span>
                {rfCost}g + 1 {anchorName} — {CRAFT_TIERS[currentTier].name} →{' '}
                {currentTier + 1 <= MASTERWORK
                  ? CRAFT_TIERS[asCraftTier(currentTier + 1)].name +
                    (currentTier + 2 <= MASTERWORK
                      ? '/' + CRAFT_TIERS[asCraftTier(currentTier + 2)].name
                      : '') +
                    (currentTier + 3 <= MASTERWORK ? '/' + CRAFT_TIERS[MASTERWORK].name : '')
                  : CRAFT_TIERS[MASTERWORK].name}
                . Quality can only improve.
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-parchment-300">
              <span>Cost:</span>
              {Object.entries(recipe.materials).map(([matKey, qty]) => (
                <span key={matKey}>
                  {qty}× {getMaterial(matKey)?.name ?? matKey}
                </span>
              ))}
              {recipe.gold ? <span>· {recipe.gold} 🪙</span> : null}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-parchment-300 hover:text-parchment-100"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div ref={contentRef} className="w-full max-w-sm space-y-4">
          {/* Anvil scene banner (art seam — swaps to a real PNG via resolveSceneImage). */}
          <SceneArt sceneKey="forge:anvil" size="sm" />

          {/* Stat chips — real numbers from the engine helpers (§4). */}
          <div className="flex flex-wrap justify-center gap-2">
            <span className="rounded-full border border-gold-deep/40 bg-parchment-100/70 px-2.5 py-1 text-[11px] font-display text-ink">
              DX {dx} → +{zonePct}% wider zones
            </span>
            <span className="rounded-full border border-gold-deep/40 bg-parchment-100/70 px-2.5 py-1 text-[11px] font-display text-ink">
              ST {st} → +{powerPct}% strike power
            </span>
          </div>

          {!started && (
            <Panel tone="parchment" className="p-5">
              <div className="mb-3 text-center">
                <div className="font-display text-sm font-bold text-ink">Fuel &amp; Flux</div>
                <p className="text-[11px] text-ink-muted">
                  Optional — spend spare materials to make the forge more forgiving. Consumed only
                  if you finish the piece.
                </p>
              </div>
              <div className="space-y-2">
                {/* One fuel max (mutually exclusive), one flux max. */}
                <BoostSlot
                  label="Seasoned Wood"
                  desc="2× Wood → slower heat decay"
                  count={woodHave}
                  need={2}
                  selected={fuel === 'wood'}
                  onToggle={() => setFuel((f) => (f === 'wood' ? null : 'wood'))}
                />
                <BoostSlot
                  label="Firebrick"
                  desc="2× Stone → less re-stoke fatigue"
                  count={stoneHave}
                  need={2}
                  selected={fuel === 'stone'}
                  onToggle={() => setFuel((f) => (f === 'stone' ? null : 'stone'))}
                />
                <BoostSlot
                  label="Gemstone Flux"
                  desc="1× Gemstone → both zones ×1.25 wider"
                  count={gemHave}
                  need={1}
                  selected={flux}
                  onToggle={() => setFlux((v) => !v)}
                />
              </div>
              <Button onClick={startForge} className="mt-4 w-full py-3">
                {fuel || flux ? 'Continue' : 'Just forge'}
              </Button>
            </Panel>
          )}

          {started && phase === 'stoke' && (
            <Panel tone="parchment" className="p-5">
              <p className="mb-3 text-center text-sm text-ink">
                <strong className="text-ink">Hold</strong> to stoke — <strong className="text-ink">release</strong> to lock heat.
              </p>
              <div className="flex justify-center">
                {/* Vertical heat bar; hold anywhere on it to stoke. */}
                <div
                  className="relative h-64 w-16 cursor-pointer touch-none select-none overflow-hidden rounded-md border border-gold-deep/50 bg-parchment-300/50"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    onStokePress();
                  }}
                  onPointerUp={commit}
                  onPointerCancel={commit}
                >
                  {/* DX-scaled sweet band at its true position/size */}
                  <div
                    className="absolute w-full border-y border-gold-bright/60 bg-gold-bright/30"
                    style={{ bottom: `${HEAT_BAND_START * 100}%`, height: `${bandWidth * 100}%` }}
                  />
                  {/* Fill (imperative height) */}
                  <div
                    ref={heatBarFillRef}
                    className="absolute bottom-0 w-full bg-ember/60"
                    style={{ height: '0%' }}
                  />
                </div>
              </div>
            </Panel>
          )}

          {phase === 'strike' && (
            <Panel tone="parchment" className="p-5">
              <div className="flex gap-4">
                {/* Heat gauge with fatigue-ceiling marker */}
                <div className="flex flex-col items-center gap-1">
                  <div className="font-display text-[10px] text-ink-muted">Heat</div>
                  <div className="relative h-48 w-8 overflow-hidden rounded-md border border-gold-deep/50 bg-parchment-300/50">
                    <div ref={heatFillRef} className="absolute bottom-0 w-full bg-ember/70" style={{ height: '0%' }} />
                    {/* Fatigue ceiling — drops after re-stokes */}
                    <div
                      ref={heatCeilRef}
                      className="absolute left-0 h-0.5 w-full bg-ink/70"
                      style={{ bottom: '100%' }}
                    />
                  </div>
                </div>

                <div className="flex-1 space-y-3">
                  {/* Needle bar + moving sweet-zone (shrinks while charging) */}
                  <div>
                    <div className="mb-1 font-display text-[10px] text-ink-muted">Strike timing</div>
                    <div
                      ref={strikeBarRef}
                      className="relative h-8 overflow-hidden rounded-md border border-gold-deep/50 bg-parchment-300/50"
                    >
                      <div
                        ref={zoneRef}
                        className="absolute top-0 h-full bg-gold-bright/40 border-x border-gold-bright/70"
                        style={{ left: '50%', width: '20%' }}
                      />
                      <div ref={needleRef} className="absolute top-0 h-full w-0.5 bg-ink" style={{ left: '0%' }} />
                    </div>
                  </div>

                  {/* Forge progress + strike badge */}
                  <div>
                    <div className="mb-1 flex items-center justify-between font-display text-[10px] text-ink-muted">
                      <span>Forge progress</span>
                      <span>
                        <span ref={strikeBadgeRef}>0</span> strikes
                      </span>
                    </div>
                    <div className="relative h-3 overflow-hidden rounded-full border border-gold-deep/40 bg-parchment-300/50">
                      <div ref={progressFillRef} className="absolute left-0 top-0 h-full bg-emerald-500/70" style={{ width: '0%' }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  className="select-none touch-none rounded-md border-2 border-gold-deep bg-gradient-to-b from-gold-bright to-gold-deep px-3 py-4 font-display text-sm font-bold text-wood-900 shadow-gold active:scale-95"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    onHammerPress();
                  }}
                  onPointerUp={onHammerRelease}
                  onPointerCancel={onHammerRelease}
                >
                  🔨 Hammer
                  <span className="block text-[10px] font-normal opacity-80">tap = light · hold = heavy</span>
                </button>
                <button
                  className="select-none touch-none rounded-md border-2 border-gold-deep/70 texture-wood px-3 py-4 font-display text-sm font-bold text-on-wood active:scale-95"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    onBellowsPress();
                  }}
                  onPointerUp={onBellowsRelease}
                  onPointerCancel={onBellowsRelease}
                >
                  💨 Bellows
                  <span className="block text-[10px] font-normal opacity-80">hold to re-stoke</span>
                </button>
              </div>
              <p className="mt-2 text-center text-[10px] text-ink-muted">
                Space = hammer · Shift / B = bellows
              </p>
            </Panel>
          )}

          {phase === 'done' && result && (
            <Panel tone="parchment" className="p-5">
              <div className="space-y-4 text-center">
                {/* Result art + tiny CSS spark burst on Fine/Masterwork (skipped under reduced motion). */}
                <div className="relative mx-auto w-fit">
                  <Sprite spriteKey={art.spriteKey} look={art.look} size="lg" className="mx-auto" />
                  {result.tier >= FINE && !reducedMotion && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <span
                          key={i}
                          className="absolute h-1 w-1 rounded-full bg-gold-bright"
                          style={
                            {
                              '--a': `${i * 45}deg`,
                              animation: `forge-spark 0.65s ease-out ${i * 0.03}s forwards`,
                            } as CSSProperties
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
                {/* Tier badge — name + glyph + colour, never colour-only (a11y). */}
                <div
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-display text-sm font-bold"
                  style={{ color: CRAFT_TIERS[result.tier].color, borderColor: CRAFT_TIERS[result.tier].color }}
                >
                  <span>{CRAFT_TIERS[result.tier].glyph}</span>
                  {CRAFT_TIERS[result.tier].name} {art.name}
                </div>
                <p className="text-sm text-ink-muted italic leading-snug">{TIER_FLAVOUR[result.tier]}</p>

                {/* Score breakdown (heat / strikes) so a near-miss reads honestly (§4). */}
                <div className="mx-auto max-w-[16rem] rounded-md border border-gold-deep/20 bg-parchment-100/60 p-3 text-sm">
                  <div className="flex items-center justify-between text-ink">
                    <span>Heat</span>
                    <span className="font-bold">{Math.round(0.35 * result.heat01 * 100)}%</span>
                  </div>
                  <div className="flex items-center justify-between text-ink">
                    <span>Strikes</span>
                    <span className="font-bold">{Math.round(Math.max(0, result.score01 - 0.35 * result.heat01) * 100)}%</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between border-t border-gold-deep/20 pt-1 text-ink">
                    <span className="font-display font-bold">Quality</span>
                    <span className="font-bold text-gold-deep">{Math.round(result.score01 * 100)}%</span>
                  </div>
                </div>
              </div>
              <Button onClick={handleContinue} className="mt-4 w-full py-3">
                Continue
              </Button>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
