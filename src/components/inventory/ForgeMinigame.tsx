// The Forge — crafting minigame modal. A full-screen overlay that plays the three-phase
// heat economy from engine/crafting/forge.ts (stoke → strike → quench) over a living
// smithy scene (ForgeScene) and, on completion, writes the earned quality tier by calling
// craft/reforge(recipeKey, score01, boosts).
//
// UI discipline follows ArmoryBreak.tsx: a single rAF loop reads REFS (never React state)
// each frame, calls the pure reducer, and writes gauge styles + three scene CSS variables
// imperatively — React state only flips at phase/event transitions. Hammer releases and
// quench plunges use the projectReleasePower idea (armoryBreak.ts): one sub-frame
// stepForge from the last frame to the true pointer instant so timing isn't quantized to
// frame boundaries.
import { useState, useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '@/store/useGameStore';
import {
  getRecipe,
  scoreToTier,
  reforgeCost,
  reforgeAnchorOf,
  recipeTemperament,
  asCraftTier,
  CRAFT_TIERS,
  MASTERWORK,
} from '@/engine/crafting';
import {
  initForge,
  stepForge,
  commitStoke,
  forgeScoreParts,
  heatBandWidth,
  strikeSweetHalf,
  strikePower,
  effectiveStrikeHalf,
  activeZoneMult,
  quenchHalf,
  applyTemperament,
  boostMods,
  QUENCH_BAND_CENTRE,
  type ForgeRunState,
  type ForgeMods,
  type ForgeBoosts,
  type ForgeEventKind,
} from '@/engine/crafting/forge';
import { shakeOffset } from '@/engine/crawl';
import { townPerks } from '@/engine/town';
import { getGear } from '@/engine/gear';
import { getWeapon } from '@/engine/weapons';
import { getMaterial } from '@/engine/materials';
import { gearCrest, weaponCrest, type CrestLook } from '@/lib/sprites';
import * as sfx from '@/lib/sfx';
import { buzz } from '@/lib/haptics';
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer';
import { Panel } from '@/components/ui/Panel';
import { ForgeScene, type ForgeSceneHandle } from './forge/ForgeScene';
import { ForgeBoostPanel } from './forge/ForgeBoostPanel';
import { ForgeResultPanel, type ForgeResult } from './forge/ForgeResultPanel';

interface ForgeMinigameProps {
  recipeKey: string;
  mode?: 'craft' | 'reforge';
  onClose: () => void;
}

/** Sprite key + crest for a recipe's gear/weapon result. */
function resultArt(kind: string, key: string): { spriteKey: string; look: CrestLook; name: string } {
  if (kind === 'weapon') {
    const w = getWeapon(key);
    return { spriteKey: `weapon:${key}`, look: weaponCrest(w.name, w.attackStat), name: w.name };
  }
  const g = getGear(key);
  return { spriteKey: `gear:${key}`, look: gearCrest(g?.name ?? key, g?.slot), name: g?.name ?? key };
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

  // Haptics only make sense on touch devices; mirror into a ref for stable callbacks.
  const coarse = useIsCoarsePointer();
  const coarseRef = useRef(coarse);
  coarseRef.current = coarse;

  // Snapshot the combat stat levels once at mount (§4: chips + true zone widths).
  const dxRef = useRef(useGameStore.getState().character.statLevels?.DX ?? 0);
  const stRef = useRef(useGameStore.getState().character.statLevels?.ST ?? 0);
  // Homestead Smithy (forge_focus perk): +0.03 sweet-zone half-width, snapshotted once at
  // mount and threaded (additively) into stepForge / effectiveStrikeHalf alongside dx/st.
  const forgeSweetRef = useRef(townPerks(useGameStore.getState().town).forgeSweetBonus);

  // Reduced motion: scale the WHOLE sim dt by 1/1.5 (slower needle + decay) and widen both
  // sweet zones ×1.5 via mods.zoneMult. Baking zoneMult into initForge widens the Phase A
  // band too (commitStoke reads the seeded zoneMult).
  const reducedMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ).current;

  // The metal's temperament — folded into the run mods at start so THIS recipe plays
  // like itself (needle pace, band position, heat economy).
  const temperamentId = recipe ? recipeTemperament(recipe) : undefined;

  // Fuel & Flux selection (§6). One fuel + one flux max. The pre-run panel gates the sim start.
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false);
  const [fuel, setFuel] = useState<'wood' | 'stone' | null>(null);
  const [flux, setFlux] = useState(false);
  const boosts: ForgeBoosts = fuel ? { fuel, flux } : { flux };
  // Final mods = boosts × temperament × reduced-motion widening. Set at start into the ref.
  const modsRef = useRef<ForgeMods>(runMods({ flux: false }, reducedMotion));

  const [phase, setPhase] = useState<'stoke' | 'strike' | 'quench' | 'done'>('stoke');
  const [result, setResult] = useState<ForgeResult | null>(null);
  const [eventBanner, setEventBanner] = useState<ForgeEventKind | null>(null);

  // Live run state + inputs live in refs so the rAF loop and pointer/key callbacks never
  // read stale React state.
  const stateRef = useRef<ForgeRunState>(initForge(dxRef.current, stRef.current, modsRef.current));
  const hammerRef = useRef(false);
  const bellowsRef = useRef(false);
  const lastFrameRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // DOM targets updated imperatively each frame.
  const sceneRef = useRef<ForgeSceneHandle>(null);
  const heatBarFillRef = useRef<HTMLDivElement>(null); // Phase A fill
  const heatFillRef = useRef<HTMLDivElement>(null); // Phase B heat gauge
  const heatCeilRef = useRef<HTMLDivElement>(null); // Phase B fatigue ceiling
  const needleRef = useRef<HTMLDivElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const strikeBadgeRef = useRef<HTMLSpanElement>(null);
  const tempoFillRef = useRef<HTMLDivElement>(null);
  const tempoWrapRef = useRef<HTMLDivElement>(null); // pulses gold when the rhythm locks
  const quenchFillRef = useRef<HTMLDivElement>(null); // Phase C falling bar
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
      // Render the sweet-zone at its TRUE size (DX/flux/temperament widening, the a11y
      // floor, the in-charge shrink, AND an active Ember Surge) via the same engine
      // helpers stepForge scores with — no twin drift.
      const halfW = effectiveStrikeHalf(
        dxRef.current,
        activeZoneMult(s, modsRef.current.zoneMult),
        s.chargeT,
        forgeSweetRef.current,
      );
      const left = Math.max(0, s.zoneCentre - halfW);
      const right = Math.min(1, s.zoneCentre + halfW);
      zoneRef.current.style.left = `${left * 100}%`;
      zoneRef.current.style.width = `${Math.max(0, right - left) * 100}%`;
    }
    if (progressFillRef.current) progressFillRef.current.style.width = `${Math.min(1, s.progress) * 100}%`;
    if (strikeBadgeRef.current) strikeBadgeRef.current.textContent = String(s.strikes.length);
    if (tempoFillRef.current) tempoFillRef.current.style.width = `${s.tempo * 100}%`;
    if (tempoWrapRef.current) tempoWrapRef.current.classList.toggle('forge-tempo-hot', s.tempo >= 0.75);
    if (quenchFillRef.current) quenchFillRef.current.style.height = `${s.quenchBar * 100}%`;
    // The scene derives everything (fire, embers, workpiece glow, temper line) from
    // three CSS variables; the forecast is the real score of the state so far.
    sceneRef.current?.update(s, forgeScoreParts(s).score01);
  }, []);

  const finishRun = useCallback((s: ForgeRunState) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (contentRef.current) contentRef.current.style.transform = ''; // clear any residual shake
    sfx.stopDrone();
    const { strike01, score01 } = forgeScoreParts(s);
    setResult({
      score01,
      tier: scoreToTier(score01),
      heat01: s.heat01,
      strike01,
      quench01: s.quench01,
      strikes: s.strikes.length,
      crits: s.strikes.filter((x) => x.crit).length,
      fireDied: s.progress < 1,
    });
    setPhase('done');
    setEventBanner(null);
    sfx.play('forgeComplete');
  }, []);

  /**
   * Shared post-step bookkeeping for the loop AND the sub-frame handlers: forge-event
   * start/end FX + banner, and phase transitions (strike→quench chime, done→result).
   */
  const afterStep = useCallback(
    (prev: ForgeRunState, next: ForgeRunState) => {
      if ((next.event?.kind ?? null) !== (prev.event?.kind ?? null)) {
        const kind = next.event?.kind ?? null;
        sceneRef.current?.eventFx(kind);
        setEventBanner(kind);
        if (kind === 'ember') sfx.play('forgeEmber');
        else if (kind === 'snap') sfx.play('forgeSnap');
      }
      if (next.phase !== prev.phase) {
        if (next.phase === 'done') {
          finishRun(next);
        } else if (next.phase === 'quench') {
          setPhase('quench');
          sfx.playNote(740, 260); // ready ping — the piece is forged, to the tub!
        } else if (next.phase === 'strike') {
          setPhase('strike');
        }
      }
    },
    [finishRun],
  );

  // Single rAF loop for the whole run — stoke fill, strike sim, quench fall. Stops at
  // 'done'. Gated on `started` so the Fuel & Flux panel can be reviewed first.
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
      // The forge roar rises and falls with the fire (and surges on an ember event).
      sfx.setDroneIntensity(
        0.12 + 0.55 * Math.max(0, next.heat) + (next.event?.kind === 'ember' ? 0.25 : 0),
      );
      // Decaying strike shake — zero offset under reduced motion (mag stays 0).
      if (contentRef.current) {
        const sh = shakeRef.current;
        const { sx, sy } = shakeOffset(sh.mag, ts - sh.t0, sh.dur, Math.random(), Math.random());
        contentRef.current.style.transform = sx || sy ? `translate3d(${sx}px,${sy}px,0)` : '';
      }
      afterStep(s, next);
      if (next.phase !== 'done') rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [started, reducedMotion, writeDom, afterStep]);

  // The drone is shared module-level audio: stop it on ANY exit path (finish handles the
  // normal case; this cleanup covers closing the modal mid-run).
  useEffect(() => () => sfx.stopDrone(), []);

  // Light the fire: bake boosts × temperament (+ reduced motion) into mods, seed the run
  // (Math.random rolls this run's event schedule), start the roar.
  const startForge = useCallback(() => {
    modsRef.current = applyTemperament(runMods(boosts, reducedMotion), temperamentId);
    stateRef.current = initForge(dxRef.current, stRef.current, modsRef.current, Math.random);
    lastFrameRef.current = null;
    startedRef.current = true;
    void sfx.resume();
    sfx.startDrone();
    setStarted(true);
  }, [boosts, reducedMotion, temperamentId]);

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
    // A strike fired this release → audio + shake + scene FX keyed to weight/accuracy/crit.
    if (next.strikes.length > s.strikes.length) {
      const { acc, weight, crit } = next.strikes[next.strikes.length - 1];
      if (weight > 1) {
        sfx.play('forgeStrikeHeavy');
        sfx.spikeDrone();
      } else {
        sfx.play(acc > 0.5 ? 'forgeStrikeGood' : 'forgeStrikeMiss');
      }
      if (crit) sfx.play('forgeCrit'); // rings over the clang
      triggerShake(weight > 1 ? (crit ? 10 : 8) : crit ? 6 : 4);
      sceneRef.current?.strike(acc, weight, crit);
      if (coarseRef.current && acc > 0) buzz(crit ? [10, 30, 20] : weight > 1 ? 25 : 10);
      const bar = strikeBarRef.current;
      if (bar) {
        bar.classList.add('crawler-hit-flash');
        setTimeout(() => bar.classList.remove('crawler-hit-flash'), 220);
      }
    }
    afterStep(s, next);
  }, [reducedMotion, writeDom, afterStep, triggerShake]);

  const onBellowsPress = useCallback(() => {
    if (stateRef.current.phase !== 'strike') return;
    bellowsRef.current = true;
    sfx.play('forgeStoke');
  }, []);

  const onBellowsRelease = useCallback(() => {
    bellowsRef.current = false;
  }, []);

  // ── Phase C (quench): one timed plunge as the bar falls ────────────────────────
  const onQuenchPress = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'quench') return;
    // Same sub-frame projection as strikes: the plunge lands at the true press instant.
    const pressTs = performance.now();
    const dt = lastFrameRef.current == null ? 0 : Math.max(0, (pressTs - lastFrameRef.current) / 1000);
    const eff = reducedMotion ? dt / 1.5 : dt;
    const next = stepForge(
      s,
      { hammerHeld: true, bellowsHeld: false },
      eff,
      dxRef.current,
      stRef.current,
      modsRef.current,
      forgeSweetRef.current,
    );
    lastFrameRef.current = pressTs;
    stateRef.current = next;
    writeDom(next);
    if (next.phase === 'done') {
      sfx.play(next.quench01 > 0.4 ? 'forgeQuench' : 'forgeQuenchWeak');
      sceneRef.current?.quenchFx(next.quench01);
      if (coarseRef.current) buzz(30);
      // Let the steam rise before the result panel swaps in (instant under reduced motion).
      if (reducedMotion) finishRun(next);
      else setTimeout(() => finishRun(next), 550);
    }
  }, [reducedMotion, writeDom, finishRun]);

  // Keyboard: Space = stoke-hold / hammer / quench; Shift or B = bellows.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || !startedRef.current) return;
      if (e.code === 'Space') {
        e.preventDefault();
        const p = stateRef.current.phase;
        if (p === 'stoke') onStokePress();
        else if (p === 'quench') onQuenchPress();
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
  }, [onStokePress, commit, onHammerPress, onHammerRelease, onBellowsPress, onBellowsRelease, onQuenchPress]);

  if (!recipe) return null;

  const dx = dxRef.current;
  const st = stRef.current;
  // Include the Smithy forge_focus bonus so the pre-run zone chip matches the live sweet zone
  // (effectiveStrikeHalf threads forgeSweetRef too); denominator stays the un-perked DX-0 base.
  const zonePct = Math.round((strikeSweetHalf(dx, forgeSweetRef.current) / strikeSweetHalf(0) - 1) * 100);
  const powerPct = Math.round((strikePower(st) / strikePower(0) - 1) * 100);
  const art = resultArt(recipe.result.kind, recipe.result.key);
  // Phase A band drawn at its true DX/flux-scaled size and temperament-shifted position
  // (matches commitStoke's scoring band — it reads the same seeded state).
  const bandWidth = heatBandWidth(dx) * modsRef.current.zoneMult;
  const bandStart = stateRef.current.bandStart;
  // Phase C band, same widening levers as the strike zone.
  const qHalf = quenchHalf(dx, modsRef.current.zoneMult);

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
          {/* The living smithy — fire, embers, workpiece glow, and hammer all track the run. */}
          <div className="relative">
            <ForgeScene
              ref={sceneRef}
              workpiece={recipe.result.kind === 'weapon' ? 'blade' : 'plate'}
              reducedMotion={reducedMotion}
            />
            {eventBanner && (
              <div
                className={
                  'pointer-events-none absolute left-1/2 top-3 rounded-full border px-3 py-1 font-display text-xs font-bold ' +
                  (eventBanner === 'ember'
                    ? 'border-gold-bright bg-wood-900/85 text-gold-bright'
                    : 'border-sky-300/60 bg-wood-900/85 text-sky-200')
                }
                style={
                  reducedMotion
                    ? { transform: 'translate(-50%, 0)' }
                    : { animation: 'forge-float 2.6s ease-out both' }
                }
                role="status"
              >
                {eventBanner === 'ember' ? '🔥 Ember surge — strike now!' : '❄️ The coals dim — bellows!'}
              </div>
            )}
          </div>

          {/* Stat chips — real numbers from the engine helpers (§4). */}
          <div className="flex flex-wrap justify-center gap-2">
            <span className="rounded-full border border-gold-deep/40 bg-parchment-100/70 px-2.5 py-1 text-[11px] font-display text-ink">
              DX {dx} → +{zonePct}% wider zones
            </span>
            <span className="rounded-full border border-gold-deep/40 bg-parchment-100/70 px-2.5 py-1 text-[11px] font-display text-ink">
              ST {st} → +{powerPct}% strike power
            </span>
          </div>

          {!started && temperamentId && (
            <ForgeBoostPanel
              temperament={temperamentId}
              woodHave={woodHave}
              stoneHave={stoneHave}
              gemHave={gemHave}
              fuel={fuel}
              flux={flux}
              onFuel={(f) => setFuel((cur) => (cur === f ? null : f))}
              onFlux={() => setFlux((v) => !v)}
              onStart={startForge}
            />
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
                  {/* DX-scaled sweet band at its true (temperament-shifted) position/size */}
                  <div
                    className="absolute w-full border-y border-gold-bright/60 bg-gold-bright/30"
                    style={{ bottom: `${bandStart * 100}%`, height: `${bandWidth * 100}%` }}
                  />
                  {/* Fill (imperative height) */}
                  <div
                    ref={heatBarFillRef}
                    className="absolute bottom-0 w-full bg-gradient-to-t from-ember to-gold-bright/80"
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
                    <div
                      ref={heatFillRef}
                      className="absolute bottom-0 w-full bg-gradient-to-t from-ember to-gold-bright/80"
                      style={{ height: '0%' }}
                    />
                    {/* Fatigue ceiling — drops after re-stokes */}
                    <div
                      ref={heatCeilRef}
                      className="absolute left-0 h-0.5 w-full bg-ink/70"
                      style={{ bottom: '100%' }}
                    />
                  </div>
                </div>

                <div className="flex-1 space-y-3">
                  {/* Needle bar + moving sweet-zone (shrinks while charging, flares on an ember surge) */}
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

                  {/* Rhythm meter — spaced, landed blows build a progress multiplier */}
                  <div>
                    <div className="mb-1 flex items-center justify-between font-display text-[10px] text-ink-muted">
                      <span>Rhythm</span>
                      <span>steady blows hit harder</span>
                    </div>
                    <div
                      ref={tempoWrapRef}
                      className="relative h-2 overflow-hidden rounded-full border border-gold-deep/40 bg-parchment-300/50"
                    >
                      <div
                        ref={tempoFillRef}
                        className="absolute left-0 top-0 h-full bg-gold-bright/80"
                        style={{ width: '0%' }}
                      />
                    </div>
                  </div>

                  {/* Forge progress + strike badge */}
                  <div>
                    <div className="mb-1 flex items-center justify-between font-display text-[10px] text-ink-muted">
                      <span>Forging</span>
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

          {phase === 'quench' && (
            <Panel tone="parchment" className="p-5">
              <p className="mb-3 text-center text-sm text-ink">
                <strong className="text-ink">The piece is forged!</strong> Plunge it as the metal
                falls through the blue band.
              </p>
              <div className="flex items-center justify-center gap-6">
                {/* Falling quench bar with the water band at its true position/size */}
                <div className="relative h-48 w-14 overflow-hidden rounded-md border border-gold-deep/50 bg-parchment-300/50">
                  <div
                    className="absolute w-full border-y border-sky-500/70 bg-sky-400/30"
                    style={{
                      bottom: `${Math.max(0, QUENCH_BAND_CENTRE - qHalf) * 100}%`,
                      height: `${Math.min(1, qHalf * 2) * 100}%`,
                    }}
                  />
                  <div
                    ref={quenchFillRef}
                    className="absolute bottom-0 w-full border-t-2 border-parchment-100 bg-gradient-to-t from-ember to-gold-bright/80"
                    style={{ height: '100%' }}
                  />
                </div>
                <button
                  className="select-none touch-none rounded-md border-2 border-sky-700 bg-gradient-to-b from-sky-400 to-sky-700 px-4 py-6 font-display text-sm font-bold text-wood-900 active:scale-95"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    onQuenchPress();
                  }}
                >
                  🌊 Quench!
                  <span className="block text-[10px] font-normal opacity-80">one shot — time it</span>
                </button>
              </div>
              <p className="mt-2 text-center text-[10px] text-ink-muted">Space = quench</p>
            </Panel>
          )}

          {phase === 'done' && result && (
            <ForgeResultPanel
              result={result}
              art={art}
              reducedMotion={reducedMotion}
              onContinue={handleContinue}
            />
          )}
        </div>
      </div>
    </div>
  );
}
