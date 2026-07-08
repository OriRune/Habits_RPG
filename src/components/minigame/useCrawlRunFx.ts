// Shared per-frame FX state-diff effect for the crawl minigames (Mine & Forest).
//
// Both overlays diff the previous run snapshot against the current one to spawn
// destruction pops, loot floaters, damage numbers, dash rings, screen shake, and
// hit-flashes — all imperative, none of it game rules. This hook owns that effect
// and the transient VFX state it produces (ARCH-15). The overlays render the
// returned arrays.
//
// Divergences between the two crawlers are config, NOT hardcoded:
//   - unitsOf: mine.monsters vs forest.beasts (normalized to {id,r,c,hp,maxHp}).
//   - tileBreak: which tile transition counts as "harvested" (rock/ore→floor vs
//     node/tree→trail); returns the OLD kind so the sfx bag can pick a sound.
//   - dashColor: mine blue vs forest green dash ring.
//   - lootPopWindow/lootPopTimeout: mine 1400/1450 vs forest 900/950 ms.
//   - sfx: mine plays six sounds inside the effect; forest passes nothing (silent).
//   - statusOf/depthOf: mine-only fields driving the descend/defeat stings.
//   - onPlayerHit: mine uses it to trigger its first-run dash hint (kept in the
//     overlay); forest omits it.

import { useEffect, useRef, useState } from 'react';

export type BreakPop = { key: string; r: number; c: number; at: number };
export type LootPop = { key: string; r: number; c: number; at: number; text: string; color: string };
/** One-shot impact / dash-ring VFX burst rendered inside the world container. */
export type VfxPop = { key: string; r: number; c: number; at: number; anim: string; size: number; color: string };

/** The minimum a unit (monster/beast) must expose for the FX diff. */
export interface CrawlFxUnit {
  id: string;
  r: number;
  c: number;
  hp: number;
  maxHp: number;
}

/** The minimum a run must expose for the FX diff. */
export interface CrawlFxRun {
  player: { r: number; c: number };
  tiles: unknown[][];
  haul: { gold?: number; materials?: Record<string, number> };
  sta: number;
  hp: number;
  lastDashMs: number;
}

/** Extract the concrete tile type from a run so callers get a typed tileBreak. */
type TileOf<Run extends CrawlFxRun> = Run extends { tiles: (infer T)[][] } ? T : unknown;

/** Optional sfx callback bag — mine wires all six, forest passes nothing. */
export interface CrawlFxSfx {
  onBreak?: (kind: string) => void;
  onKill?: () => void;
  onHit?: () => void;
  onPlayerHurt?: () => void;
  onDescend?: () => void;
  onDefeat?: () => void;
}

export interface CrawlRunFxConfig<Run extends CrawlFxRun> {
  moverRefs: React.MutableRefObject<Map<string, HTMLDivElement | null>>;
  playerRef: React.RefObject<HTMLDivElement | null>;
  shake: (mag: number, durMs?: number) => void;
  cell: number;
  /** Material name lookup for loot floaters (getMaterial). */
  materialName: (key: string) => { name?: string; color?: string } | undefined;
  unitsOf: (run: Run) => CrawlFxUnit[];
  /** Returns the OLD tile kind if `tile` is a fresh harvest of `was`, else null. */
  tileBreak: (tile: TileOf<Run>, was: TileOf<Run> | undefined) => string | null;
  dashColor: string;
  lootPopWindow: number;
  lootPopTimeout: number;
  /** Mine-only: run status, for the defeat sting. */
  statusOf?: (run: Run) => string;
  /** Mine-only: current depth/floor, for the descent sting. */
  depthOf?: (run: Run) => number;
  sfx?: CrawlFxSfx;
  /** Mine-only: fired when the player takes damage (drives its first-run hint). */
  onPlayerHit?: () => void;
}

export interface CrawlRunFxState {
  moving: boolean;
  pops: BreakPop[];
  lootPops: LootPop[];
  dmgPops: LootPop[];
  vfxPops: VfxPop[];
  hitAt: number;
}

interface PrevSnap {
  tiles: unknown[][];
  units: CrawlFxUnit[];
  haul: { gold?: number; materials?: Record<string, number> };
  sta: number;
  hp: number;
  lastDashMs: number;
  status?: string;
  depth?: number;
}

