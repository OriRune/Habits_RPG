import { useMemo, useState } from 'react';
import { Home, Sparkles, Hammer, Check, RotateCw, X } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { useToastStore } from '@/store/useToastStore';
import { selectTownPrestige } from '@/store/selectors';
import { TOWN_LABOR_DAILY_CAP, TOWN_BUILDINGS } from '@/content/townBuildings';
import { TOWN_DECOR } from '@/content/townDecor';
import { canPlace, gridSizeFor, inUnlockedLand, occupancy } from '@/engine/town';
import { TownCanvas, type TownGhost } from '@/components/town/TownCanvas';
import { TownBuildPanel } from '@/components/town/TownBuildPanel';
import { TownBuildingCard } from '@/components/town/TownBuildingCard';

/** Placement mode: a ghost footprint the player nudges with taps before committing. */
type Placement =
  | { mode: 'build'; key: string; r: number; c: number; rot: 0 | 1 }
  | { mode: 'decor'; key: string; r: number; c: number }
  | { mode: 'move'; buildingId: string; key: string; r: number; c: number; rot: 0 | 1 };

/** Centre a w×h footprint inside the currently-unlocked square. */
function startAnchor(deeds: number, w: number, h: number): { r: number; c: number } {
  const { rows, cols } = gridSizeFor(deeds);
  return {
    r: Math.max(0, Math.min(rows - h, Math.floor((rows - h) / 2))),
    c: Math.max(0, Math.min(cols - w, Math.floor((cols - w) / 2))),
  };
}

/** Decor / move validity: every footprint cell unlocked (bounds + deed) and unoccupied. */
function footprintOk(
  town: ReturnType<typeof useGameStore.getState>['town'],
  r: number,
  c: number,
  w: number,
  h: number,
  excludeId?: string,
): boolean {
  const occ = occupancy(town, excludeId);
  for (let dr = 0; dr < h; dr++) {
    for (let dc = 0; dc < w; dc++) {
      if (!inUnlockedLand(town.deeds, r + dr, c + dc)) return false;
      if (occ.has(`${r + dr},${c + dc}`)) return false;
    }
  }
  return true;
}

const PLACE_REASON: Record<string, string> = {
  bounds: 'Out of bounds',
  locked: 'Locked land — buy a deed',
  occupied: 'Space is occupied',
  unique: 'Already built',
  prestige: 'Prestige too low',
  queue_full: 'Build queue is full',
};

/**
 * The Homestead (M4): the isometric renderer plus the full build/placement UX —
 * a bottom-sheet palette, a tap-to-nudge placement ghost with Confirm/Rotate/Cancel,
 * building cards (upgrade/move/demolish), and the pure-gold deed sink. The renderer
 * still reads only the town payload so a future party-visit can reuse it verbatim.
 */
