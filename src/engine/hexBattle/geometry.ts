// Hex Tactics — board geometry: movement reachability (Dijkstra), line of sight, targeting, and the
// derived highlight caches + enemy threat zone. All pure reads over HexBattleState.
import { getSpell } from '../spells';
import {
  type Hex,
  hexDistance,
  hexKey,
  hexLineBetween,
  hexNeighbors,
} from '../hex';
import {
  type HexBattleState,
  type SelectedAction,
  SPELL_RANGE,
  climbFor,
  elevationAt,
  hasStatus,
  heightRangeBonus,
  occupiedKeys,
} from './state';

// --- Movement: reachable tiles (Dijkstra with climb + slow cost) --------------------------------
/** Map of reachable hex keys → { hex, cost }, respecting budget, climb limit, terrain & occupancy. */
export function reachableCosts(
  s: HexBattleState,
  from: Hex,
  budget: number,
  climb: number,
): Map<string, { hex: Hex; cost: number }> {
  const out = new Map<string, { hex: Hex; cost: number }>();
  const best = new Map<string, number>();
  const occupied = occupiedKeys(s, from);
  best.set(hexKey(from), 0);
  // Small budgets → a simple cost-bounded BFS with relaxation suffices.
  let frontier: Array<{ hex: Hex; cost: number }> = [{ hex: from, cost: 0 }];
  while (frontier.length) {
    const next: Array<{ hex: Hex; cost: number }> = [];
    for (const cur of frontier) {
      for (const n of hexNeighbors(cur.hex)) {
        const key = hexKey(n);
        const tile = s.tiles[key];
        if (!tile || tile.terrain === 'blocked') continue;
        if (occupied.has(key)) continue;
        if (tile.elevation - elevationAt(s, cur.hex) > climb) continue; // ascent gate (descents free)
        const stepCost = tile.terrain === 'slow' ? 2 : 1;
        const cost = cur.cost + stepCost;
        if (cost > budget) continue;
        if (best.has(key) && best.get(key)! <= cost) continue;
        best.set(key, cost);
        out.set(key, { hex: n, cost });
        next.push({ hex: n, cost });
      }
    }
    frontier = next;
  }
  return out;
}

/** Tiles the unit at `from` can move to with the given budget & climb (excludes the start tile). */
export function computeReachable(s: HexBattleState, from: Hex, budget: number, climb: number): Hex[] {
  return [...reachableCosts(s, from, budget, climb).values()].map((v) => v.hex);
}

// --- Line of sight ------------------------------------------------------------------------------
/** Clear shot from `a` to `b`? Blocked by `blocked` terrain, a living unit, or a ridge taller than both ends. */
export function hasLineOfSight(s: HexBattleState, a: Hex, b: Hex): boolean {
  const line = hexLineBetween(a, b);
  const maxEnd = Math.max(elevationAt(s, a), elevationAt(s, b));
  const occupied = occupiedKeys(s); // both endpoints may hold units; we only check interior tiles
  for (let i = 1; i < line.length - 1; i++) {
    const h = line[i];
    const key = hexKey(h);
    const tile = s.tiles[key];
    if (!tile) continue;
    if (tile.terrain === 'blocked') return false;
    if (tile.elevation > maxEnd) return false; // a higher ridge between the two ends blocks the shot
    if (occupied.has(key)) return false; // a unit stands in the way
  }
  return true;
}

// --- Targeting ----------------------------------------------------------------------------------
/** Enemy-occupied hexes the selected action can legally hit this turn. */
export function computeTargetable(s: HexBattleState, action: SelectedAction): Hex[] {
  if (!action || s.turn !== 'player' || s.status !== 'active' || s.player.hasActed) return [];
  const p = s.player.hex;
  const pz = elevationAt(s, p);
  const living = s.enemies.filter((e) => e.hp > 0);
  // Use per-hero weapon if set (co-op), else fall back to the state-level weapon.
  const weapon = s.player.weapon ?? s.weapon;

  if (action.kind === 'attack') {
    if (weapon.ranged) {
      const range = weapon.range ?? 1;
      return living
        .filter((e) => {
          const dz = pz - elevationAt(s, e.hex);
          return hexDistance(p, e.hex) <= range + heightRangeBonus(dz) && hasLineOfSight(s, p, e.hex);
        })
        .map((e) => e.hex);
    }
    // Melee: any adjacent living enemy (climb does not gate an attack).
    return living.filter((e) => hexDistance(p, e.hex) === 1).map((e) => e.hex);
  }

  if (action.kind === 'spell') {
    const spell = getSpell(action.spellKey);
    if (!spell) return [];
    // Blink: target any open (non-blocked, unoccupied) tile within 2 steps.
    if (spell.mechanic === 'blink') {
      const occ = occupiedKeys(s);
      return Object.values(s.tiles)
        .filter((t) => {
          if (t.terrain === 'blocked') return false;
          if (occ.has(hexKey(t.hex))) return false;
          const d = hexDistance(p, t.hex);
          // BAL-08: blink is the KN payoff its tooltip advertises — Knowledge extends the jump.
          return d >= 1 && d <= 2 + Math.floor(s.player.supportSpell / 8);
        })
        .map((t) => t.hex);
    }
    // Cleave / support: self-cast, no target tile needed.
    if (spell.mechanic === 'cleave' || spell.school === 'support') return [];
    // All other spells (damage / illusion / push): target living enemies in range.
    return living
      .filter((e) => {
        const dz = pz - elevationAt(s, e.hex);
        return hexDistance(p, e.hex) <= SPELL_RANGE + heightRangeBonus(dz) && hasLineOfSight(s, p, e.hex);
      })
      .map((e) => e.hex);
  }
  return [];
}

export function recomputeHighlights(s: HexBattleState): void {
  if (s.turn !== 'player' || s.status !== 'active') {
    s.reachable = [];
    s.targetable = [];
    return;
  }
  if (s.selected?.kind === 'move' && s.player.movesLeft > 0) {
    s.reachable = computeReachable(s, s.player.hex, s.player.movesLeft, climbFor(s.player.ag));
    s.targetable = [];
  } else if (s.selected?.kind === 'attack' || s.selected?.kind === 'spell') {
    s.reachable = [];
    s.targetable = computeTargetable(s, s.selected);
  } else {
    s.reachable = [];
    s.targetable = [];
  }
}

/** Re-derive reachable/targetable for s.player + s.selected; mutates s in place.
 *  Called by coopApplyTactics after re-keying the player field to the local client's hero. */
export function recomputeClientHighlights(s: HexBattleState): void {
  recomputeHighlights(s);
}

// --- Enemy threat zone (pure, used for the danger overlay) --------------------------------------
export function computeEnemyThreat(state: HexBattleState): Hex[] {
  const threatened = new Set<string>();
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0 || hasStatus(enemy, 'freeze')) continue;
    const positions = [enemy.hex, ...computeReachable(state, enemy.hex, enemy.moveTiles, enemy.climb)];
    for (const from of positions) {
      const fromZ = elevationAt(state, from);
      for (const tile of Object.values(state.tiles)) {
        if (tile.terrain === 'blocked') continue;
        const tKey = hexKey(tile.hex);
        if (threatened.has(tKey)) continue;
        const dz = fromZ - tile.elevation;
        const effectiveRange = enemy.range <= 1 ? 1 : enemy.range + heightRangeBonus(dz);
        if (hexDistance(from, tile.hex) > effectiveRange) continue;
        if (enemy.range > 1 && !hasLineOfSight(state, from, tile.hex)) continue;
        threatened.add(tKey);
      }
    }
  }
  return [...threatened].map((k) => state.tiles[k].hex);
}
