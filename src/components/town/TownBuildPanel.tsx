// ============================================================================
//  TOWN BUILD PANEL — the Homestead's bottom-sheet palette (M4).
// ============================================================================
//
//  Three tabs docked to the viewport bottom over the canvas: Buildings / Decor /
//  Deeds. Each buildable row shows its next cost with have/need counts, gate notes
//  (prestige / deed), and affordability tinting; picking an affordable, ungated
//  entry hands its key up to TownView, which enters placement mode. The Deeds tab
//  is the pure-gold ≥500g sink (BAL-05): current district count, the next deed's
//  gold + prestige gate, and a confirm-gated Buy button.
//
//  Pure presentation over the town payload + wallet — every mutation is a callback
//  up to TownView (which owns placement, toasts, and the store actions).
// ============================================================================
import { useState } from 'react';
import { Coins, X } from 'lucide-react';
import {
  TOWN_BUILDINGS,
  TOWN_DECOR_CAP,
  TOWN_DECOR_PER_TYPE_CAP,
  TOWN_DEED_COSTS,
  TOWN_DEED_PRESTIGE,
  type TownBuildingDef,
  type TownPerkId,
  type TownTierCost,
} from '@/content/townBuildings';
import { TOWN_DECOR, type TownDecorDef } from '@/content/townDecor';
import { prestigeOf, townPerks, type TownState } from '@/engine/town';
import { getMaterial } from '@/engine/materials';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/** Short, human perk labels for building rows and the building card. */
export const PERK_LABEL: Record<TownPerkId, string> = {
  sight: '+1 crawler sight radius',
  stamina: '+10 crawler stamina',
  haggle: '15% dungeon-merchant discount',
  practice: 'Replay cleared skill trials',
  granary: '+2 maximum energy',
  mason: '−10% labor on new projects',
  forge_focus: 'Wider Forge sweet zone',
};

interface Wallet {
  gold: number;
  materials: Record<string, number>;
  unlimitedGold: boolean;
}

/** True when the wallet can pay a tier's gold + materials (unlimitedGold frees gold only). */
export function canAfford(w: Wallet, gold: number, materials: Record<string, number>): boolean {
  if (!w.unlimitedGold && w.gold < gold) return false;
  for (const [m, q] of Object.entries(materials)) {
    if ((w.materials[m] ?? 0) < q) return false;
  }
  return true;
}

/** A cost row: gold chip + one chip per material, each tinted ember when short. */
export function CostRow({ w, gold, materials }: { w: Wallet; gold: number; materials: Record<string, number> }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
      {gold > 0 && (
        <span className={cn('flex items-center gap-0.5', !w.unlimitedGold && w.gold < gold ? 'text-ember' : 'text-gold-deep')}>
          <Coins className="h-3 w-3" /> {gold}
          <span className="text-ink-light">({w.unlimitedGold ? '∞' : w.gold})</span>
        </span>
      )}
      {Object.entries(materials).map(([m, q]) => {
        const have = w.materials[m] ?? 0;
        return (
          <span key={m} className={cn(have < q ? 'text-ember' : 'text-ink-muted')}>
            {q}× {getMaterial(m)?.name ?? m}
            <span className="text-ink-light"> ({have})</span>
          </span>
        );
      })}
    </div>
  );
}

interface TownBuildPanelProps {
  town: TownState;
  wallet: Wallet;
  onPickBuilding: (key: string) => void;
  onPickDecor: (key: string) => void;
  onBuyDeed: () => void;
  onClose: () => void;
}

type Tab = 'buildings' | 'decor' | 'deeds';

