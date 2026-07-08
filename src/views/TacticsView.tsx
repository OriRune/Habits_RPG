import { useState } from 'react';
import { Grid3x3, Zap, Mountain, Sparkles, Gift, HelpCircle, ChevronDown } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer';
import { AdventureRitualModal } from '@/components/minigame/AdventureRitualModal';
import {
  TACTICS_ENERGY_COST, TACTICS_UNLOCK_LEVEL, TACTICS_GRANTED_SPELLS,
  STA_REGEN_PER_TURN, MP_REGEN_PER_TURN, COVER_DEFENSE, HAZARD_DMG,
  ARCHETYPE_INFO, isTacticsLoadoutSpell, moveTilesFor, climbFor,
  type TacticsSize, type TerrainKind, type Tile, type AIArchetype,
} from '@/engine/hexBattle';
import { ENEMIES } from '@/engine/enemies';
import { getSpell } from '@/engine/spells';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';
import { cn } from '@/lib/cn';
import { resume as sfxResume } from '@/lib/sfx';
import { hexCorners } from '@/components/tactics/iso';
import { terrainRGB, rgbStr } from '@/components/tactics/terrainArt';
import { CreatureToken } from '@/components/tactics/tokenArt';

const SIZE_OPTIONS: { id: TacticsSize; label: string; tiles: number }[] = [
  { id: 'small', label: 'Small', tiles: 37 },
  { id: 'medium', label: 'Medium', tiles: 61 },
  { id: 'large', label: 'Large', tiles: 127 },
];

const LOADOUT_CAP = 3;

