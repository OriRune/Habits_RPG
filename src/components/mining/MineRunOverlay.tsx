import { useState, useEffect, useRef } from 'react';
import { Heart, Flame, Coins, ChevronsDown, LogOut, Gem, Sparkles } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { useMiningLoop } from '@/hooks/useMiningLoop';
import {
  canDescend,
  facedCell,
  findTombstone,
  sightRadiusFor,
  isMineSafeBankTile,
  MINE_DEATH_KEEP,
  MINE_STASH_KEEP,
  MINE_TOMBSTONE_RECOVER_KEEP,
  MINE_ARCHETYPE_NAMES,
  RICH_VEIN_WINDOW_MS,
  GUARDIAN_SPECIAL_BLAST_RADIUS,
  type MineTileKind,
} from '@/engine/mining';
import { cameraWindow, VIEW, splitHaul } from '@/engine/crawl';
import { bandForFloor, type CrawlPalette } from '@/engine/crawlBiomes';
import { useSmoothCamera, type SmoothCameraLayout } from '@/hooks/useSmoothCamera';
import { MINE_ORES, MINE_MONSTERS, MINE_AFFIXES } from '@/content/mining';
import { BOONS } from '@/content/boons';
import { mineRockSprite, mineFloorTile, mineOreSprite, mineMaterialIcon, cellHash } from '@/lib/minigameArt';
import { getMaterial } from '@/engine/materials';
import { toISODate } from '@/engine/date';
import { MINE_DAILY_BONUS_FLOORS, MINE_DAILY_BONUS_MULT } from '@/store/commit';
import * as sfx from '@/lib/sfx';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { FitToWidth } from '@/components/ui/FitToWidth';
import { clientToTile, createTapTracker } from '@/components/minigame/boardTap';
import { cn } from '@/lib/cn';
import type { Reward } from '@/engine/challenges';
import { MineControls } from './MineControls';
import { guardianArt } from './GuardianArt';
import { CrawlerAvatar } from '@/components/minigame/CrawlerAvatar';
import { CrawlGauge } from '@/components/minigame/CrawlGauge';
import { RemoteCrawlers } from '@/components/minigame/RemoteCrawlers';
import { BoonChoicePanel } from '@/components/minigame/BoonChoicePanel';
import { useCrawlRunFx } from '@/components/minigame/useCrawlRunFx';
import { rewardChips } from '@/components/minigame/HaulChips';
import { CrawlSpellBar } from '@/components/minigame/CrawlSpellBar';
import { StreakBonusChip } from '@/components/character/StreakBonusChip';
import { useCoopStore } from '@/net/coop/session';
import { useAuthStore } from '@/net/auth';
import { usePartyStore } from '@/hooks/useParty';
import { CoopToasts } from '@/components/minigame/CoopToasts';

const CELL = 52;
/** Desktop upscale cap for the board + HUD column (sizing plan Phase 1). */
const BOARD_MAX_SCALE = 1.5;
const MARGIN = 1;
const RENDER_VIEW = VIEW + 2 * MARGIN;

/** Per-cell floor background with decal variety. Palette drives the base colour. */
function floorStyle(r: number, c: number, palette: CrawlPalette): React.CSSProperties {
  const j1 = cellHash(r * 3 + 1, c * 3 + 2);
  const j2 = cellHash(r + 11, c + 5);
  const j3 = cellHash(r + 3, c + 8);
  const tint = 0.88 + 0.22 * cellHash(r, c);
  const [fr, fg, fb] = palette.floor;
  const base  = Math.round(fr * tint);
  const baseG = Math.round(fg * tint);
  const baseB = Math.round(fb * tint);

  let extra = '';
  if (j1 < 0.12) {
    // Crack streak
    const ang = Math.floor(j2 * 120) + 30;
    extra = `linear-gradient(${ang}deg, transparent 44%, rgba(0,0,0,0.28) 46%, rgba(0,0,0,0.28) 54%, transparent 56%),`;
  } else if (j1 < 0.24) {
    // Pebble cluster
    const px = Math.floor(j2 * 70) + 15;
    const py = Math.floor(j3 * 70) + 15;
    extra = `radial-gradient(circle at ${px}% ${py}%, rgba(80,60,40,0.55) 0%, transparent 18%),`;
  } else if (j1 < 0.34) {
    // Mineral speck
    const px = Math.floor(j3 * 60) + 20;
    const py = Math.floor(j2 * 60) + 20;
    extra = `radial-gradient(circle at ${px}% ${py}%, rgba(140,120,90,0.40) 0%, transparent 12%),`;
  }

  return {
    backgroundColor: `rgb(${base},${baseG},${baseB})`,
    backgroundImage:
      extra +
      'radial-gradient(circle at 50% 50%, rgba(60,44,26,0.28) 0%, transparent 68%)',
  };
}

/** Rock tile style — richer variation so walls look craggy. Palette drives the base colour. */
function rockStyle(r: number, c: number, palette: CrawlPalette): React.CSSProperties {
  const j = cellHash(r, c);
  const m = 0.78 + 0.36 * j;
  const jc = cellHash(r + 5, c + 3);
  const [rr, rg, rb] = palette.rock;
  const R = Math.round(Math.min(255, rr * m));
  const G = Math.round(Math.min(255, rg * m));
  const B = Math.round(Math.min(255, rb * m));
  const cragX = Math.floor(jc * 80) + 10;
  const cragY = Math.floor(cellHash(r + 2, c + 7) * 80) + 10;
  return {
    backgroundColor: `rgb(${R},${G},${B})`,
    backgroundImage:
      `radial-gradient(circle at ${cragX}% ${cragY}%, rgba(255,255,255,0.07) 0%, transparent 38%),` +
      'repeating-linear-gradient(135deg, rgba(0,0,0,0.20) 0px, rgba(0,0,0,0.20) 1px, transparent 1px, transparent 5px),' +
      'repeating-linear-gradient(45deg, rgba(0,0,0,0.10) 0px, rgba(0,0,0,0.10) 1px, transparent 1px, transparent 8px)',
  };
}

/**
 * Tile-kind render registry (2.2) — kinds with a simple band-tinted-but-otherwise-static
 * background read from here instead of a `tile.kind === 'x' ? ... : tile.kind === 'y' ...`
 * chain, so a new tile kind (hazard tiles, a mother-lode vault — Phase 3) is one entry here
 * instead of an edit threaded through the chain. `floor`/`ore` stay bespoke below — they
 * need extra per-cell context (sprite lookups, the ore def) beyond just (r, c, palette).
 */
