// Guards the authored boss movesets (item 5.2): every named boss (each phase) and the
// generic Trial Guardian must expose a well-formed 3-move set the combat engine can run.
import { describe, it, expect } from 'vitest';
import {
  NAMED_BOSSES,
  TRIAL_GUARDIAN_MOVESET,
  bossForLevel,
  type EnemyMove,
  type EnemyMoveKind,
} from '../bosses';

const VALID_KINDS = new Set<EnemyMoveKind>([
  'attack', 'heavy', 'multi', 'guard', 'inflict', 'drain', 'enrage',
]);
const VALID_INFLICT = new Set(['burn', 'poison', 'weaken', 'blind', 'freeze']);

function checkMoveset(label: string, moveset: EnemyMove[] | undefined) {
  expect(moveset, `${label} has a moveset`).toBeDefined();
  expect(moveset!.length, `${label} has exactly 3 moves`).toBe(3);
  for (const m of moveset!) {
    expect(VALID_KINDS.has(m.kind), `${label} move kind ${m.kind} is valid`).toBe(true);
    expect(m.label.trim().length, `${label} move has a non-empty label`).toBeGreaterThan(0);
    if (m.inflictKey != null) {
      expect(VALID_INFLICT.has(m.inflictKey), `${label} inflictKey ${m.inflictKey} is valid`).toBe(true);
    }
  }
}

describe('boss movesets are authored and well-formed', () => {
  it('every named boss (all phases) has a valid 3-move moveset', () => {
    for (const [tier, boss] of Object.entries(NAMED_BOSSES)) {
      if (boss.phases && boss.phases.length > 0) {
        boss.phases.forEach((p, i) => checkMoveset(`boss L${tier} phase ${i}`, p.moveset));
      } else {
        checkMoveset(`boss L${tier}`, boss.moveset);
      }
    }
  });

  it('the generic Trial Guardian has a valid 3-move moveset', () => {
    checkMoveset('Trial Guardian constant', TRIAL_GUARDIAN_MOVESET);
    // And it is actually wired into the generic fallback (a non-named tier).
    checkMoveset('bossForLevel(7)', bossForLevel(7).moveset);
  });
});