/** Entrance screen for Hex Tactics (the live skirmish renders in TacticsOverlay). */
export function TacticsView() {
  const energy = useGameStore((s) => s.character.energy);
  const unlimitedEnergy = useGameStore((s) => s.settings.unlimitedEnergy);
  const level = useGameStore((s) => s.character.level);
  const ag = useGameStore((s) => s.character.statLevels.AG);
  const deepestTacticsTier = useGameStore((s) => s.deepestTacticsTier);
  const tacticsSize = useGameStore((s) => s.settings.tacticsSize);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const beginTactics = useGameStore((s) => s.beginTactics);
  const allKnownSpells = useGameStore((s) => s.knownSpells);
  const seenFoes = useGameStore((s) => s.tacticsSeenFoes);

  // Spells the player can choose to bring (excludes the 3 always-granted positional spells).
  const eligibleSpells = allKnownSpells.filter(isTacticsLoadoutSpell);

  // Default the loadout to the first LOADOUT_CAP eligible spells.
  const [loadout, setLoadout] = useState<string[]>(() => eligibleSpells.slice(0, LOADOUT_CAP));
  // Ephemeral difficulty-tier pick (like the loadout — NOT persisted). Defaults to one past the
  // player's best (audit D7): climbing to max tier is a choice, not the landing spot — a fresh
  // level-5 character defaulted into Tier 5 opened with back-to-back losses.
  const [tier, setTier] = useState<number>(() =>
    Math.min(level, Math.max(TACTICS_UNLOCK_LEVEL, deepestTacticsTier + 1)));
  const tierOptions = Array.from(
    { length: Math.max(0, level - TACTICS_UNLOCK_LEVEL + 1) },
    (_, i) => TACTICS_UNLOCK_LEVEL + i,
  );
  const [showRitual, setShowRitual] = useState(false);
  const showAdventureRitual = useGameStore((s) => s.settings.showAdventureRitual);

  function toggleSpell(key: string) {
    setLoadout((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= LOADOUT_CAP) return prev; // cap reached — ignore
      return [...prev, key];
    });
  }

  const coarse = useIsCoarsePointer();

  const unlocked = level >= TACTICS_UNLOCK_LEVEL;
  // Mirror TrialsView and the slice's own gate — the dev unlimited-energy toggle bypasses the cost.
  const canEnter = unlocked && (unlimitedEnergy || energy >= TACTICS_ENERGY_COST);
  // The engine's own formulas — a local mirror here drifted once already (stale cap 6 vs 7).
  const moveTiles = moveTilesFor(ag);
  const climb = climbFor(ag);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <SectionTitle tone="wood">Hex Tactics</SectionTitle>
      <Panel tone="parchment" frame="gold" className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-md texture-wood border border-gold-deep/60 text-stat-AG">
            <Grid3x3 className="h-6 w-6" />
          </span>
          <div>
            <div className="font-display text-base font-bold text-ink">Turn-Based Skirmish</div>
            <div className="text-sm text-ink-muted">One hero, a hex battlefield, and the high ground.</div>
          </div>
        </div>

        <p className="text-sm text-ink-muted">
          Face a band of foes on a board where every tile has a <span className="text-ink">height</span>.
          Strike from <span className="text-ink">high ground for bonus damage and reach</span>; take cover,
          skirt hazards, and pick your moment. This is where <span className="text-ink">Agility</span> finally
          pays off — it sets how far you move and how high you can climb each turn.
        </p>

        <HowToPlay seenFoes={seenFoes} />


        <div className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
          <div className="mb-2 font-display text-sm text-ink">Battlefield size</div>
          <div className="flex gap-1.5">
            {SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => updateSettings({ tacticsSize: opt.id })}
                className={cn(
                  'flex flex-1 flex-col items-center rounded-md border px-2 py-1.5 font-display text-xs font-bold transition-colors',
                  tacticsSize === opt.id
                    ? 'border-stat-AG bg-stat-AG/20 text-stat-AG'
                    : 'border-gold-deep/30 bg-parchment-300/40 text-ink-muted hover:bg-parchment-300/70',
                )}
              >
                {opt.label}
                <span className="text-[10px] font-normal opacity-80">{opt.tiles} tiles</span>
              </button>
            ))}
          </div>
        </div>

        {level > TACTICS_UNLOCK_LEVEL && (
          <div className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
            <div className="mb-2 font-display text-sm text-ink">Difficulty tier</div>
            <div className="flex flex-wrap gap-1.5">
              {tierOptions.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  className={cn(
                    'flex flex-col items-center rounded-md border px-2.5 py-1.5 font-display text-xs font-bold transition-colors',
                    tier === t
                      ? 'border-stat-AG bg-stat-AG/20 text-stat-AG'
                      : 'border-gold-deep/30 bg-parchment-300/40 text-ink-muted hover:bg-parchment-300/70',
                  )}
                >
                  Tier {t}
                  {t === level && <span className="text-[9px] font-normal opacity-70">max</span>}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-muted">
              Higher tiers field tougher foes and pay more gold. Capped at your level ({level}).
            </p>
          </div>
        )}

        {/* Spell loadout picker */}
        <div className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
          <div className="mb-2 flex items-center gap-1.5 font-display text-sm text-ink">
            <Sparkles className="h-3.5 w-3.5 text-stat-WI" />
            Bring spells{eligibleSpells.length > 0 ? ` (${loadout.length}/${LOADOUT_CAP})` : ''}
          </div>
          {/* Always-available positional spells */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(TACTICS_GRANTED_SPELLS as readonly string[]).map((key) => {
              const spell = getSpell(key);
              return (
                <span
                  key={key}
                  title="Always available — not counted in your loadout"
                  className="flex items-center gap-1 rounded border border-gold-deep/20 bg-parchment-300/40 px-2 py-0.5 font-display text-xs text-ink-muted"
                >
                  <span className="text-[9px] uppercase tracking-wide opacity-60">core</span>
                  {spell?.name ?? key}
                </span>
              );
            })}
          </div>
          {eligibleSpells.length === 0 ? (
            <p className="text-xs text-ink-muted">
              You'll bring the core Push / Blink / Cleave. Discover more spells to expand your loadout.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {eligibleSpells.map((key) => {
                  const spell = getSpell(key);
                  const chosen = loadout.includes(key);
                  const atCap = !chosen && loadout.length >= LOADOUT_CAP;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleSpell(key)}
                      disabled={atCap}
                      title={spell ? `${spell.name} — ${spell.mpCost} MP` : key}
                      className={cn(
                        'flex items-center gap-1 rounded border px-2 py-0.5 font-display text-xs font-bold transition-colors',
                        chosen
                          ? 'border-stat-WI bg-stat-WI/20 text-stat-WI'
                          : atCap
                            ? 'border-gold-deep/20 bg-parchment-300/30 text-ink-muted/50 cursor-not-allowed'
                            : 'border-gold-deep/30 bg-parchment-300/40 text-ink-muted hover:bg-parchment-300/70',
                      )}
                    >
                      {spell?.name ?? key}
                      {spell && (
                        <span className="text-[9px] font-normal opacity-70">{spell.mpCost}MP</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-ink-muted">
                Select up to {LOADOUT_CAP} spells to bring into the match.
                The core positional spells are always free.
              </p>
            </>
          )}
        </div>

        <div className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
          <div className="flex items-center gap-2 text-sm text-ink">
            <Mountain className="h-4 w-4 text-stat-AG" />
            <span className="font-display">Your Agility ({ag})</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-sm text-ink-muted">
            <span>Move range</span>
            <span className="font-display font-bold text-stat-AG">{moveTiles} tiles / turn</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm text-ink-muted">
            <span>Climb height</span>
            <span className="font-display font-bold text-stat-AG">{climb} levels / step</span>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
          <span className="flex items-center gap-1.5 text-sm text-ink">
            <Zap className="h-4 w-4 text-stat-AG" /> Cost: {TACTICS_ENERGY_COST} energy
          </span>
          <span className="text-sm text-ink-muted">You have {unlimitedEnergy ? '∞' : energy} ⚡</span>
        </div>

        <div className="rounded-md border border-gold-deep/30 bg-parchment-300/40 p-3 text-sm space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-display text-ink">Highest tier won</span>
            <span className="font-display font-bold text-gold-deep">
              {deepestTacticsTier > 0 ? `Tier ${deepestTacticsTier}` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between text-ink-muted">
            <span className="flex items-center gap-1">
              <Zap className="h-3.5 w-3.5 text-amber-400" /> Stamina recovers
            </span>
            <span className="font-display font-bold text-amber-400">+{STA_REGEN_PER_TURN} / turn</span>
          </div>
          <div className="flex items-center justify-between text-ink-muted">
            <span className="flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-blue-400" /> Mana recovers
            </span>
            <span className="font-display font-bold text-blue-400">+{MP_REGEN_PER_TURN} / turn</span>
          </div>
          <div className="flex items-center justify-between text-ink-muted">
            <span className="flex items-center gap-1">
              <Gift className="h-3.5 w-3.5 text-emerald-400" /> Bonus objective (~65%)
            </span>
            <span className="font-display font-bold text-emerald-400">+60% gold · potion</span>
          </div>
        </div>

        <Button
          onClick={() => {
            if (canEnter && showAdventureRitual) { setShowRitual(true); return; }
            void sfxResume(); beginTactics(eligibleSpells.length > 0 ? loadout : undefined, tier);
          }}
          disabled={!canEnter}
          className="w-full py-2.5"
        >
          {!unlocked
            ? `Unlocks at Level ${TACTICS_UNLOCK_LEVEL}`
            : canEnter
              ? 'Begin the Skirmish'
              : `Need ${TACTICS_ENERGY_COST} energy (complete habits)`}
        </Button>
        {coarse && unlocked && (
          <p className="text-center text-xs text-ink-muted">
            Touch controls: tap a target once to preview the damage, tap again to confirm.
          </p>
        )}
        {showRitual && (
          <AdventureRitualModal
            energyCost={TACTICS_ENERGY_COST}
            onConfirm={() => {
              setShowRitual(false);
              void sfxResume();
              beginTactics(eligibleSpells.length > 0 ? loadout : undefined, tier);
            }}
            onCancel={() => setShowRitual(false)}
          />
        )}
        {!unlocked && (
          <p className="text-center text-xs text-ink-muted">
            Train your habits to reach Level {TACTICS_UNLOCK_LEVEL} — you'll level up automatically.
          </p>
        )}
      </Panel>
    </div>
  );
}

// --- How to play -------------------------------------------------------------------------------

/** Tiny top-down hex swatch in the tile's real board color, for the terrain legend. */
function TileSwatch({ terrain }: { terrain: TerrainKind }) {
  const pts = hexCorners(11).map((p) => `${13 + p.x},${8 + p.y}`).join(' ');
  const rgb = terrainRGB({ hex: { q: 0, r: 0 }, terrain, elevation: 0 } as Tile);
  return (
    <svg width={26} height={16} className="shrink-0" aria-hidden>
      <polygon points={pts} fill={rgbStr(rgb)} stroke="rgba(0,0,0,0.45)" strokeWidth={1} />
    </svg>
  );
}

const TERRAIN_GUIDE: { terrain: TerrainKind; name: string; desc: string }[] = [
  { terrain: 'floor',   name: 'Open ground', desc: 'Plain footing — nothing special.' },
  { terrain: 'cover',   name: 'Barricade',   desc: `Stand on it for +${COVER_DEFENSE} defense and ward against every attack.` },
  { terrain: 'slow',    name: 'Tall grass',  desc: 'Heavy going — each step onto it costs 2 movement.' },
  { terrain: 'hazard',  name: 'Embers',      desc: `End a turn standing here and take ${HAZARD_DMG} damage. Shove foes in for heavy bonus damage!` },
  { terrain: 'blocked', name: 'Crag',        desc: 'Impassable — blocks movement and line of sight.' },
];

const FAMILY_LABEL: Record<NonNullable<(typeof ENEMIES)[string]['archetype']>, string> = {
  undead: 'Undead', beast: 'Beast', elemental: 'Elemental', construct: 'Construct',
};

/** Collapsible rules primer + bestiary. Creature entries reveal only once fought (tacticsSeenFoes). */
function HowToPlay({ seenFoes }: { seenFoes: string[] }) {
  const [open, setOpen] = useState(false);
  const seen = new Set(seenFoes);
  const roster = Object.values(ENEMIES);
  const discovered = roster.filter((t) => seen.has(t.id)).length;
  return (
    <div className="rounded-md border border-gold-deep/30 bg-parchment-100/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-3 font-display text-sm text-ink"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <HelpCircle className="h-4 w-4 text-stat-AG" /> How to play
        </span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-gold-deep/20 p-3 text-sm text-ink-muted">
          <div className="space-y-1">
            <div className="font-display text-xs font-bold uppercase tracking-wide text-ink">Your turn</div>
            <p>
              Each turn you can <span className="text-ink">move</span> (your Agility sets the tile budget)
              and take <span className="text-ink">one action</span> — a weapon strike or a spell. Attacks
              cost stamina; swing while below the cost and the hit lands at half power. Stamina recovers
              +{STA_REGEN_PER_TURN} and mana +{MP_REGEN_PER_TURN} each turn. Instead of acting you can{' '}
              <span className="text-ink">Hold ⌖</span> to arm an overwatch shot at the first foe that steps
              into range. Enemies telegraph their next move — read the badge over each foe before you commit.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="font-display text-xs font-bold uppercase tracking-wide text-ink">The battlefield</div>
            {TERRAIN_GUIDE.map(({ terrain, name, desc }) => (
              <div key={terrain} className="flex items-center gap-2">
                <TileSwatch terrain={terrain} />
                <span className="font-display text-xs font-bold text-ink">{name}</span>
                <span className="text-xs">{desc}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <div className="font-display text-xs font-bold uppercase tracking-wide text-ink">High ground</div>
            <p className="text-xs">
              Attacks deal <span className="text-ink">+12% damage per level of height advantage</span> (up to
              +36%) — and lose the same fighting uphill. Ranged weapons and spells also gain{' '}
              <span className="text-ink">+1 reach per level above the target</span> (max +2). Your Agility sets
              how many levels you can climb in a single step, and a taller ridge (or any unit) between you and
              a target blocks the shot.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="font-display text-xs font-bold uppercase tracking-wide text-ink">Know your foes</div>
            <p className="text-xs">
              The colored ring under each foe is its temperament — it tells you how it will move before it does.
            </p>
            {(Object.entries(ARCHETYPE_INFO) as [AIArchetype, (typeof ARCHETYPE_INFO)[AIArchetype]][]).map(([arch, info]) => (
              <div key={arch} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: info.color }} />
                <span className="font-display font-bold text-ink">{info.label}</span>
                <span>{info.blurb}</span>
              </div>
            ))}
            <p className="text-xs">
              Match your attack stat to a foe's <span className="text-green-700">⬆ weakness</span> for bonus
              damage; a <span className="text-red-700">⬇ resistance</span> blunts it. The arrows appear on
              foes while you aim.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="font-display text-xs font-bold uppercase tracking-wide text-ink">
              Bestiary — {discovered}/{roster.length} discovered
            </div>
            <p className="text-xs">Creatures reveal themselves once you have faced them in a skirmish.</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {roster.map((t) =>
                seen.has(t.id) ? (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 rounded-md border border-gold-deep/40 bg-wood-900 p-1.5"
                    title={t.flavor}
                  >
                    <CreatureToken templateId={t.id} sizePx={34} />
                    <div className="min-w-0">
                      <div className="truncate font-display text-[11px] font-bold text-parchment-200">{t.name}</div>
                      <div className="text-[9px] text-parchment-300/60">{FAMILY_LABEL[t.archetype ?? 'beast']}</div>
                      <div className="text-[9px]">
                        <span className="text-emerald-400">⬆ {t.weakTo.join(' ')}</span>
                        {(t.resistTo?.length ?? 0) > 0 && (
                          <span className="ml-1.5 text-red-400">⬇ {t.resistTo!.join(' ')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    key={t.id}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-gold-deep/40 bg-parchment-300/30 p-1.5 text-ink-muted/60"
                  >
                    <span className="font-display text-base font-bold">?</span>
                    <span className="text-[10px]">Undiscovered</span>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