const MINE_TILE_STYLE: Partial<Record<MineTileKind, (r: number, c: number, palette: CrawlPalette) => React.CSSProperties>> = {
  bedrock: () => ({
    backgroundColor: '#0c0803',
    backgroundImage:
      'repeating-linear-gradient(45deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 8px)',
  }),
  rock: rockStyle,
  shaft: (_r, _c, palette) => ({
    backgroundColor: '#0d1e28',
    backgroundImage: `radial-gradient(circle at 50% 50%, ${palette.accent}55 0%, rgba(0,200,230,0.10) 55%, transparent 80%), repeating-linear-gradient(45deg, rgba(0,180,210,0.06) 0px, rgba(0,180,210,0.06) 1px, transparent 1px, transparent 6px)`,
  }),
  boon: () => ({
    backgroundColor: '#3a2a00',
    backgroundImage: 'radial-gradient(circle at 50% 45%, rgba(255,215,0,0.28) 0%, transparent 65%)',
    animation: 'mine-boon-pulse 2s ease-in-out infinite',
  }),
  tombstone: () => ({
    backgroundColor: '#1c1c2e',
    backgroundImage: 'radial-gradient(circle at 50% 45%, rgba(180,160,255,0.22) 0%, transparent 65%)',
    animation: 'mine-boon-pulse 2.8s ease-in-out infinite',
  }),
  // 3.3 band hazard tiles — frozen band's ice_slide, magma band's lava_dot.
  ice_slide: () => ({
    backgroundColor: '#0e2c3e',
    backgroundImage:
      'linear-gradient(120deg, rgba(180,235,255,0.30) 0%, transparent 35%, transparent 65%, rgba(180,235,255,0.20) 100%), radial-gradient(circle at 50% 50%, rgba(140,220,255,0.18) 0%, transparent 70%)',
  }),
  lava_dot: () => ({
    backgroundColor: '#3a0e02',
    backgroundImage: 'radial-gradient(circle at 50% 55%, rgba(255,110,20,0.45) 0%, rgba(255,60,0,0.18) 55%, transparent 80%)',
    animation: 'mine-boon-pulse 1.4s ease-in-out infinite',
  }),
  // 3.4 mother lode vault — a rare high-durability node, glows to read as special at a glance.
  vault: () => ({
    backgroundColor: '#2a1c3a',
    backgroundImage: 'radial-gradient(circle at 50% 45%, rgba(200,120,255,0.40) 0%, rgba(140,60,255,0.16) 55%, transparent 78%)',
    animation: 'mine-boon-pulse 1.8s ease-in-out infinite',
  }),
  // 3.5 timed rich vein — urgent green glow, pulses faster than the other specials to
  // read as "grab this now" at a glance.
  rich_vein: () => ({
    backgroundColor: '#0e3a1c',
    backgroundImage: 'radial-gradient(circle at 50% 45%, rgba(120,255,150,0.40) 0%, rgba(60,220,110,0.18) 55%, transparent 78%)',
    animation: 'mine-boon-pulse 0.9s ease-in-out infinite',
  }),
};

/** Static per-kind icon (no ore/rock sprite lookup involved). Paired with MINE_TILE_STYLE. */
const MINE_TILE_ICON: Partial<Record<MineTileKind, React.ReactNode>> = {
  shaft: <ChevronsDown className="h-7 w-7 text-cyan-300" style={{ animation: 'mine-shaft-pulse 1.6s ease-in-out infinite' }} />,
  entrance: <span className="text-[20px] text-gold-bright">◇</span>,
  boon: <span className="text-[22px] leading-none" style={{ filter: 'drop-shadow(0 0 6px rgba(255,200,0,0.9))' }}>🎁</span>,
  tombstone: <span className="text-[22px] leading-none" style={{ filter: 'drop-shadow(0 0 8px rgba(180,140,255,0.85))' }}>🪦</span>,
  ice_slide: <span className="text-[16px] leading-none" style={{ filter: 'drop-shadow(0 0 4px rgba(160,225,255,0.8))' }}>❄</span>,
  lava_dot: <Flame className="h-5 w-5 text-orange-400" style={{ filter: 'drop-shadow(0 0 5px rgba(255,100,0,0.8))' }} />,
  vault: <Gem className="h-6 w-6 text-fuchsia-300" style={{ filter: 'drop-shadow(0 0 7px rgba(220,140,255,0.9))' }} />,
  rich_vein: <Sparkles className="h-6 w-6 text-emerald-300" style={{ filter: 'drop-shadow(0 0 7px rgba(120,255,150,0.9))' }} />,
};

/** Equipped pickaxe tier (4.2) — mirrors src/content/gear.ts's mining.power values
 *  (stone_pickaxe 1, iron_pickaxe 2, mithril_pickaxe 3) for the avatar's tool color. */
function pickaxeTier(power: number): 'stone' | 'iron' | 'mithril' | undefined {
  if (power >= 3) return 'mithril';
  if (power === 2) return 'iron';
  if (power === 1) return 'stone';
  return undefined;
}

function OreIcon({ oreKey, color }: { oreKey: string; color: string }) {
  if (oreKey === 'gold_vein') return <Coins className="h-6 w-6" style={{ color }} />;
  if (oreKey === 'vigor_crystal') return <Flame className="h-6 w-6" style={{ color }} />;
  if (oreKey === 'crystal_node' || oreKey === 'gemstone_node') return <Gem className="h-6 w-6" style={{ color }} />;
  const ore = MINE_ORES[oreKey];
  return <span style={{ color }}>{ore?.glyph ?? '?'}</span>;
}

/**
 * Renders one haul material entry — an ore icon (if available) or a colored name chip,
 * followed by the quantity. Reused in the HUD tally, banking overlay, and death overlay.
 */
function HaulMat({ matKey, qty }: { matKey: string; qty: number }) {
  const mat = getMaterial(matKey);
  const icon = mineMaterialIcon(matKey);
  return (
    <span className="flex items-center gap-1 text-parchment-200">
      {icon
        ? <img src={icon} alt={mat?.name ?? matKey} title={mat?.name ?? matKey} className="h-4 w-4 object-contain image-pixel" />
        : <span className="inline-block h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: mat?.color ?? '#8b7355' }} />
      }
      {!icon && <span className="text-parchment-300/80">{mat?.name ?? matKey}</span>}
      ×{qty}
    </span>
  );
}

/**
 * End-of-run summary card — a parchment scroll floating over the dimmed canvas
 * (the board stays visible behind so the player can see where the run ended).
 * accent 'gold' frames the voluntary bank; 'ember' frames a death. Mirrors the
 * same structure in ForestRunOverlay so both crawlers end on the same beat.
 */
