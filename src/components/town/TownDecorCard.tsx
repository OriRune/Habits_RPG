// ============================================================================
//  TOWN DECOR CARD — details + removal for a placed decor prop (TOWN-19).
// ============================================================================
//
//  Opens when a decor prop is tapped (no ghost active). Decor was placeable but
//  never removable in the UI — the engine's removeDecor() and the slice's
//  townRemoveDecor() existed with no caller, so a mis-placed prop occupied its
//  cells forever. Shows the prop's name and prestige, and offers Remove behind a
//  confirm dialog (50% of its materials back, gold stays sunk — matching the
//  demolish copy). The success toast compares state before/after (the buyDeed
//  verify idiom) so a refused removal never toasts a lie.
// ============================================================================
import { useState } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { useToastStore } from '@/store/useToastStore';
import { decorAdjacencyBonus } from '@/engine/town';
import { TOWN_DECOR } from '@/content/townDecor';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface Props {
  r: number;
  c: number;
  onClose: () => void;
}

export function TownDecorCard({ r, c, onClose }: Props) {
  const town = useGameStore((s) => s.town);
  const townRemoveDecor = useGameStore((s) => s.townRemoveDecor);
  const pushToast = useToastStore((s) => s.pushToast);
  const [confirm, setConfirm] = useState(false);

  const decor = town.decor.find((d) => d.r === r && d.c === c);
  const def = decor ? TOWN_DECOR[decor.key] : undefined;
  if (!decor || !def) {
    // The prop vanished (e.g. already removed) — nothing to show.
    return null;
  }
  // Props beside a completed building earn +1 prestige (TOWN-08 adjacency rule).
  const adjacency = decorAdjacencyBonus(town, r, c);

  function handleRemove() {
    const before = useGameStore.getState().town.decor.length;
    townRemoveDecor(r, c);
    if (useGameStore.getState().town.decor.length < before) {
      pushToast({ text: `${def!.name} removed — materials returned`, color: '#c2683a' });
    }
    onClose();
  }

  return (
    <Modal title={def.name} onClose={onClose}>
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="rounded-full border border-gold-deep/50 px-2 py-0.5 font-display font-semibold text-gold-deep">
          +{def.prestige + adjacency} prestige
        </span>
        {adjacency > 0 && <span className="text-gold-deep">beside a building +1</span>}
        <span className="text-ink-muted">
          {def.w}×{def.h} decor
        </span>
      </div>
      <Button
        variant="secondary"
        className="min-h-[44px] w-full text-xs text-ember"
        onClick={() => setConfirm(true)}
      >
        Remove
      </Button>

      {confirm && (
        <Modal title={`Remove ${def.name}?`} onClose={() => setConfirm(false)}>
          <p className="mb-4 text-sm text-ink-muted">
            Refunds <span className="font-semibold text-ink">50% of its materials</span> — gold stays sunk. Its
            prestige is lost.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirm(false)}>
              Keep it
            </Button>
            <Button className="flex-1 bg-ember text-white hover:bg-ember/90" onClick={handleRemove}>
              Remove
            </Button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
