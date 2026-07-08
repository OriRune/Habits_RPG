// ============================================================================
//  TOWN BUILDING CARD — details + actions for a completed building (M4).
// ============================================================================
//
//  Opens when a completed building is tapped. Shows tier, flavor, and its perk;
//  offers Upgrade (next-tier cost, gated with a reason), Move (free relocation,
//  blocked while a project targets it), and Demolish behind a confirm dialog
//  (50% materials back, 0 gold — the Keep is undemolishable, so its button is
//  hidden). A building with a live upgrade shows progress + Cancel (100% materials
//  back, applied labor forfeited).
//
//  Upgrade / demolish / cancel call the store directly (each is validate-then-commit
//  and no-ops when invalid); Move hands control back to TownView, which owns the
//  placement flow. Perk wiring lands in M5 — the perk row notes it comes online next.
// ============================================================================
import { useState } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { useToastStore } from '@/store/useToastStore';
import { townPerks } from '@/engine/town';
import { TOWN_BUILDINGS, KEEP_KEY } from '@/content/townBuildings';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { CostRow, PERK_LABEL, canAfford } from './TownBuildPanel';

interface Props {
  buildingId: string;
  onMove: (buildingId: string) => void;
  onClose: () => void;
}

export function TownBuildingCard({ buildingId, onMove, onClose }: Props) {
  const town = useGameStore((s) => s.town);
  const gold = useGameStore((s) => s.character.gold);
  const materials = useGameStore((s) => s.materials);
  const unlimitedGold = useGameStore((s) => s.settings.unlimitedGold);
  const townQueueUpgrade = useGameStore((s) => s.townQueueUpgrade);
  const townDemolish = useGameStore((s) => s.townDemolish);
  const townCancelProject = useGameStore((s) => s.townCancelProject);
  const pushToast = useToastStore((s) => s.pushToast);

  const [confirm, setConfirm] = useState<'demolish' | 'cancel' | null>(null);

  const building = town.buildings.find((b) => b.id === buildingId);
  const def = building ? TOWN_BUILDINGS[building.key] : undefined;
  if (!building || !def) {
    // The building vanished (e.g. demolished) — nothing to show.
    return null;
  }

  const wallet = { gold, materials, unlimitedGold };
  const activeProject = town.queue.find((p) => p.buildingId === buildingId);
  const atMaxTier = building.tier >= def.maxTier;
  const nextCost = atMaxTier ? undefined : def.tiers[building.tier];
  const queueFull = town.queue.length >= townPerks(town).queueSlots;
  const affordable = nextCost ? canAfford(wallet, nextCost.gold, nextCost.materials) : false;

  let upgradeReason: string | null = null;
  if (atMaxTier) upgradeReason = 'Max tier reached';
  else if (activeProject) upgradeReason = 'Already under construction';
  else if (queueFull) upgradeReason = 'Build queue full';
  else if (!affordable) upgradeReason = 'Not enough gold or materials';

  const isKeep = building.key === KEEP_KEY;

  function handleUpgrade() {
    townQueueUpgrade(buildingId);
    pushToast({ text: `${def!.name} upgrade queued`, color: '#e8b923' });
    onClose();
  }

  function handleDemolish() {
    townDemolish(buildingId);
    pushToast({ text: `${def!.name} demolished`, color: '#c2683a' });
    onClose();
  }

  function handleCancel() {
    if (activeProject) townCancelProject(activeProject.id);
    pushToast({ text: 'Project cancelled — materials returned', color: '#c2683a' });
    setConfirm(null);
  }

  return (
    <Modal title={def.name} onClose={onClose}>
      <p className="mb-1 text-sm text-ink-muted">{def.flavor}</p>
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="rounded-full border border-gold-deep/50 px-2 py-0.5 font-display font-semibold text-gold-deep">
          Tier {building.tier} / {def.maxTier}
        </span>
        {def.perk && (
          <span className="text-ink-muted">
            {PERK_LABEL[def.perk]} <span className="text-ink-light">· active</span>
          </span>
        )}
      </div>

      {/* Active upgrade progress + cancel */}
      {activeProject && (
        <div className="mb-3 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-ink">Upgrading…</span>
            <span className="text-ink-muted">
              {activeProject.laborApplied}/{activeProject.laborNeed} 🔨
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-wood-800/40">
            <div
              className="h-full bg-gold-bright"
              style={{ width: `${Math.min(100, (activeProject.laborApplied / Math.max(1, activeProject.laborNeed)) * 100)}%` }}
            />
          </div>
          <Button variant="secondary" className="mt-2 min-h-[44px] w-full text-xs" onClick={() => setConfirm('cancel')}>
            Cancel project
          </Button>
        </div>
      )}

      {/* Upgrade section */}
      {!atMaxTier && !activeProject && (
        <div className="mb-3 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink">Upgrade to tier {building.tier + 1}</span>
            <Button onClick={handleUpgrade} disabled={!!upgradeReason} className="min-h-[44px] px-3 py-1.5 text-xs">
              Upgrade
            </Button>
          </div>
          {nextCost && <CostRow w={wallet} gold={nextCost.gold} materials={nextCost.materials} />}
          {upgradeReason && <div className="mt-0.5 text-[10px] text-ember">{upgradeReason}</div>}
        </div>
      )}
      {atMaxTier && (
        <div className="mb-3 text-center text-xs text-gold-deep">This building is at its highest tier.</div>
      )}

      {/* Move / Demolish */}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          className="min-h-[44px] flex-1 text-xs"
          disabled={!!activeProject}
          onClick={() => {
            onMove(buildingId);
            onClose();
          }}
        >
          Move
        </Button>
        {!isKeep && (
          <Button
            variant="secondary"
            className="min-h-[44px] flex-1 text-xs text-ember"
            onClick={() => setConfirm('demolish')}
          >
            Demolish
          </Button>
        )}
      </div>
      {!!activeProject && (
        <div className="mt-1 text-center text-[10px] text-ink-light">
          Cancel the upgrade before moving this building.
        </div>
      )}

      {/* Confirm dialogs */}
      {confirm === 'demolish' && (
        <Modal title={`Demolish ${def.name}?`} onClose={() => setConfirm(null)}>
          <p className="mb-4 text-sm text-ink-muted">
            Refunds <span className="font-semibold text-ink">50% of its materials</span> — gold stays sunk. Its prestige is
            lost and this cannot be undone.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirm(null)}>
              Keep it
            </Button>
            <Button className="flex-1 bg-ember text-white hover:bg-ember/90" onClick={handleDemolish}>
              Demolish
            </Button>
          </div>
        </Modal>
      )}
      {confirm === 'cancel' && (
        <Modal title="Cancel this project?" onClose={() => setConfirm(null)}>
          <p className="mb-4 text-sm text-ink-muted">
            <span className="font-semibold text-ink">100% of the materials</span> return, but gold stays sunk and the labor
            applied so far is forfeited.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirm(null)}>
              Keep building
            </Button>
            <Button className="flex-1 bg-ember text-white hover:bg-ember/90" onClick={handleCancel}>
              Cancel project
            </Button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