function EndOfRunPanel({ accent, children }: { accent: 'gold' | 'ember'; children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center rounded-md bg-black/60 p-4">
      <div
        className={cn(
          'texture-parchment flex w-full max-w-xs flex-col items-center gap-2.5 rounded-md border-2 p-4 text-center',
          accent === 'ember'
            ? 'border-ember/80 shadow-[0_0_24px_rgba(156,58,37,0.45),0_8px_28px_rgba(0,0,0,0.65)]'
            : 'border-gold-deep/80 shadow-[0_0_24px_rgba(201,162,39,0.35),0_8px_28px_rgba(0,0,0,0.65)]',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** One side of the kept/lost ledger — material-colored dots with ink labels, readable on parchment. */
function HaulLedger({ reward, empty, lost }: { reward: Reward; empty: string; lost?: boolean }) {
  const chips = rewardChips(reward);
  if (chips.length === 0) return <span className="text-sm italic text-ink-light">{empty}</span>;
  return (
    <>
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={cn(
            'flex items-center gap-1.5 whitespace-nowrap text-sm',
            lost ? 'text-ink-light line-through' : 'text-ink',
          )}
        >
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full ring-1 ring-black/25"
            style={{ backgroundColor: chip.color }}
          />
          {chip.label}
        </span>
      ))}
    </>
  );
}

export function MineRunOverlay() {
  const controls = useMiningLoop();
  const mine = useGameStore((s) => s.mining);
  const endMining = useGameStore((s) => s.endMining);
  const beginBanking = useGameStore((s) => s.beginBanking);
  const mineDescend = useGameStore((s) => s.mineDescend);
  const chooseMineBoon = useGameStore((s) => s.chooseMineBoon);
  const skipMineBoon = useGameStore((s) => s.skipMineBoon);
  const deepestMineFloor = useGameStore((s) => s.deepestMineFloor);
  const isFirstRun = deepestMineFloor === 0;
  const habitBonus = useGameStore((s) => s.character.habitBonus);
  const mineTombstone = useGameStore((s) => s.mineTombstone);
  const mineDailyBonus = useGameStore((s) => s.mineDailyBonus);
  const remotePlayers = useCoopStore((s) => s.remotePlayers);
  const coopSession = useCoopStore((s) => s.session);
  const coopJoined = useCoopStore((s) => s.joined);
  const partyMembers = usePartyStore((s) => s.members);
  const myId = useAuthStore((s) => s.session?.user?.id);
  // Prefer the authoritative party-roster name (every client has it), fall back to
  // the player's self-reported broadcast name.
  const nameFor = (userId: string, fallback: string) =>
    partyMembers.find((m) => m.user_id === userId)?.username ?? fallback;
  // In co-op the host leads the descent; guests follow via the world slice and
  // can't change the floor themselves.
  const isCoopGuest = coopJoined && !!coopSession && coopSession.host_id !== myId;

  // Smooth-camera refs
  const worldRef = useRef<HTMLDivElement>(null);
  // Tap-to-act: the board frame anchors the client→tile inversion (scale via its rect).
  const boardFrameRef = useRef<HTMLDivElement>(null);
  const tapTracker = useRef(createTapTracker());
  const playerRef = useRef<HTMLDivElement | null>(null);
  const moverRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const layoutRef = useRef<SmoothCameraLayout>({
    baseR0: 0, baseC0: 0, playerR: 0, playerC: 0, rows: 33, cols: 33,
    movers: [], snapKey: 0,
  });
  const { shake } = useSmoothCamera(worldRef, playerRef, moverRefs, layoutRef, { CELL, VIEW });

  // Charge bar — updated imperatively each rAF frame to avoid React re-renders + layout shift.
  const chargeBarRef = useRef<HTMLDivElement>(null);
  // Avatar tool group — 4.2's swing keyframe is toggled on this directly (no re-render).
  const toolRef = useRef<HTMLDivElement>(null);
  const lastSwingSeenRef = useRef(0);
  useEffect(() => {
    let rafId: number;
    const tick = () => {
      const c = controls.chargeRef.current;
      const el = chargeBarRef.current;
      if (el) {
        const p = c.active && c.max > 0 ? c.swings / c.max : 0;
        el.style.width = `${Math.round(p * 100)}%`;
        el.style.opacity = c.active && p > 0.04 ? '1' : '0';
      }
      const swingAt = controls.swingAtRef.current;
      if (swingAt > lastSwingSeenRef.current) {
        lastSwingSeenRef.current = swingAt;
        const toolEl = toolRef.current;
        if (toolEl) {
          toolEl.classList.remove('crawler-swing-anim');
          void toolEl.offsetWidth; // reflow — restarts the keyframe on rapid re-swings
          toolEl.classList.add('crawler-swing-anim');
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // First-run hint system — each hint shows once per mount; auto-dismisses after 5 s.
  const [activeHint, setActiveHint] = useState<string | null>(null);
  const hintFiredRef = useRef<Set<string>>(new Set());
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shaftWasOffscreenRef = useRef(false);
  /** Gates the shaft compass badge (0.11) — no arrow to a shaft the player hasn't seen yet. */
  const shaftSightedRef = useRef(false);

  const [wipeAt, setWipeAt] = useState(0);
  const floorMountRef = useRef(false);

  // Shared state-diff FX (destruction pops, loot/damage floaters, dash rings, shake).
  // Mine wires all six SFX sites and the mine-only descent/defeat stings; onPlayerHit
  // drives the first-run dash hint (kept here, out of the shared hook).
  const { moving, pops, lootPops, dmgPops, vfxPops, hitAt } = useCrawlRunFx(mine ?? null, {
    moverRefs, playerRef, shake, cell: CELL,
    materialName: getMaterial,
    unitsOf: (m) => m.monsters,
    tileBreak: (tile, was) =>
      tile.kind === 'floor' && (was?.kind === 'rock' || was?.kind === 'ore') ? was.kind : null,
    dashColor: 'rgba(100,200,255,0.75)',
    lootPopWindow: 1400,
    lootPopTimeout: 1450,
    statusOf: (m) => m.status,
    depthOf: (m) => m.floor,
    sfx: {
      onBreak: (kind) => sfx.play(kind === 'ore' ? 'mineOreBreak' : 'mineRockBreak'),
      onKill: () => sfx.play('enemyDeath'),
      onHit: () => sfx.play('swing'),
      onPlayerHurt: () => sfx.play('playerHurt'),
      onDescend: () => sfx.play('mineDescent'),
      onDefeat: () => sfx.play('defeat'),
    },
    onPlayerHit: () => {
      // First-run hint: explain dash on first hit
      if (isFirstRun && !hintFiredRef.current.has('damage')) {
        hintFiredRef.current.add('damage');
        if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
        setActiveHint('Hold [Shift] to dash — you\'re briefly immune while dashing.');
        hintTimerRef.current = setTimeout(() => setActiveHint(null), 5500);
      }
    },
  });

  // Phase 6: floor-change wipe (skip first mount).
  useEffect(() => {
    if (!floorMountRef.current) { floorMountRef.current = true; return; }
    setWipeAt(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine?.floor]);

  // 0.11: a new floor's shaft hasn't been seen yet — the compass badge stays hidden
  // until the player actually spots it, rather than pointing at it from the start.
  useEffect(() => {
    shaftSightedRef.current = false;
  }, [mine?.floor]);

  useEffect(() => {
    if (!mine || shaftSightedRef.current) return;
    const sp = mine.shaftPos;
    if (!sp) return;
    const { r0, c0 } = cameraWindow(mine.player, mine.rows, mine.cols);
    const inViewport = sp.r >= r0 && sp.r < r0 + VIEW && sp.c >= c0 && sp.c < c0 + VIEW;
    if (inViewport) shaftSightedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine?.player.r, mine?.player.c, mine?.floor]);

  // Shaft visibility hint — fires once when the shaft first enters the viewport.
  // Can't use the shaftDir derived variable (declared after the mine null-guard),
  // so we recompute viewport inclusion here from raw mine state.
  useEffect(() => {
    if (!isFirstRun || hintFiredRef.current.has('shaft') || !mine) return;
    const sp = mine.shaftPos;
    if (!sp) return;
    const { r0, c0 } = cameraWindow(mine.player, mine.rows, mine.cols);
    const inViewport = sp.r >= r0 && sp.r < r0 + VIEW && sp.c >= c0 && sp.c < c0 + VIEW;
    if (!inViewport) {
      shaftWasOffscreenRef.current = true;
    } else if (shaftWasOffscreenRef.current) {
      hintFiredRef.current.add('shaft');
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      setActiveHint('Shaft spotted! Step on it and press [Space] to descend deeper.');
      hintTimerRef.current = setTimeout(() => setActiveHint(null), 5500);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine?.player.r, mine?.player.c, mine?.floor, isFirstRun]);

  // Guardian encounter banner — one-shot per floor entry when a guardian is present.
  const [guardianAlertAt, setGuardianAlertAt] = useState(0);
  const guardianAlertFloorRef = useRef(-1);
  useEffect(() => {
    if (!mine) return;
    const hasGuardian = mine.monsters.some((m) => MINE_MONSTERS[m.key]?.isGuardian);
    if (hasGuardian && guardianAlertFloorRef.current !== mine.floor) {
      guardianAlertFloorRef.current = mine.floor;
      setGuardianAlertAt(Date.now());
      sfx.play('mineGuardianAlert');
      setTimeout(() => setGuardianAlertAt(0), 3000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine?.floor]);

  // Biome ambient audio — stop on unmount.
  useEffect(() => {
    return () => { sfx.stopMineAmbient(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cross-fade ambient when band changes (rocky → frozen → magma).
  useEffect(() => {
    if (!mine) return;
    sfx.startMineAmbient(bandForFloor(mine.floor).id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine?.floor]);

  if (!mine) return null;

  const band = bandForFloor(mine.floor);
  /** Sight radius for fog of war — base + Lantern boon bonus. */
  const sightR = sightRadiusFor(mine);
  const dead = mine.status === 'ended';
  const onShaft = canDescend(mine);
  const faced = facedCell(mine);
  const haulMats = Object.entries(mine.haul.materials ?? {}).filter(([, n]) => n > 0);

  const { r0, c0 } = cameraWindow(mine.player, mine.rows, mine.cols);
  const baseR0 = Math.max(0, r0 - MARGIN);
  const baseC0 = Math.max(0, c0 - MARGIN);

  // Board size — clamped to the map when it's smaller than the fixed view window,
  // so a small floor doesn't leave a dead black band inside the canvas.
  const boardW = Math.min(VIEW, mine.cols) * CELL;
  const boardH = Math.min(VIEW, mine.rows) * CELL;

  // Desktop upscale (sizing plan Phase 1): FitToWidth may magnify the board up to
  // 1.5× on wide viewports; the dvh budget still shrinks it on short ones. HUD rows
  // track the same width expression so the controls stay visually attached to the
  // board — floored at the old max-w-lg 512px so short viewports keep today's layout.
  const boardAspect = boardW / boardH;
  const boardCap = `min(${boardW * BOARD_MAX_SCALE}px, max(280px, calc((100dvh - 300px) * ${boardAspect})))`;
  const hudCap = `min(${boardW * BOARD_MAX_SCALE}px, max(512px, calc((100dvh - 300px) * ${boardAspect})))`;

  // Directional compass — an 8-way arrow to an off-screen point of interest (null when on-screen).
  const compassTo = (target: { r: number; c: number } | null | undefined) => {
    if (!target) return null;
    const inViewport = target.r >= r0 && target.r < r0 + VIEW && target.c >= c0 && target.c < c0 + VIEW;
    if (inViewport) return null;
    const dr = target.r - mine.player.r;
    const dc = target.c - mine.player.c;
    if (Math.abs(dr) > Math.abs(dc) * 1.5) return dr > 0 ? '↓' : '↑';
    if (Math.abs(dc) > Math.abs(dr) * 1.5) return dc > 0 ? '→' : '←';
    if (dr > 0 && dc > 0) return '↘';
    if (dr > 0 && dc < 0) return '↙';
    if (dr < 0 && dc > 0) return '↗';
    return '↖';
  };
  // Shaft directional indicator — show an arrow when the shaft is off-screen, but only
  // once the player has actually seen it at least once this floor (0.11).
  const shaftDir = shaftSightedRef.current ? compassTo(mine.shaftPos) : null;
  // MINI-31: tombstone compass — points back to a dropped tombstone so recovery isn't a blind sweep.
  const tombDir = compassTo(findTombstone(mine));

  const inView = (mr: number, mc: number) => {
    const vi = mr - baseR0;
    const vj = mc - baseC0;
    return vi >= 0 && vi < RENDER_VIEW && vj >= 0 && vj < RENDER_VIEW;
  };

  layoutRef.current = {
    baseR0,
    baseC0,
    playerR: mine.player.r,
    playerC: mine.player.c,
    rows: mine.rows,
    cols: mine.cols,
    snapKey: mine.floor,
    // Monsters and co-op party members share the rAF interpolation path so both
    // glide smoothly and stay locked to the camera. Remote players use an
    // `rp:` id namespace so they never collide with a monster id.
    movers: [
      ...mine.monsters.filter((m) => inView(m.r, m.c)).map((m) => ({ id: m.id, r: m.r, c: m.c })),
      ...Object.values(remotePlayers)
        .filter((p) => p.floor === mine.floor && inView(p.r, p.c))
        .map((p) => ({ id: `rp:${p.userId}`, r: p.r, c: p.c })),
    ],
  };

  // Torch glow in world-container space
  const lightX = (mine.player.c - baseC0) * CELL + CELL / 2;
  const lightY = (mine.player.r - baseR0) * CELL + CELL / 2;

  return (
    <div className="texture-wood fixed inset-0 z-50 flex flex-col items-center gap-2 overflow-auto px-4 py-3">
      <CoopToasts />
      {/* HUD */}
      <div className="flex w-full items-center justify-between gap-3" style={{ maxWidth: hudCap }}>
        <span className="font-display text-sm font-bold text-gold-bright">
          {/* Keep "Floor N" atomic so a narrow HUD never wraps between label and number */}
          The Deep Mine · <span className="whitespace-nowrap">Floor {mine.floor}</span>
          <span className="ml-2 text-[11px] font-normal opacity-70">
            {band.name} · {MINE_ARCHETYPE_NAMES[mine.archetype ?? 'sprawl']}
          </span>
          {mine.monsters.some((m) => MINE_MONSTERS[m.key]?.isGuardian) && (
            <span className="ml-2 rounded px-1 py-0.5 text-[10px] font-bold text-amber-300 bg-amber-900/40 border border-amber-600/50">
              ⚔ Guardian
            </span>
          )}
          {/* Shaft direction badge — appears when the shaft is off-screen */}
          {shaftDir && (
            <span
              className="ml-2 rounded px-1 py-0.5 text-[10px] font-bold text-cyan-300 bg-cyan-900/40 border border-cyan-600/50"
              title="Shaft direction"
            >
              Shaft {shaftDir}
            </span>
          )}
          {/* Tombstone direction badge — appears when a dropped tombstone is off-screen (MINI-31) */}
          {tombDir && (
            <span
              className="ml-2 rounded px-1 py-0.5 text-[10px] font-bold text-rose-300 bg-rose-900/40 border border-rose-600/50"
              title="Tombstone direction — recover your dropped haul"
            >
              🪦 {tombDir}
            </span>
          )}
          {mine.activeBoons?.map((key) => {
            const boon = BOONS[key];
            if (!boon) return null;
            return (
              <span key={key} title={boon.desc}
                className="ml-1 rounded px-1 py-0.5 text-[10px] font-bold text-emerald-300 bg-emerald-900/40 border border-emerald-600/50">
                {boon.icon} {boon.name}
              </span>
            );
          })}
        </span>
        <div className="flex flex-col items-end gap-1">
          <CrawlGauge icon={<Heart className="h-3.5 w-3.5 text-stat-HP" />} value={mine.hp} max={mine.maxHp} fill="#2e8a5e" />
          <CrawlGauge icon={<Flame className="h-3.5 w-3.5 text-stat-AG" />} value={mine.sta} max={mine.maxSta} fill="#b8860b" />
          {mine.maxMp > 0 && (
            <CrawlGauge icon={<Sparkles className="h-3.5 w-3.5 text-blue-400" />} value={mine.mp} max={mine.maxMp} fill="#4f7ed4" />
          )}
          {/* Charge bar — filled while holding Space; updated imperatively via rAF */}
          <div className="flex items-center gap-1.5">
            <span className="h-3.5 w-3.5" />
            <div className="h-1.5 w-24 overflow-hidden rounded-full border border-amber-600/40 bg-stone-900">
              <div ref={chargeBarRef} style={{ height: '100%', borderRadius: 9999, backgroundColor: '#fbbf24', width: '0%', opacity: 0 }} />
            </div>
            <span className="font-display text-[10px] text-amber-400/70">charge</span>
          </div>
          {/* Active player status effects */}
          {mine.playerStatuses.length > 0 && (
            <div className="flex items-center gap-1 pt-0.5">
              {mine.playerStatuses.map((eff) => {
                const icons: Record<string, string> = { burn: '🔥', poison: '☠', freeze: '❄', bless: '✨', weaken: '💀', blind: '🌑' };
                const colors: Record<string, string> = { burn: '#f97316', poison: '#86efac', freeze: '#7dd3fc', bless: '#fde68a', weaken: '#9ca3af', blind: '#6b7280' };
                return (
                  <span
                    key={eff.key}
                    className="rounded px-0.5 text-[11px]"
                    style={{ color: colors[eff.key] ?? '#fff' }}
                    title={eff.key}
                  >
                    {icons[eff.key] ?? eff.key}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Haul */}
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-parchment-200" style={{ maxWidth: hudCap }}>
        <span className="font-display uppercase tracking-wider text-parchment-300/70">Haul</span>
        <span className="flex items-center gap-1 text-gold-bright">
          <Coins className="h-3.5 w-3.5" /> {mine.haul.gold ?? 0}
        </span>
        {haulMats.map(([key, n]) => (
          <HaulMat key={key} matKey={key} qty={n} />
        ))}
        {haulMats.length === 0 && (mine.haul.gold ?? 0) === 0 && (
          <span className="text-parchment-300/50">nothing yet — dig in</span>
        )}
      </div>

      {/* Boon cache prompt — shown when the player is standing on a boon tile */}
      {mine.status === 'active' && mine.tiles[mine.player.r]?.[mine.player.c]?.kind === 'boon' && (
        <div className="flex w-full items-center justify-center" style={{ maxWidth: hudCap }}>
          <span className="rounded border border-amber-600/60 bg-amber-900/40 px-3 py-1 font-display text-xs text-amber-300 animate-pulse">
            {isFirstRun
              ? '🎁 Boon cache — press [Space] to open a permanent run buff!'
              : '🎁 Boon cache — press [Space] to open'}
          </span>
        </div>
      )}

      {/* Tombstone prompt — shown when standing on the lost-haul marker */}
      {mine.status === 'active' && mine.tiles[mine.player.r]?.[mine.player.c]?.kind === 'tombstone' && mineTombstone && (
        <div className="flex w-full items-center justify-center" style={{ maxWidth: hudCap }}>
          <span className="rounded border border-violet-600/60 bg-violet-900/40 px-3 py-1 font-display text-xs text-violet-300 animate-pulse">
            🪦 Your remains — press [Space] to recover the lost haul
          </span>
        </div>
      )}

      {/* Cavern viewport — FitToWidth scales it down on narrow screens and up to 1.5×
          on wide ones; the dvh cap shrinks it on short desktop viewports so the action
          row stays above the fold (~300px is the HUD + haul + spells + buttons + hints
          budget). Tap-to-act: a clean tap (≤8px movement) inverts through the world
          rect to a tile and lets the loop resolve face/step/strike. */}
      <div
        className="flex w-full shrink-0 justify-center"
        style={{ maxWidth: boardCap }}
      >
      <FitToWidth contentWidth={boardW} contentHeight={boardH} maxScale={BOARD_MAX_SCALE}>
      <div
        ref={boardFrameRef}
        className="relative shrink-0 overflow-hidden rounded-md border-2 border-gold-deep/60"
        style={{
          width: boardW,
          height: boardH,
          boxShadow: 'inset 0 0 56px rgba(0,0,0,0.92), 0 0 0 1px rgba(0,0,0,0.5)',
        }}
        onPointerDown={(e) => tapTracker.current.down(e)}
        onPointerCancel={() => tapTracker.current.cancel()}
        onPointerUp={(e) => {
          const pt = tapTracker.current.up(e);
          if (!pt || mine.status !== 'active') return;
          const tile = clientToTile(pt.x, pt.y, {
            frame: boardFrameRef.current,
            world: worldRef.current,
            boardW,
            cell: CELL,
            baseR0,
            baseC0,
          });
          if (tile && tile.r >= 0 && tile.r < mine.rows && tile.c >= 0 && tile.c < mine.cols) {
            controls.tapAct(tile.r, tile.c);
          }
        }}
      >
        {/* World container */}
        <div ref={worldRef} className="absolute" style={{ willChange: 'transform' }}>

        {/* Tile layer */}
        {Array.from({ length: RENDER_VIEW }, (_, vi) => {
          const r = baseR0 + vi;
          return Array.from({ length: RENDER_VIEW }, (_, vj) => {
            const c = baseC0 + vj;
            const tile = mine.tiles[r]?.[c];
            if (!tile) return null;

            // --- Fog of war: cells outside the sight radius render as solid black ---
            const dr = r - mine.player.r;
            const dc = c - mine.player.c;
            if (dr * dr + dc * dc > (sightR + 0.5) * (sightR + 0.5)) {
              return (
                <div
                  key={`${r}-${c}`}
                  className="absolute"
                  style={{ left: vj * CELL, top: vi * CELL, width: CELL, height: CELL, backgroundColor: '#000' }}
                />
              );
            }

            const ore = tile.kind === 'ore' && tile.oreKey ? MINE_ORES[tile.oreKey] : null;
            const isFloor = tile.kind === 'floor' || tile.kind === 'entrance';
            const floorImg = isFloor ? mineFloorTile(r, c) : undefined;
            const rockImg = tile.kind === 'rock' ? mineRockSprite(r, c) : undefined;
            const oreImg = ore && tile.oreKey ? mineOreSprite(tile.oreKey) : undefined;
            const px = vj * CELL;
            const py = vi * CELL;

            const registryStyleFn = MINE_TILE_STYLE[tile.kind];
            const tileStyleProp: React.CSSProperties =
              registryStyleFn
                ? registryStyleFn(r, c, band.palette)
                : isFloor
                ? floorImg
                  ? {
                      backgroundColor: '#1a1008',
                      backgroundImage: `url(${floorImg})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      imageRendering: 'pixelated',
                    }
                  : floorStyle(r, c, band.palette)
                : tile.kind === 'ore'
                ? { backgroundColor: '#3a2c1c', backgroundImage: ore ? `radial-gradient(circle at 55% 42%, ${ore.color}22 0%, transparent 60%)` : undefined }
                : { backgroundColor: '#2a1e12' };

            return (
              <div
                key={`${r}-${c}`}
                className="absolute flex items-center justify-center text-[24px] leading-none"
                style={{
                  ...tileStyleProp,
                  left: px,
                  top: py,
                  width: CELL,
                  height: CELL,
                  boxShadow:
                    tile.kind === 'bedrock'
                      ? 'none'
                      : ore
                      ? `inset 0 0 0 1px rgba(0,0,0,0.3), inset 0 0 10px ${ore.color}66`
                      : tile.kind === 'rock'
                      ? 'inset 0 0 0 1px rgba(0,0,0,0.35), inset -1px -1px 0 rgba(255,255,255,0.04)'
                      : 'inset 0 0 0 1px rgba(0,0,0,0.22)',
                }}
              >
                {rockImg ? (
                  <img src={rockImg} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain image-pixel" />
                ) : oreImg ? (
                  <img src={oreImg} alt={ore?.name} title={ore?.name} className="pointer-events-none absolute inset-0 h-full w-full object-contain image-pixel" />
                ) : ore ? (
                  <OreIcon oreKey={tile.oreKey!} color={ore.color} />
                ) : (
                  MINE_TILE_ICON[tile.kind] ?? null
                )}
                {tile.maxDurability != null && tile.durability != null && tile.durability < tile.maxDurability && (
                  <div className="absolute bottom-1 left-1 right-1 h-[3px] overflow-hidden rounded-full bg-black/60">
                    <div className="h-full rounded-full bg-red-400" style={{ width: `${(tile.durability / tile.maxDurability) * 100}%` }} />
                  </div>
                )}
                {tile.kind === 'rich_vein' && mine.richVein && mine.richVein.r === r && mine.richVein.c === c && (
                  <div className="absolute top-1 left-1 right-1 h-[3px] overflow-hidden rounded-full bg-black/60">
                    <div
                      className="h-full rounded-full bg-emerald-300"
                      style={{
                        width: `${Math.max(0, Math.min(100, ((mine.richVein.expiresAtMs - performance.now()) / RICH_VEIN_WINDOW_MS) * 100))}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          });
        })}

        {/* Torch-glow vignette — deeper and more dramatic than before */}
        <div
          className="pointer-events-none absolute inset-0 z-[5]"
          style={{
            background: `radial-gradient(circle ${(sightR + 0.5) * CELL}px at ${lightX}px ${lightY}px, transparent 40%, rgba(8,4,1,0.38) 62%, rgba(5,2,0,0.72) 82%, rgba(2,1,0,0.90) 100%)`,
            animation: 'mine-torch-flicker 3.2s ease-in-out infinite',
          }}
        />

        {/* Stalactite shadow along the top edge */}
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 z-[5]"
          style={{
            height: '15%',
            background: 'linear-gradient(to bottom, rgba(3,2,1,0.65) 0%, transparent 100%)',
          }}
        />

        {/* Facing indicator */}
        {(() => {
          const fvj = faced.c - baseC0;
          const fvi = faced.r - baseR0;
          if (fvi < 0 || fvi >= RENDER_VIEW || fvj < 0 || fvj >= RENDER_VIEW) return null;
          return (
            <div
              className="pointer-events-none absolute z-[6]"
              style={{
                width: CELL,
                height: CELL,
                transform: `translate(${fvj * CELL}px, ${fvi * CELL}px)`,
                boxShadow: 'inset 0 0 0 2px rgba(251,191,36,0.7)',
                transition: 'transform 150ms linear',
              }}
            />
          );
        })()}

        {/* Active runes */}
        {mine.runes.map((rune) => {
          const vj = rune.c - baseC0;
          const vi = rune.r - baseR0;
          if (vi < 0 || vi >= RENDER_VIEW || vj < 0 || vj >= RENDER_VIEW) return null;
          const runeColors = { fire: '#ff6b35', ice: '#7dd3fc', poison: '#86efac' };
          return (
            <div
              key={`rune-${rune.id}`}
              className="pointer-events-none absolute z-[7] flex items-center justify-center text-[18px] leading-none"
              style={{
                width: CELL,
                height: CELL,
                left: vj * CELL,
                top: vi * CELL,
                color: runeColors[rune.kind],
                textShadow: `0 0 8px ${runeColors[rune.kind]}`,
              }}
            >
              ✦
            </div>
          );
        })}

        {/* Destruction pops */}
        {pops.map((p) => {
          const vj = p.c - baseC0;
          const vi = p.r - baseR0;
          if (vi < 0 || vi >= RENDER_VIEW || vj < 0 || vj >= RENDER_VIEW) return null;
          return (
            <div
              key={p.key}
              className="pointer-events-none absolute z-20 rounded-full"
              style={{
                width: CELL * 0.7,
                height: CELL * 0.7,
                left: vj * CELL + CELL * 0.15,
                top: vi * CELL + CELL * 0.15,
                backgroundColor: 'rgba(251,191,36,0.75)',
                animation: 'mine-pop 0.5s ease-out forwards',
              }}
            />
          );
        })}

        {/* Loot popups */}
        {lootPops.map((p) => {
          const vj = p.c - baseC0;
          const vi = p.r - baseR0;
          if (vi < 0 || vi >= RENDER_VIEW || vj < 0 || vj >= RENDER_VIEW) return null;
          return (
            <div
              key={p.key}
              className="pointer-events-none absolute z-30 whitespace-nowrap font-display text-[13px] font-bold"
              style={{
                left: vj * CELL + CELL / 2,
                top: vi * CELL + CELL / 2,
                color: p.color,
                textShadow: '0 0 6px rgba(0,0,0,1), 0 1px 3px rgba(0,0,0,0.9)',
                animation: 'loot-float 1.4s ease-out forwards',
              }}
            >
              {p.text}
            </div>
          );
        })}

        {/* Combat damage / heal numbers (Phase 6) */}
        {dmgPops.map((p) => {
          const vj = p.c - baseC0;
          const vi = p.r - baseR0;
          if (vi < 0 || vi >= RENDER_VIEW || vj < 0 || vj >= RENDER_VIEW) return null;
          return (
            <div
              key={p.key}
              className="pointer-events-none absolute z-30 whitespace-nowrap font-display font-bold"
              style={{
                left: vj * CELL + CELL / 2,
                top: vi * CELL + CELL / 2,
                fontSize: p.color === '#fbbf24' ? 15 : 13,
                color: p.color,
                textShadow: '0 0 6px rgba(0,0,0,1), 0 1px 3px rgba(0,0,0,0.9)',
                animation: 'tactics-floater 0.85s ease-out forwards',
              }}
            >
              {p.text}
            </div>
          );
        })}

        {/* One-shot VFX bursts: impact flashes + dash rings (Phase 6) */}
        {vfxPops.map((p) => {
          const vj = p.c - baseC0;
          const vi = p.r - baseR0;
          if (vi < 0 || vi >= RENDER_VIEW || vj < 0 || vj >= RENDER_VIEW) return null;
          return (
            <div
              key={p.key}
              className="pointer-events-none absolute z-25"
              style={{
                width: p.size,
                height: p.size,
                left: vj * CELL + CELL / 2,
                top: vi * CELL + CELL / 2,
                borderRadius: '50%',
                border: `2px solid ${p.color}`,
                animation: p.anim,
              }}
            />
          );
        })}

        {/* 3.7 guardian special telegraph — a ground-target zone marking where the slam lands */}
        {mine.monsters.flatMap((m) => {
          if (!m.special) return [];
          const { targetR, targetC } = m.special;
          const cells: Array<[number, number]> = [];
          for (let dr = -GUARDIAN_SPECIAL_BLAST_RADIUS; dr <= GUARDIAN_SPECIAL_BLAST_RADIUS; dr++) {
            for (let dc = -GUARDIAN_SPECIAL_BLAST_RADIUS; dc <= GUARDIAN_SPECIAL_BLAST_RADIUS; dc++) {
              if (Math.abs(dr) + Math.abs(dc) > GUARDIAN_SPECIAL_BLAST_RADIUS) continue;
              cells.push([targetR + dr, targetC + dc]);
            }
          }
          return cells.map(([r, c]) => {
            const vj = c - baseC0;
            const vi = r - baseR0;
            if (vi < 0 || vi >= RENDER_VIEW || vj < 0 || vj >= RENDER_VIEW) return null;
            return (
              <div
                key={`${m.id}-telegraph-${r}-${c}`}
                className="pointer-events-none absolute z-[7]"
                style={{
                  left: vj * CELL,
                  top: vi * CELL,
                  width: CELL,
                  height: CELL,
                  backgroundColor: 'rgba(255,60,20,0.30)',
                  boxShadow: 'inset 0 0 0 2px rgba(255,110,50,0.85)',
                  animation: 'mine-boon-pulse 0.5s ease-in-out infinite',
                }}
              />
            );
          });
        })}

        {/* Monsters — rAF drives position; fog culls those outside the sight radius */}
        {mine.monsters.map((m) => {
          const affixRing = m.affix
            ? {
                armored: 'ring-2 ring-slate-300',
                swift: 'ring-2 ring-yellow-300',
                venomous: 'ring-2 ring-emerald-400',
              }[m.affix]
            : undefined;
          const vj = m.c - baseC0;
          const vi = m.r - baseR0;
          if (vi < 0 || vi >= RENDER_VIEW || vj < 0 || vj >= RENDER_VIEW) return null;
          // Fog of war: don't reveal monsters outside the player's sight.
          const mdr = m.r - mine.player.r;
          const mdc = m.c - mine.player.c;
          if (mdr * mdr + mdc * mdc > (sightR + 0.5) * (sightR + 0.5)) return null;
          const def = MINE_MONSTERS[m.key];
          const art = guardianArt(m.key);
          return (
            <div
              key={m.id}
              ref={(el) => {
                if (el) moverRefs.current.set(m.id, el);
                else moverRefs.current.delete(m.id);
              }}
              className={cn('pointer-events-none absolute z-[8] flex items-center justify-center', affixRing && `${affixRing} rounded-full`)}
              style={{ width: CELL, height: CELL, transform: `translate(${vj * CELL}px, ${vi * CELL}px)` }}
              title={m.affix ? `${def?.name} (${MINE_AFFIXES[m.affix].name})` : def?.name}
            >
              {art ? (
                <div className="h-[85%] w-[85%] drop-shadow">{art}</div>
              ) : (
                <span className="text-[28px] leading-none drop-shadow">{def?.glyph ?? '?'}</span>
              )}
              {m.hp < m.maxHp && (
                <div className="absolute -top-1.5 left-0 right-0 h-[3px] overflow-hidden rounded-full bg-black/60">
                  <div className="h-full rounded-full bg-red-400" style={{ width: `${(m.hp / m.maxHp) * 100}%` }} />
                </div>
              )}
              {def?.isGuardian && (
                <div className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 flex gap-0.5 whitespace-nowrap">
                  {def.weakTo?.map((stat) => (
                    <span key={stat} className="rounded bg-amber-900/80 px-0.5 font-display text-[8px] font-bold text-amber-200 leading-tight">
                      ⚡{stat}
                    </span>
                  ))}
                  {def.resistTo?.map((stat) => (
                    <span key={stat} className="rounded bg-slate-900/80 px-0.5 font-display text-[8px] font-bold text-slate-300 leading-tight">
                      🛡{stat}
                    </span>
                  ))}
                </div>
              )}
              {(m.frozenUntilMs ?? 0) > performance.now() && (
                <div className="absolute inset-0 rounded bg-blue-400/25 ring-1 ring-blue-300" />
              )}
              {m.special && (
                <div
                  className="absolute inset-0 rounded-full ring-2 ring-orange-400"
                  style={{ animation: 'mine-boon-pulse 0.5s ease-in-out infinite' }}
                />
              )}
            </div>
          );
        })}

        {/* Co-op party members — see RemoteCrawlers. Mine draws them at z 9 (own player z 9). */}
        <RemoteCrawlers
          remotePlayers={remotePlayers}
          currentDepth={mine.floor}
          baseR0={baseR0}
          baseC0={baseC0}
          RENDER_VIEW={RENDER_VIEW}
          CELL={CELL}
          moverRefs={moverRefs}
          nameFor={nameFor}
          variant="miner"
          zIndex={9}
        />

        {/* Player — rAF drives position */}
        <div
          ref={playerRef}
          className="pointer-events-none absolute z-[9]"
          style={{
            width: CELL,
            height: CELL,
            transform: `translate(${(mine.player.c - baseC0) * CELL}px, ${(mine.player.r - baseR0) * CELL}px)`,
          }}
        >
          <CrawlerAvatar
            variant="miner"
            facing={mine.player.facing}
            moving={moving}
            dead={dead}
            cell={CELL}
            toolTier={pickaxeTier(mine.pickaxePower)}
            toolRef={toolRef}
          />
        </div>

        </div>{/* end world container */}

        {/* Player-struck vignette (Phase 6) */}
        {hitAt > 0 && (
          <div
            key={hitAt}
            className="pointer-events-none absolute inset-0 z-[60]"
            style={{ animation: 'arena-hit 0.45s ease-out forwards' }}
          />
        )}

        {/* Descent wipe — band-tinted flash on floor change (Phase 6) */}
        {wipeAt > 0 && (
          <div
            key={wipeAt}
            className="pointer-events-none absolute inset-0 z-[55]"
            style={{
              backgroundColor: band.palette.accent,
              animation: 'crawl-wipe 0.5s ease-out forwards',
            }}
          />
        )}

        {/* Guardian encounter banner */}
        {guardianAlertAt > 0 && (
          <div
            key={guardianAlertAt}
            className="pointer-events-none absolute inset-x-0 top-[30%] z-[58] flex items-center justify-center px-3"
          >
            <span
              className="max-w-full rounded-md border border-amber-500/70 bg-black/75 px-4 py-2 text-center font-display text-base font-bold text-amber-300"
              style={{ animation: 'tactics-floater 3s ease-out forwards', textShadow: '0 0 12px rgba(251,191,36,0.8)' }}
            >
              ⚔ A guardian stirs…
            </span>
          </div>
        )}

        {/* First-run contextual hints — max-w-full keeps long tips wrapping inside the canvas */}
        {activeHint && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[12%] z-[58] flex items-center justify-center px-3">
            <span
              className="max-w-full rounded-md border border-sky-500/60 bg-black/80 px-4 py-2 text-center font-display text-sm text-sky-200"
              style={{ animation: 'crawl-wipe 0.3s ease-out forwards, tactics-floater 5.5s 0.3s ease-out forwards' }}
            >
              💡 {activeHint}
            </span>
          </div>
        )}

        {/* Ambient mine atmosphere — viewport-fixed */}
        {mine.status === 'active' && (
          <div className="mine-ambient pointer-events-none absolute inset-0 z-[15] overflow-hidden">
            {/* Falling dust motes */}
            {[
              { left: '20%', top: '2%',  size: 2, dur: '7s',  delay: '0s'   },
              { left: '46%', top: '8%',  size: 2, dur: '10s', delay: '2.2s' },
              { left: '72%', top: '3%',  size: 3, dur: '8s',  delay: '4.8s' },
              { left: '34%', top: '14%', size: 2, dur: '9s',  delay: '0.8s' },
              { left: '84%', top: '1%',  size: 2, dur: '6s',  delay: '3.0s' },
              { left: '58%', top: '7%',  size: 2, dur: '11s', delay: '6.5s' },
              { left: '12%', top: '11%', size: 2, dur: '8.5s',delay: '1.5s' },
            ].map((d, i) => (
              <div
                key={i}
                className="absolute rounded-full"
                style={{
                  left: d.left,
                  top: d.top,
                  width: d.size,
                  height: d.size,
                  backgroundColor: 'rgba(215,190,148,0.62)',
                  filter: 'blur(0.4px)',
                  animation: `mine-dust-fall ${d.dur} linear infinite ${d.delay}`,
                }}
              />
            ))}
            {/* Crystal sparkles — brighter and larger */}
            {[
              { left: '10%', top: '32%', size: 7,  dur: '4.5s', delay: '0s'   },
              { left: '77%', top: '55%', size: 8,  dur: '6.5s', delay: '1.6s' },
              { left: '51%', top: '18%', size: 6,  dur: '5.5s', delay: '3.0s' },
              { left: '88%', top: '22%', size: 5,  dur: '7s',   delay: '4.8s' },
              { left: '30%', top: '68%', size: 7,  dur: '5s',   delay: '2.5s' },
            ].map((s, i) => (
              <div
                key={`sp-${i}`}
                className="absolute rounded-full"
                style={{
                  left: s.left,
                  top: s.top,
                  width: s.size,
                  height: s.size,
                  background: 'radial-gradient(circle, rgba(160,220,255,0.95) 0%, rgba(110,175,240,0.50) 50%, transparent 100%)',
                  boxShadow: '0 0 8px rgba(140,210,255,0.6)',
                  animation: `mine-sparkle ${s.dur} ease-in-out infinite ${s.delay}`,
                }}
              />
            ))}
          </div>
        )}

        {/* Banking overlay */}
        {mine.status === 'banking' && (() => {
          const onSafe = isMineSafeBankTile(mine.tiles[mine.player.r]?.[mine.player.c]?.kind);
          const { kept, lost } = splitHaul(mine.haul, onSafe ? 1 : MINE_STASH_KEEP);
          // 3.8: the daily first-descent bonus is applied at commit time in store/commit.ts —
          // mirror that math here so the preview matches what actually gets banked.
          const dailyFloorsUsed = mineDailyBonus?.date === toISODate() ? mineDailyBonus.floorsUsed : 0;
          const dailyBonusActive = dailyFloorsUsed < MINE_DAILY_BONUS_FLOORS;
          const goldMult = habitBonus * (dailyBonusActive ? MINE_DAILY_BONUS_MULT : 1);
          const newRecord = mine.deepest > deepestMineFloor;
          return (
            <EndOfRunPanel accent="gold">
              <span className="text-4xl leading-none">⛏️</span>
              <p className="font-display text-xl font-bold leading-tight text-ink">Haul Secured</p>
              <p className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                {mine.deepest > 1 ? `Reached floor ${mine.deepest}` : 'Floor 1 cleared'}
              </p>
              {newRecord && (
                <span className="rounded-full border border-gold-deep/60 bg-gold/15 px-2.5 py-0.5 font-display text-[11px] font-bold text-gold-deep">
                  ✦ New depth record
                </span>
              )}
              {dailyBonusActive && (
                <span className="rounded-full border border-amber-700/40 bg-amber-500/15 px-2.5 py-0.5 font-display text-[11px] font-bold text-amber-800">
                  🎉 Daily bonus ×{MINE_DAILY_BONUS_MULT} gold
                </span>
              )}
              <Divider className="w-full" />
              {onSafe ? (
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                  <HaulLedger
                    reward={{ ...kept, gold: Math.round((kept.gold ?? 0) * goldMult) }}
                    empty="nothing gathered"
                  />
                </div>
              ) : (
                <div className="flex w-full items-stretch justify-center gap-3">
                  <div className="flex flex-1 flex-col items-center gap-1">
                    <span className="font-display text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                      Kept ({Math.round(MINE_STASH_KEEP * 100)}%)
                    </span>
                    <HaulLedger
                      reward={{ ...kept, gold: Math.round((kept.gold ?? 0) * goldMult) }}
                      empty="nothing"
                    />
                  </div>
                  <div className="w-px bg-ink/15" />
                  <div className="flex flex-1 flex-col items-center gap-1">
                    <span className="font-display text-[10px] font-bold uppercase tracking-wider text-ember">
                      Forfeit ({Math.round((1 - MINE_STASH_KEEP) * 100)}%)
                    </span>
                    <HaulLedger reward={lost} empty="nothing" lost />
                  </div>
                </div>
              )}
              <div className="empty:hidden rounded-full bg-wood-800/90 px-2.5 py-1">
                <StreakBonusChip className="text-[11px]" />
              </div>
              <Button variant="primary" onClick={endMining} className="mt-1 w-full px-4 py-2 text-sm">
                {onSafe ? 'Bank & Leave' : `Bank ${Math.round(MINE_STASH_KEEP * 100)}% & Leave`}
              </Button>
            </EndOfRunPanel>
          );
        })()}

        {/* Boon choice panel (pauses the run while the player picks). Mine plays a sound
            on pick and shows the cards statically (no stagger animation). */}
        <BoonChoicePanel
          status={mine.status}
          pendingBoonChoice={mine.pendingBoonChoice}
          onChoose={(key) => { sfx.play('mineBoonOpen'); chooseMineBoon(key); }}
          onSkip={() => skipMineBoon()}
        />

        {/* Death overlay */}
        {mine.status === 'ended' && (() => {
          const death = splitHaul(mine.haul, MINE_DEATH_KEEP);
          const hasLost = rewardChips(death.lost).length > 0;
          const newRecord = mine.deepest > deepestMineFloor;
          return (
            <EndOfRunPanel accent="ember">
              <span className="text-4xl leading-none">💀</span>
              <p className="font-display text-xl font-bold leading-tight text-ember">Fallen in the Deep</p>
              <p className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                Reached floor {mine.deepest}
              </p>
              {newRecord && (
                <span className="rounded-full border border-gold-deep/60 bg-gold/15 px-2.5 py-0.5 font-display text-[11px] font-bold text-gold-deep">
                  ✦ New depth record
                </span>
              )}
              <Divider className="w-full" />
              <div className="flex w-full items-stretch justify-center gap-3">
                <div className="flex flex-1 flex-col items-center gap-1">
                  <span className="font-display text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    Kept ({Math.round(MINE_DEATH_KEEP * 100)}%)
                  </span>
                  <HaulLedger
                    reward={{ ...death.kept, gold: Math.round((death.kept.gold ?? 0) * habitBonus) }}
                    empty="nothing"
                  />
                </div>
                <div className="w-px bg-ink/15" />
                <div className="flex flex-1 flex-col items-center gap-1">
                  <span className="font-display text-[10px] font-bold uppercase tracking-wider text-ember">
                    Lost ({Math.round((1 - MINE_DEATH_KEEP) * 100)}%)
                  </span>
                  <HaulLedger reward={death.lost} empty="nothing" lost />
                  {hasLost && (
                    <span className="mt-0.5 text-[10px] text-violet-700/80">
                      🪦 ~{Math.round(MINE_TOMBSTONE_RECOVER_KEEP * 100)}% recoverable at your tombstone
                    </span>
                  )}
                </div>
              </div>
              <div className="empty:hidden rounded-full bg-wood-800/90 px-2.5 py-1">
                <StreakBonusChip className="text-[11px]" />
              </div>
              <Button variant="primary" onClick={endMining} className="mt-1 w-full px-4 py-2 text-sm">
                Retrieve Haul &amp; Leave
              </Button>
            </EndOfRunPanel>
          );
        })()}
      </div>
      </FitToWidth>
      </div>

      {/* Spell ability bar — blue accent, hidden while not active, 2-line cards. */}
      <CrawlSpellBar
        knownSpells={mine.knownSpells}
        mp={mine.mp}
        status={mine.status}
        onCast={(key) => controls.castSpell(key)}
        accent="blue"
        hideWhenInactive
        tooltip={(spell) => `${spell.name} — ${spell.description}`}
        layout="two-line"
        maxWidth={hudCap}
      />

      {/* Descend / leave */}
      <div className="flex w-full flex-col items-center gap-1" style={{ maxWidth: hudCap }}>
        <div className="flex items-center justify-center gap-2">
          <Button
            variant={onShaft && !isCoopGuest ? 'primary' : 'secondary'}
            onClick={mineDescend}
            disabled={!onShaft || isCoopGuest}
            title={isCoopGuest ? 'The host leads the descent' : undefined}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs',
              (!onShaft || isCoopGuest) && 'opacity-60',
            )}
          >
            <ChevronsDown className="h-4 w-4" /> Descend
          </Button>
          <Button variant="danger" onClick={beginBanking} className="flex items-center gap-1.5 px-3 py-1.5 text-xs">
            <LogOut className="h-4 w-4" /> Bank &amp; leave
          </Button>
        </div>
        {isCoopGuest && (
          <p className="text-[10px] text-parchment-300/50">The host leads the descent.</p>
        )}
      </div>

      {/* Touch controls — coarse-pointer devices only; desktop plays on the keyboard */}
      <div className="pointer-coarse-only w-full" style={{ maxWidth: hudCap }}>
        <MineControls controls={controls} />
      </div>

      {/* Keyboard hints — fine-pointer devices only (noise on phones) */}
      <p className="pointer-fine-only text-center text-[10px] text-parchment-300/50">
        Move: arrow keys / WASD · Mine/Attack: space, or click a tile · Spells: 1–4 or tap above · Stand on{' '}
        <ChevronsDown className="inline h-3 w-3 text-cyan-300" /> shaft to descend.
      </p>
    </div>
  );
}