export function useCrawlRunFx<Run extends CrawlFxRun>(
  run: Run | null,
  config: CrawlRunFxConfig<Run>,
): CrawlRunFxState {
  const [moving, setMoving] = useState(false);
  const [pops, setPops] = useState<BreakPop[]>([]);
  const [lootPops, setLootPops] = useState<LootPop[]>([]);
  const [dmgPops, setDmgPops] = useState<LootPop[]>([]);
  const [vfxPops, setVfxPops] = useState<VfxPop[]>([]);
  const [hitAt, setHitAt] = useState(0);

  const prevPosRef = useRef<{ r: number; c: number } | null>(null);
  const movingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRef = useRef<PrevSnap | null>(null);

  // Keep the latest config visible to the run-keyed effect without re-firing it
  // (matches the originals, whose closures refreshed on every `mine`/`forest` change).
  const cfgRef = useRef(config);
  cfgRef.current = config;

  useEffect(() => {
    const cfg = cfgRef.current;
    if (!run) { prevRef.current = null; prevPosRef.current = null; return; }

    // Moving detection
    const pos = run.player;
    const prev2 = prevPosRef.current;
    if (prev2 && (prev2.r !== pos.r || prev2.c !== pos.c)) {
      setMoving(true);
      if (movingTimerRef.current) clearTimeout(movingTimerRef.current);
      movingTimerRef.current = setTimeout(() => setMoving(false), 250);
    }
    prevPosRef.current = { r: pos.r, c: pos.c };

    const units = cfg.unitsOf(run);
    const prev = prevRef.current;
    prevRef.current = {
      tiles: run.tiles, units, haul: run.haul, sta: run.sta, hp: run.hp, lastDashMs: run.lastDashMs,
      status: cfg.statusOf?.(run), depth: cfg.depthOf?.(run),
    };
    if (!prev) return;
    const now = Date.now();
    const newPops: BreakPop[] = [];
    let eventPos: { r: number; c: number } | null = null;

    // Harvest / destruction pops. Tile type is opaque inside this generic body,
    // so the typed predicate is erased to unknown at this internal boundary.
    const tileBreak = cfg.tileBreak as (tile: unknown, was: unknown) => string | null;
    run.tiles.forEach((row, r) =>
      row.forEach((tile, c) => {
        const was = prev.tiles[r]?.[c];
        const brokeKind = tileBreak(tile, was);
        if (brokeKind != null) {
          newPops.push({ key: `t-${r}-${c}-${now}`, r, c, at: now });
          eventPos = { r, c };
          cfg.sfx?.onBreak?.(brokeKind);
        }
      }),
    );
    // Unit-killed pops
    const liveIds = new Set(units.map((u) => u.id));
    prev.units.forEach((u) => {
      if (!liveIds.has(u.id)) {
        newPops.push({ key: `m-${u.id}-${now}`, r: u.r, c: u.c, at: now });
        eventPos = { r: u.r, c: u.c };
        cfg.sfx?.onKill?.();
      }
    });
    if (newPops.length > 0) {
      setPops((ps) => [...ps.filter((p) => now - p.at < 550), ...newPops]);
      setTimeout(() => setPops((ps) => ps.filter((p) => Date.now() - p.at < 550)), 600);
    }
    if (eventPos) {
      const pos2 = eventPos as { r: number; c: number };
      const newLootPops: LootPop[] = [];
      const goldDelta = (run.haul.gold ?? 0) - (prev.haul.gold ?? 0);
      if (goldDelta > 0) {
        newLootPops.push({ key: `lg-${now}`, ...pos2, at: now, text: `+${goldDelta} gold`, color: '#e8c860' });
      } else {
        for (const [matKey, val] of Object.entries(run.haul.materials ?? {})) {
          const delta = val - ((prev.haul.materials ?? {})[matKey] ?? 0);
          if (delta > 0) {
            const mat = cfg.materialName(matKey);
            newLootPops.push({
              key: `lm-${now}`, ...pos2, at: now,
              text: `+${delta} ${mat?.name ?? matKey}`,
              color: mat?.color ?? '#f3e7c9',
            });
            break;
          }
        }
      }
      const netSta = run.sta - prev.sta;
      if (netSta > 0) {
        newLootPops.push({ key: `ls-${now}`, ...pos2, at: now, text: `+${netSta} sta`, color: '#22d3ee' });
      }
      if (newLootPops.length > 0) {
        setLootPops((ps) => [...ps.filter((p) => now - p.at < cfg.lootPopWindow), ...newLootPops]);
        setTimeout(() => setLootPops((ps) => ps.filter((p) => Date.now() - p.at < cfg.lootPopWindow)), cfg.lootPopTimeout);
      }
    }

    // --- Phase 6: Combat damage floaters + screen shake ---
    const newDmgPops: LootPop[] = [];
    const newVfxPops: VfxPop[] = [];

    // Unit HP diffs — emit a damage number and flash the entity element.
    const unitSnap = new Map(prev.units.map((u) => [u.id, u]));
    for (const u of units) {
      const was = unitSnap.get(u.id);
      if (was && u.hp < was.hp) {
        const dmg = was.hp - u.hp;
        const isHeavy = dmg >= was.maxHp * 0.35;
        newDmgPops.push({
          key: `dmg-${u.id}-${now}`,
          r: u.r, c: u.c, at: now,
          text: `-${Math.round(dmg)}`,
          color: isHeavy ? '#fbbf24' : '#f87171',
        });
        cfg.sfx?.onHit?.();
        // Flash the entity element directly — avoids a re-render.
        const el = cfg.moverRefs.current.get(u.id);
        if (el) {
          el.classList.add('crawler-hit-flash');
          setTimeout(() => el.classList.remove('crawler-hit-flash'), 220);
        }
        if (isHeavy) cfg.shake(5, 220);
      }
    }

    // Player took damage → red floater + vignette + shake.
    if (run.hp < prev.hp) {
      const dmg = prev.hp - run.hp;
      newDmgPops.push({
        key: `pdmg-${now}`,
        r: run.player.r, c: run.player.c, at: now,
        text: `-${Math.round(dmg)}`,
        color: '#f87171',
      });
      setHitAt(now);
      cfg.shake(8, 300);
      cfg.sfx?.onPlayerHurt?.();
      if (cfg.playerRef.current) {
        cfg.playerRef.current.classList.add('crawler-hit-flash');
        setTimeout(() => cfg.playerRef.current?.classList.remove('crawler-hit-flash'), 220);
      }
      cfg.onPlayerHit?.();
    }

    // Player healed.
    if (run.hp > prev.hp && prev.hp > 0) {
      const heal = run.hp - prev.hp;
      newDmgPops.push({
        key: `heal-${now}`,
        r: run.player.r, c: run.player.c, at: now,
        text: `+${Math.round(heal)}`,
        color: '#34d399',
      });
    }

    // Depth changed → descent sting (mine-only).
    if (cfg.depthOf && cfg.depthOf(run) > (prev.depth ?? 0)) cfg.sfx?.onDescend?.();
    // Run ended → defeat sting (mine-only).
    if (cfg.statusOf && cfg.statusOf(run) === 'ended' && prev.status !== 'ended') cfg.sfx?.onDefeat?.();

    // Dash fired → light shake + expanding ring.
    if (run.lastDashMs !== prev.lastDashMs && run.lastDashMs > 0) {
      cfg.shake(4, 180);
      newVfxPops.push({
        key: `dash-${now}`,
        r: run.player.r, c: run.player.c, at: now,
        anim: 'arena-cast 0.4s ease-out forwards',
        size: Math.round(cfg.cell * 1.1),
        color: cfg.dashColor,
      });
    }

    if (newDmgPops.length > 0) {
      setDmgPops((ps) => [...ps.filter((p) => now - p.at < 850), ...newDmgPops]);
      setTimeout(() => setDmgPops((ps) => ps.filter((p) => Date.now() - p.at < 850)), 900);
    }
    if (newVfxPops.length > 0) {
      setVfxPops((ps) => [...ps.filter((p) => now - p.at < 500), ...newVfxPops]);
      setTimeout(() => setVfxPops((ps) => ps.filter((p) => Date.now() - p.at < 500)), 550);
    }
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps

  return { moving, pops, lootPops, dmgPops, vfxPops, hitAt };
}
