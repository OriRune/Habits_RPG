// @vitest-environment jsdom
// Component smoke (plan 7.5, sub-task 5B) — TacticsOverlay reads a live HexBattleState
// from the store and wires the action bar to store actions. We seed a real skirmish via
// the public generateSkirmish(), render, and exercise a couple of reachable interactions.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { TacticsOverlay } from '@/components/tactics/TacticsOverlay';
import { generateSkirmish } from '@/engine/hexBattle';
import { useGameStore } from '@/store/useGameStore';
import type { Fighter, Combatant } from '@/engine/combat';
import type { WeaponDef } from '@/engine/weapons';

// --- Minimal Web Audio stub -------------------------------------------------------------------
// useTacticsAudio() calls sfx.startDrone() on mount unconditionally (even when muted), which
// constructs an AudioContext. jsdom has none, so provide a no-op stub covering the nodes/params
// getCtx()/startDrone()/setDroneIntensity() touch. soundEnabled:false keeps every play() muted,
// so only the drone-construction path needs satisfying.
class FakeParam {
  value = 0;
  setValueAtTime() { return this; }
  setTargetAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  cancelScheduledValues() { return this; }
}
class FakeNode {
  frequency = new FakeParam();
  Q = new FakeParam();
  gain = new FakeParam();
  type = '';
  connect() { return this; }
  disconnect() {}
  start() {}
  stop() {}
}
class FakeAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  state = 'running';
  destination = {};
  createGain() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createBufferSource() { return new FakeNode(); }
  createBuffer(_ch: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
  resume() { return Promise.resolve(); }
}

beforeAll(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
});

// --- Fighter fixture (mirrors the engine test's shape) ----------------------------------------
const SWORD: WeaponDef = {
  key: 'test_sword', name: 'Test Sword', attackStat: 'ST', bonus: 5, staminaCost: 2, description: '',
};
function makeFighter(): Fighter {
  const c: Combatant = {
    maxHp: 100, maxMp: 20, maxSta: 12, meleePower: 10, rangedPower: 8, dodge: 0.1, flee: 0,
    damageSpell: 6, supportSpell: 6, illusionPower: 4, defense: 0, ward: 0,
  };
  return { c, weapon: SWORD };
}

// Deterministic rng so the seeded board is stable across runs.
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedBattle() {
  const tactics = generateSkirmish(makeFighter(), 10, 5, ['sparks', 'mend'], { rng: seeded(7) });
  useGameStore.setState((s) => ({
    tactics,
    settings: { ...s.settings, soundEnabled: false },
  }));
  return tactics;
}

afterEach(() => {
  cleanup();
  useGameStore.setState({ tactics: null });
});

beforeEach(() => {
  useGameStore.setState({ tactics: null });
});

describe('TacticsOverlay (smoke)', () => {
  it('renders a seeded skirmish with the turn HUD', () => {
    seedBattle();
    const { container, getByText } = render(<TacticsOverlay />);
    expect(container.firstChild).toBeTruthy();
    // Turn badge for an active player turn.
    expect(getByText(/your turn/i)).toBeTruthy();
    // Action bar wired up.
    expect(getByText(/end turn/i)).toBeTruthy();
    // The a11y surface survives the static/dynamic layer split (audit U10)…
    const hexes = container.querySelectorAll('polygon[data-hex]');
    expect(hexes.length).toBeGreaterThan(0);
    expect(hexes[0].getAttribute('aria-label')).toMatch(/tile/);
    // …and units render as procedural SVG tokens, not emoji.
    expect(container.querySelector('svg[data-token="hero-player"]')).toBeTruthy();
    expect(container.querySelectorAll('svg[data-token]').length).toBeGreaterThan(1);
  });

  it('clicking Move fires tacticsSelect and enters move-targeting mode', () => {
    seedBattle();
    const selectSpy = vi.spyOn(useGameStore.getState(), 'tacticsSelect');
    const { getByRole } = render(<TacticsOverlay />);
    fireEvent.click(getByRole('button', { name: /move/i }));
    expect(selectSpy).toHaveBeenCalledWith({ kind: 'move' });
    // The real store action ran: selection is now move mode with reachable tiles computed.
    const st = useGameStore.getState().tactics!;
    expect(st.selected).toEqual({ kind: 'move' });
    expect(st.reachable.length).toBeGreaterThan(0);
  });

  it('clicking End turn fires the tacticsEndTurn path', () => {
    seedBattle();
    const endSpy = vi.spyOn(useGameStore.getState(), 'tacticsEndTurn');
    const { getByText } = render(<TacticsOverlay />);
    fireEvent.click(getByText(/end turn/i));
    expect(endSpy).toHaveBeenCalled();
    // The skirmish is still a valid state after the enemy phase resolved.
    expect(useGameStore.getState().tactics).not.toBeNull();
  });

  it('the victory card shows gold, the material bundle, the XP split, and a new tier record', () => {
    const tactics = seedBattle();
    // Force a won state: clear the enemy force and stamp the outcome.
    useGameStore.setState({
      tactics: { ...tactics, enemies: [], status: 'won' },
      deepestTacticsTier: 4, // below tier 5 → the record chip must show
    });
    const { getByText, queryByText } = render(<TacticsOverlay />);
    expect(getByText(/victory/i)).toBeTruthy();
    expect(getByText(/new record — tier 5/i)).toBeTruthy();
    // Reward rows mirror tacticsReward: gold + the BAL-10 material bundle (tier 5 → ×2 each).
    expect(getByText(/^Gold$/)).toBeTruthy();
    expect(getByText('Roll of Cloth')).toBeTruthy();
    expect(getByText('Bronze Bar')).toBeTruthy();
    // XP split mirrors tacticsStatXp — AG-forward trickle rendered per stat.
    expect(getByText(/AG \+\d/)).toBeTruthy();
    expect(getByText(/EN \+\d/)).toBeTruthy();
    // The action bar is gone beneath the card.
    expect(queryByText(/end turn/i)).toBeNull();
    expect(getByText(/claim reward/i)).toBeTruthy();
  });

  it('the defeat card shows the half-XP note and no materials', () => {
    const tactics = seedBattle();
    useGameStore.setState({
      tactics: { ...tactics, status: 'lost', player: { ...tactics.player, hp: 0 } },
    });
    const { getByText, queryByText, getByRole } = render(<TacticsOverlay />);
    expect(getByText(/defeated/i)).toBeTruthy();
    expect(getByText(/Training XP \(half\)/)).toBeTruthy();
    expect(queryByText('Roll of Cloth')).toBeNull(); // materials are win-only
    expect(getByText(/💡/)).toBeTruthy(); // rule-based coaching line
    expect(getByRole('button', { name: 'Leave' })).toBeTruthy();
  });
});