export function TownView() {
  const town = useGameStore((s) => s.town);
  const gold = useGameStore((s) => s.character.gold);
  const materials = useGameStore((s) => s.materials);
  const unlimitedGold = useGameStore((s) => s.settings.unlimitedGold);
  const prestige = useGameStore(selectTownPrestige);
  const townQueueBuild = useGameStore((s) => s.townQueueBuild);
  const townPlaceDecor = useGameStore((s) => s.townPlaceDecor);
  const townMoveBuilding = useGameStore((s) => s.townMoveBuilding);
  const townBuyDeed = useGameStore((s) => s.townBuyDeed);
  const pushToast = useToastStore((s) => s.pushToast);

  const [panelOpen, setPanelOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);

  const wallet = useMemo(() => ({ gold, materials, unlimitedGold }), [gold, materials, unlimitedGold]);

  // Ghost footprint + validity, recomputed as the ghost is nudged.
  const { ghost, reason, rotatable } = useMemo((): {
    ghost: TownGhost | null;
    reason: string | null;
    rotatable: boolean;
  } => {
    if (!placement) return { ghost: null, reason: null, rotatable: false };
    if (placement.mode === 'decor') {
      const def = TOWN_DECOR[placement.key];
      const ok = footprintOk(town, placement.r, placement.c, def.w, def.h);
      return {
        ghost: { r: placement.r, c: placement.c, w: def.w, h: def.h, ok },
        reason: ok ? null : 'Space is occupied or locked',
        rotatable: false,
      };
    }
    const def = TOWN_BUILDINGS[placement.key];
    if (placement.mode === 'move') {
      const ok = footprintOk(town, placement.r, placement.c, def.w, def.h, placement.buildingId);
      return {
        ghost: { r: placement.r, c: placement.c, w: def.w, h: def.h, ok },
        reason: ok ? null : 'Space is occupied or locked',
        rotatable: !!def.rotatable,
      };
    }
    const res = canPlace(town, def, placement.r, placement.c, placement.rot);
    return {
      ghost: { r: placement.r, c: placement.c, w: def.w, h: def.h, ok: res.ok },
      reason: res.ok ? null : PLACE_REASON[res.reason] ?? 'Cannot place here',
      rotatable: !!def.rotatable,
    };
  }, [placement, town]);

  const placingName =
    placement?.mode === 'decor'
      ? TOWN_DECOR[placement.key]?.name
      : placement
        ? TOWN_BUILDINGS[placement.key]?.name
        : '';

  function pickBuilding(key: string) {
    const def = TOWN_BUILDINGS[key];
    if (!def) return;
    const { r, c } = startAnchor(town.deeds, def.w, def.h);
    setPanelOpen(false);
    setPlacement({ mode: 'build', key, r, c, rot: 0 });
  }

  function pickDecor(key: string) {
    const def = TOWN_DECOR[key];
    if (!def) return;
    const { r, c } = startAnchor(town.deeds, def.w, def.h);
    setPanelOpen(false);
    setPlacement({ mode: 'decor', key, r, c });
  }

  function startMove(buildingId: string) {
    const b = town.buildings.find((x) => x.id === buildingId);
    if (!b) return;
    setPlacement({ mode: 'move', buildingId, key: b.key, r: b.r, c: b.c, rot: b.rot ?? 0 });
  }

  function nudgeGhost(r: number, c: number) {
    setPlacement((p) => (p ? { ...p, r, c } : p));
  }

  function rotateGhost() {
    setPlacement((p) => (p && p.mode !== 'decor' ? { ...p, rot: p.rot === 1 ? 0 : 1 } : p));
  }

  function confirmPlacement() {
    if (!placement || !ghost?.ok) return;
    if (placement.mode === 'build') {
      const def = TOWN_BUILDINGS[placement.key];
      townQueueBuild(placement.key, placement.r, placement.c, def.rotatable ? placement.rot : undefined);
      pushToast({ text: `${def.name} queued`, color: '#e8b923' });
    } else if (placement.mode === 'decor') {
      townPlaceDecor(placement.key, placement.r, placement.c);
      pushToast({ text: `${TOWN_DECOR[placement.key].name} placed`, color: '#e8b923' });
    } else {
      const def = TOWN_BUILDINGS[placement.key];
      townMoveBuilding(placement.buildingId, placement.r, placement.c, def.rotatable ? placement.rot : undefined);
      pushToast({ text: 'Building moved', color: '#e8b923' });
    }
    setPlacement(null);
  }

  function buyDeed() {
    const before = town.deeds;
    townBuyDeed();
    const after = useGameStore.getState().town.deeds;
    if (after > before) pushToast({ text: `District ${after} unlocked!`, color: '#e8b923' });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-md texture-wood border border-gold-deep/60 text-gold-bright">
          <Home className="h-6 w-6" />
        </span>
        <div>
          <div className="font-display text-xl font-bold text-gold-bright">The Homestead</div>
          <div className="text-sm text-on-wood-mid">
            Your persistent home base — raised by the habits you keep.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-2 texture-parchment rounded-md border border-gold-deep/40 p-3">
          <Sparkles className="h-4 w-4 shrink-0 text-gold-deep" />
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-muted">Prestige</div>
            <div className="font-display font-bold text-ink">{prestige}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 texture-parchment rounded-md border border-gold-deep/40 p-3">
          <Hammer className="h-4 w-4 shrink-0 text-ember" />
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-muted">Labor bank</div>
            <div className="font-display font-bold text-ink">{town.laborBank} 🔨</div>
          </div>
        </div>
        <div className="col-span-2 flex items-center gap-2 texture-parchment rounded-md border border-gold-deep/40 p-3 sm:col-span-1">
          <Hammer className="h-4 w-4 shrink-0 text-ink-light" />
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-muted">Labor today</div>
            <div className="font-display font-bold text-ink">
              {town.laborToday}/{TOWN_LABOR_DAILY_CAP}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gold-deep/30 bg-wood-800/60 shadow-wood">
        <TownCanvas
          town={town}
          ghost={ghost}
          onCellTap={placement ? nudgeGhost : undefined}
          onBuildingTap={placement ? undefined : setCardId}
        />
      </div>

      {!placement && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-gradient-to-b from-gold-bright to-gold-deep px-5 font-display text-sm font-semibold text-wood-900 shadow-gold"
          >
            <Hammer className="h-4 w-4" /> {panelOpen ? 'Close' : 'Build & Decorate'}
          </button>
          <p className="mt-2 text-xs text-on-wood-dim">Drag to pan · pinch or scroll to zoom · tap a building to manage it.</p>
        </div>
      )}

      {/* Build palette (hidden during placement) */}
      {panelOpen && !placement && (
        <TownBuildPanel
          town={town}
          wallet={wallet}
          onPickBuilding={pickBuilding}
          onPickDecor={pickDecor}
          onBuyDeed={buyDeed}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {/* Placement action bar */}
      {placement && (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-3xl">
          <div className="texture-parchment flex items-center gap-2 border-t-2 border-gold-deep/60 px-3 py-2 shadow-gold">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">Place {placingName}</div>
              <div className="truncate text-[11px] text-ink-muted">
                {reason ? <span className="text-ember">{reason}</span> : 'Tap a tile to move · then Confirm'}
              </div>
            </div>
            {rotatable && (
              <button
                type="button"
                onClick={rotateGhost}
                aria-label="Rotate"
                className="flex h-11 w-11 items-center justify-center rounded-md texture-wood border border-gold-deep/70 text-on-wood"
              >
                <RotateCw className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setPlacement(null)}
              aria-label="Cancel placement"
              className="flex h-11 w-11 items-center justify-center rounded-md texture-wood border border-gold-deep/70 text-ember"
            >
              <X className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={confirmPlacement}
              disabled={!ghost?.ok}
              aria-label="Confirm placement"
              className="flex h-11 items-center gap-1.5 rounded-md bg-gradient-to-b from-gold-bright to-gold-deep px-4 font-display text-sm font-semibold text-wood-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="h-5 w-5" /> Confirm
            </button>
          </div>
        </div>
      )}

      {/* Building management card */}
      {cardId && !placement && (
        <TownBuildingCard buildingId={cardId} onMove={startMove} onClose={() => setCardId(null)} />
      )}
    </div>
  );
}
