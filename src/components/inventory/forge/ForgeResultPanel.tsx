// The Forge's result ceremony — tier-staged reveal + honest score breakdown. Crude gets
// a sad smoke puff, Normal a single ring, Fine the classic spark burst, Masterwork rises
// white-hot out of the quench with a 12-spark radial. All motion is JS-gated on
// reducedMotion (the badge, flavour, and numbers carry the full information without it).
import type { CSSProperties } from 'react';
import { CRAFT_TIERS, FINE, MASTERWORK, NORMAL, type CraftTier } from '@/engine/crafting';
import type { CrestLook } from '@/lib/sprites';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Sprite } from '@/components/ui/Sprite';

export interface ForgeResult {
  score01: number;
  tier: CraftTier;
  heat01: number;
  strike01: number;
  quench01: number;
  strikes: number;
  crits: number;
  /** The run ended by heat death (progress < 1) — the quench never happened. */
  fireDied: boolean;
}

/** Per-tier flavour so a Crude reads as an honest outcome, not a bug (§7 M6 accessibility). */
const TIER_FLAVOUR: Record<CraftTier, string> = {
  0: 'The tempering went poorly — a rough but serviceable piece.',
  1: 'A sound, honest piece — struck true to spec.',
  2: 'Clean lines and a keen temper — fine work.',
  3: 'Flawless balance and a mirror finish — a masterwork.',
};

export function ForgeResultPanel({
  result,
  art,
  reducedMotion,
  onContinue,
}: {
  result: ForgeResult;
  art: { spriteKey: string; look: CrestLook; name: string };
  reducedMotion: boolean;
  onContinue: () => void;
}) {
  const tierDef = CRAFT_TIERS[result.tier];
  const sparkCount = result.tier === MASTERWORK ? 12 : result.tier === FINE ? 8 : 0;
  return (
    <Panel tone="parchment" className="p-5">
      <div className="space-y-4 text-center">
        {/* Result art + tier-staged ceremony (all skipped under reduced motion). */}
        <div className="relative mx-auto w-fit">
          <div
            style={
              !reducedMotion && result.tier === MASTERWORK
                ? { animation: 'forge-reveal-rise 0.9s ease-out both' }
                : undefined
            }
          >
            <Sprite spriteKey={art.spriteKey} look={art.look} size="lg" className="mx-auto" />
          </div>
          {!reducedMotion && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {/* Normal+: one impact ring announces the finished piece. */}
              {result.tier >= NORMAL && (
                <span
                  className="absolute left-1/2 top-1/2 h-16 w-16 rounded-full border-2"
                  style={{
                    borderColor: tierDef.color,
                    animation: `forge-impact-ring 0.6s ease-out ${result.tier === MASTERWORK ? 0.45 : 0.1}s both`,
                  }}
                />
              )}
              {/* Fine/Masterwork: radial spark burst (Masterwork's is denser + delayed
                  to land as the piece finishes rising). */}
              {Array.from({ length: sparkCount }).map((_, i) => (
                <span
                  key={i}
                  className="absolute h-1 w-1 rounded-full bg-gold-bright"
                  style={
                    {
                      '--a': `${Math.round((360 / sparkCount) * i)}deg`,
                      animation: `forge-spark 0.65s ease-out ${(result.tier === MASTERWORK ? 0.5 : 0) + i * 0.03}s both`,
                    } as CSSProperties
                  }
                />
              ))}
              {/* Crude: a sad little smoke puff. */}
              {result.tier === 0 &&
                [0, 1].map((i) => (
                  <span
                    key={i}
                    className="absolute rounded-full bg-ink/30"
                    style={{
                      width: 10 + i * 6,
                      height: 10 + i * 6,
                      animation: `forge-smoke-puff ${1.1 + i * 0.3}s ease-out ${i * 0.15}s both`,
                    }}
                  />
                ))}
            </div>
          )}
        </div>

        {/* Tier badge — name + glyph + colour, never colour-only (a11y). */}
        <div
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-display text-sm font-bold"
          style={{ color: tierDef.color, borderColor: tierDef.color }}
        >
          <span>{tierDef.glyph}</span>
          {tierDef.name} {art.name}
        </div>
        <p className="text-sm text-ink-muted italic leading-snug">{TIER_FLAVOUR[result.tier]}</p>
        {result.fireDied && (
          <p className="text-[11px] text-ember">
            The fire died before the piece was finished — no quench.
          </p>
        )}

        {/* Score breakdown (heat / strikes / quench) so a near-miss reads honestly (§4). */}
        <div className="mx-auto max-w-[16rem] rounded-md border border-gold-deep/20 bg-parchment-100/60 p-3 text-sm">
          <div className="flex items-center justify-between text-ink">
            <span>Heat</span>
            <span className="font-bold">{Math.round(0.32 * result.heat01 * 100)}%</span>
          </div>
          <div className="flex items-center justify-between text-ink">
            <span>
              Strikes
              <span className="ml-1 text-[10px] text-ink-muted">
                ({result.strikes}
                {result.crits > 0 ? `, ${result.crits} rang true` : ''})
              </span>
            </span>
            <span className="font-bold">{Math.round(0.58 * result.strike01 * 100)}%</span>
          </div>
          <div className="flex items-center justify-between text-ink">
            <span>Quench</span>
            <span className="font-bold">{Math.round(0.1 * result.quench01 * 100)}%</span>
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-gold-deep/20 pt-1 text-ink">
            <span className="font-display font-bold">Quality</span>
            <span className="font-bold text-gold-deep">{Math.round(result.score01 * 100)}%</span>
          </div>
        </div>
      </div>
      <Button onClick={onContinue} className="mt-4 w-full py-3">
        Continue
      </Button>
    </Panel>
  );
}
