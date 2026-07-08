// Hex Tactics — a turn-based tactical skirmish on the flat-top hex grid (src/engine/hex.ts).
// Where the Arena is real-time, this is deliberate: the player's single character (their real
// stat levels) faces 2–5 AI foes on a board where every tile has an elevation (Z) and a terrain
// type. High ground hits harder and shoots farther; Agility — otherwise unused in any minigame —
// drives how far you move and how high you can climb in a turn (plus the dodge it already grants).
//
// Like the other minigames this is a pure engine: every rule returns a NEW HexBattleState and all
// randomness is injected. The store owns the state; a thin overlay calls these. Damage math is the
// shared turn-based combat (attackRoll / spellDamageRoll / spellHealAmount / variance in
// src/engine/combat.ts) with elevation/cover folded into `power`/`defense` before the roll, so the
// numbers feel identical to the rest of the game.
//
// This barrel re-exports the module's public surface. The implementation is split (ARCH-10 shape)
// across ./state, ./geometry, ./combat, ./ai, ./turns, ./generation, ./rewards — importers use
// `@/engine/hexBattle` and never reach into a submodule.

// --- state: types, tuning constants, and small pure helpers -------------------------------------
export type {
  TacticsSize,
  TerrainKind,
  Tile,
  UnitStatus,
  PlayerUnit,
  EnemyUnit,
  Turn,
  SelectedAction,
  TacticalEffect,
  HexBattleStatus,
  EnemyIntent,
  AttackPreview,
  TacticsObjectiveKind,
  TacticsObjective,
  HexBattleState,
} from './state';
export {
  TACTICS_ENERGY_COST,
  TACTICS_UNLOCK_LEVEL,
  TACTICS_BOARD_RADIUS,
  TACTICS_SIZE_RADIUS,
  COVER_DEFENSE,
  HAZARD_DMG,
  SPELL_RANGE,
  MAX_ELEVATION,
  OCCLUSION_RISE,
  EFFECT_STAGGER_MS,
  MOVE_ANIM_MS,
  STA_REGEN_PER_TURN,
  LUNGE_AFTER_TURNS,
  TACTICS_GRANTED_SPELLS,
  isTacticsLoadoutSpell,
  isChaser,
  lungePending,
  moveBudgetFor,
  moveTilesFor,
  climbFor,
  heightDamageMult,
  heightRangeBonus,
  tileAt,
  livingHeroes,
  nearestHero,
  enemyAt,
} from './state';

// --- geometry: reachability, line of sight, targeting, threat -----------------------------------
export {
  computeReachable,
  hasLineOfSight,
  computeTargetable,
  recomputeClientHighlights,
  computeEnemyThreat,
  computeEnemyThreatCounts,
} from './geometry';

// --- combat: player actions and previews --------------------------------------------------------
export {
  previewPlayerAttack,
  previewSpell,
  selectAction,
  movePlayer,
  playerAttack,
  holdOverwatch,
  playerCastSpell,
} from './combat';

// --- ai: archetypes, movement, intent -----------------------------------------------------------
export type { AIArchetype } from './ai';
export {
  ARCHETYPE_INFO,
  bestMoveFor,
  climbForEnemy,
  planEnemyIntents,
} from './ai';

// --- turns: turn sequencing ---------------------------------------------------------------------
export { endPlayerTurn } from './turns';

// --- generation: board & match setup ------------------------------------------------------------
export type { HeroOpts, GenerateOpts } from './generation';
export {
  TERRAIN_ICONS,
  tacticsSizeBonus,
  generateSkirmish,
} from './generation';

// --- rewards ------------------------------------------------------------------------------------
export { tacticsDamageFraction, tacticsReward } from './rewards';
