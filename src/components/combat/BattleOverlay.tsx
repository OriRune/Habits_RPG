import { useGameStore } from '@/store/useGameStore';
import { BattleScene } from './BattleScene';

/** Full-screen Level-Up Trial battle. Thin container around the shared BattleScene. */
export function BattleOverlay() {
  const battle = useGameStore((s) => s.battle);
  const battleAction = useGameStore((s) => s.battleAction);
  const dismissBattle = useGameStore((s) => s.dismissBattle);

  if (!battle) return null;

  return (
    <BattleScene
      battle={battle}
      onAction={battleAction}
      onResolve={dismissBattle}
      resolveWonLabel="Claim Victory & Ascend"
      resolveLostLabel="Retreat (keep your XP)"
      fullscreen
    />
  );
}