export function TownBuildPanel({ town, wallet, onPickBuilding, onPickDecor, onBuyDeed, onClose }: TownBuildPanelProps) {
  const [tab, setTab] = useState<Tab>('buildings');
  const [confirmDeed, setConfirmDeed] = useState(false);
  const prestige = prestigeOf(town);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-3xl">
      <div className="texture-parchment max-h-[62vh] overflow-hidden rounded-t-xl border-t-2 border-gold-deep/60 shadow-gold">
        {/* Header + tabs */}
        <div className="flex items-center justify-between border-b border-gold-deep/30 px-3 pt-2">
          <div className="flex gap-1">
            {(['buildings', 'decor', 'deeds'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'min-h-[44px] rounded-t-md px-3 text-sm font-display font-semibold capitalize transition-colors',
                  tab === t ? 'bg-parchment-200/80 text-ink' : 'text-ink-muted hover:text-ink',
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close build panel"
            className="flex h-11 w-11 items-center justify-center text-ink-light hover:text-ember"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(62vh-52px)] space-y-2 overflow-y-auto p-3">
          {tab === 'buildings' && <BuildingsTab town={town} wallet={wallet} prestige={prestige} onPick={onPickBuilding} />}
          {tab === 'decor' && <DecorTab town={town} wallet={wallet} onPick={onPickDecor} />}
          {tab === 'deeds' && (
            <DeedsTab town={town} wallet={wallet} prestige={prestige} onBuy={() => setConfirmDeed(true)} />
          )}
        </div>
      </div>

      {confirmDeed && (
        <Modal title="Purchase a Land Deed?" onClose={() => setConfirmDeed(false)}>
          <p className="mb-4 text-sm text-ink-muted">
            Buy district {town.deeds + 1} for{' '}
            <span className="font-semibold text-gold-deep">{TOWN_DEED_COSTS[town.deeds]}g</span>. Gold stays sunk — deeds
            never refund. The new land unfolds immediately.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmDeed(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                onBuyDeed();
                setConfirmDeed(false);
              }}
            >
              Buy for {TOWN_DEED_COSTS[town.deeds]}g
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buildings tab
// ---------------------------------------------------------------------------

function gateNote(def: TownBuildingDef, town: TownState, prestige: number): string | null {
  if (!def.unlock) return null;
  if (def.unlock.deed !== undefined && town.deeds < def.unlock.deed) return `Needs deed ${def.unlock.deed}`;
  if (def.unlock.prestige !== undefined && prestige < def.unlock.prestige) return `Needs prestige ${def.unlock.prestige}`;
  return null;
}

function BuildingsTab({
  town,
  wallet,
  prestige,
  onPick,
}: {
  town: TownState;
  wallet: Wallet;
  prestige: number;
  onPick: (key: string) => void;
}) {
  // The build queue is full when every slot (1, or 2 with Keep tier III) is taken — disable
  // Place here so the dead-end is caught before entering placement mode (M6 M4 nit).
  const queueFull = town.queue.length >= townPerks(town).queueSlots;
  return (
    <>
      {Object.values(TOWN_BUILDINGS).map((def) => {
        const built = town.buildings.find((b) => b.key === def.key);
        const queued = town.queue.some((p) => p.kind === 'build' && p.key === def.key);
        const cost: TownTierCost = def.tiers[0];
        const gate = gateNote(def, town, prestige);
        const affordable = canAfford(wallet, cost.gold, cost.materials);
        const disabled = !!built || queued || !!gate || !affordable || queueFull;
        return (
          <div key={def.key} className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-ink">{def.name}</span>
                  <span className="shrink-0 text-[10px] text-ink-light">
                    {def.w}×{def.h}
                  </span>
                </div>
                <div className="truncate text-[11px] text-ink-muted">{def.flavor}</div>
                {def.perk && <div className="text-[10px] text-gold-deep">Perk: {PERK_LABEL[def.perk]}</div>}
              </div>
              <div className="shrink-0">
                {built ? (
                  <span className="text-[10px] text-ink-muted">tier {built.tier}</span>
                ) : (
                  <Button
                    onClick={() => onPick(def.key)}
                    disabled={disabled}
                    className="min-h-[44px] px-3 py-1.5 text-xs"
                  >
                    {queued ? 'Building…' : 'Place'}
                  </Button>
                )}
              </div>
            </div>
            {built ? (
              <div className="mt-1 text-[10px] text-ink-muted">Built — upgrade on the building card.</div>
            ) : (
              <>
                <CostRow w={wallet} gold={cost.gold} materials={cost.materials} />
                {gate && <div className="mt-0.5 text-[10px] text-ember">{gate}</div>}
                {!gate && !queued && queueFull && (
                  <div className="mt-0.5 text-[10px] text-ember">Build queue is full</div>
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Decor tab
// ---------------------------------------------------------------------------

function DecorTab({ town, wallet, onPick }: { town: TownState; wallet: Wallet; onPick: (key: string) => void }) {
  const totalPlaced = town.decor.length;
  return (
    <>
      <div className="mb-1 text-[11px] text-ink-muted">
        {totalPlaced}/{TOWN_DECOR_CAP} props placed
      </div>
      {Object.values(TOWN_DECOR).map((def: TownDecorDef) => {
        const count = town.decor.filter((d) => d.key === def.key).length;
        const atTypeCap = count >= TOWN_DECOR_PER_TYPE_CAP;
        const atGlobalCap = totalPlaced >= TOWN_DECOR_CAP;
        const affordable = canAfford(wallet, def.gold, def.materials);
        const disabled = atTypeCap || atGlobalCap || !affordable;
        return (
          <div key={def.key} className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-ink">{def.name}</span>
                  <span className="shrink-0 text-[10px] text-ink-light">
                    {def.w}×{def.h}
                  </span>
                </div>
                <div className="text-[10px] text-ink-muted">
                  {count}/{TOWN_DECOR_PER_TYPE_CAP} placed
                </div>
              </div>
              <Button
                onClick={() => onPick(def.key)}
                disabled={disabled}
                className="min-h-[44px] shrink-0 px-3 py-1.5 text-xs"
              >
                Place
              </Button>
            </div>
            <CostRow w={wallet} gold={def.gold} materials={def.materials} />
            {atTypeCap && <div className="mt-0.5 text-[10px] text-ember">Type cap reached</div>}
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Deeds tab — the pure-gold BAL-05 sink
// ---------------------------------------------------------------------------

function DeedsTab({
  town,
  wallet,
  prestige,
  onBuy,
}: {
  town: TownState;
  wallet: Wallet;
  prestige: number;
  onBuy: () => void;
}) {
  const fullyClaimed = town.deeds >= TOWN_DEED_COSTS.length;
  const cost = fullyClaimed ? 0 : TOWN_DEED_COSTS[town.deeds];
  const gate = fullyClaimed ? 0 : TOWN_DEED_PRESTIGE[town.deeds];
  const prestigeMet = prestige >= gate;
  const goldMet = wallet.unlimitedGold || wallet.gold >= cost;
  return (
    <div className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3">
      <div className="text-sm font-semibold text-ink">
        {town.deeds} of {TOWN_DEED_COSTS.length} districts claimed
      </div>
      {fullyClaimed ? (
        <p className="mt-2 text-sm text-gold-deep">The town is fully claimed — every district is yours.</p>
      ) : (
        <>
          <p className="mt-1 text-[11px] text-ink-muted">
            Deeds expand the buildable land — a pure-gold sink that never refunds.
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs">
            <span className={cn('flex items-center gap-0.5', goldMet ? 'text-gold-deep' : 'text-ember')}>
              <Coins className="h-3.5 w-3.5" /> {cost}
              <span className="text-ink-light">({wallet.unlimitedGold ? '∞' : wallet.gold})</span>
            </span>
            <span className={cn(prestigeMet ? 'text-ink-muted' : 'text-ember')}>
              Prestige {gate} <span className="text-ink-light">({prestige})</span>
            </span>
          </div>
          <Button
            onClick={onBuy}
            disabled={!prestigeMet || !goldMet}
            className="mt-3 min-h-[44px] w-full"
          >
            Buy district {town.deeds + 1}
          </Button>
          {!prestigeMet && (
            <div className="mt-1 text-center text-[10px] text-ember">
              Raise prestige to {gate} by building &amp; upgrading.
            </div>
          )}
          {prestigeMet && !goldMet && (
            <div className="mt-1 text-center text-[10px] text-ember">
              Not enough gold — you need {cost}g for this deed.
            </div>
          )}
        </>
      )}
    </div>
  );
}
