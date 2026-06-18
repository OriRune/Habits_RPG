import { useState } from 'react';
import { Swords, Grid3x3 } from 'lucide-react';
import { HubGrid, type HubCard } from '@/components/layout/HubGrid';
import { SubModeFrame } from '@/components/layout/SubModeFrame';
import { ArenaView } from '@/views/ArenaView';
import { TacticsView } from '@/views/TacticsView';

type BattleMode = 'arena' | 'tactics';

const CARDS: HubCard<BattleMode>[] = [
  {
    id: 'arena',
    label: 'Arena',
    icon: Swords,
    blurb:
      'Face the arena boss in real-time combat. Dodge telegraphed attacks, cast spells, and prove your reflexes.',
    guide: {
      sections: [
        {
          heading: 'Goal',
          items: [
            'Deplete the boss HP through every phase without dying.',
            'Every attack lights up the tiles it will hit — step off the marked tiles in time.',
            'Win for the full bounty; fall and you keep half of what you earned.',
          ],
        },
        {
          heading: 'Controls',
          items: [
            'Move: W/A/S/D or arrow keys. Hold two adjacent keys for a diagonal.',
            'Attack: Space or Enter — bolts from range, swings melee if an enemy is adjacent.',
            'Click an ability in the bar to bind it to left- or right-click, then click the board to fire in that direction.',
            'Retreat: safely bank your earned share without finishing the fight.',
          ],
        },
        {
          heading: 'Legend',
          legend: [
            { icon: '🧝', label: 'You' },
            { icon: '👹', label: 'Boss (also 🗿 Golem · 🫧 Slime)' },
            { icon: '🦇', label: 'Minion' },
            { icon: '🪨', label: 'Cover — blocks movement and projectiles (also 🌲 🪵)' },
            { icon: '🔥', label: 'Rune trap — triggers on contact (also ❄️ · ☠️)' },
            { icon: '🟥', label: 'Red danger tile — incoming physical attack' },
            { icon: '🟪', label: 'Purple danger tile — incoming magic attack' },
            { icon: '💥', label: 'Telegraph: slam (also ➡️ line · ✸ nova · ⁂ volley)' },
          ],
        },
      ],
    },
  },
  {
    id: 'tactics',
    label: 'Hex Tactics',
    icon: Grid3x3,
    blurb:
      'Command your forces in a turn-based isometric hex skirmish. Position, ability timing, and terrain mastery decide the day.',
    guide: {
      sections: [
        {
          heading: 'Goal',
          items: [
            'Defeat all enemies on the hex board to win.',
            'High ground gives bonus damage and extended weapon/spell reach.',
            'Agility sets how far you move and how high you can climb each turn.',
          ],
        },
        {
          heading: 'Controls',
          items: [
            'Move → click a cyan tile. Moving is free and does not use your action.',
            'Strike / Shoot → click Strike/Shoot, then click an amber-highlighted enemy.',
            'Spell → click a spell button, then click your target (support spells fire immediately).',
            'Hold ⌖ → arm Overwatch: auto-fire at the first enemy that moves into range on their turn.',
            'End turn → pass to the enemy phase.',
            'Danger zone & Enemy intents toggles (top-left HUD) reveal threat tiles and planned moves.',
          ],
        },
        {
          heading: 'Spells & loadout',
          items: [
            'Bring up to 3 known spells into each match via the loadout picker.',
            'Push, Blink, and Cleave are always granted free — not counted in your loadout.',
            'Push hurls a foe 2 tiles (bonus dmg into walls or hazards).',
            'Blink teleports you to any open tile within 2 squares, ignoring terrain.',
            'Cleave strikes every adjacent enemy in one sweep.',
          ],
        },
        {
          heading: 'Legend',
          legend: [
            { icon: '🧝', label: 'You' },
            { icon: '🔴', label: 'Charger — closes fast' },
            { icon: '🔵', label: 'Kiter — stays at range, seeks high ground' },
            { icon: '🟠', label: 'Holder — digs in, guards position' },
            { icon: '🟣', label: 'Flanker — circles to a new angle' },
            { icon: '🛡️', label: 'Cover tile (+defense)' },
            { icon: '🌿', label: 'Slow tile (costs 2 movement)' },
            { icon: '🔥', label: 'Hazard tile (damage if you end turn on it)' },
            { icon: '🪨', label: 'Wall — impassable' },
            { icon: '▲', label: 'Elevation indicator (shown when moving/targeting)' },
            { icon: '◎', label: 'Beacon objective tile' },
            { icon: '⬆', label: 'Weak vs your attack — bonus damage' },
            { icon: '⬇', label: 'Resist vs your attack — reduced damage' },
          ],
        },
        {
          heading: 'Bonus objectives',
          items: [
            '◎ Hold the Beacon — keep the marked tile enemy-free for 5 consecutive turns.',
            '⚡ Swift Strike — win the match within the turn budget.',
            '✨ Unscathed — win without dropping below 50% HP.',
            'Complete any objective (and win) for +60% gold and a guaranteed healing potion.',
          ],
        },
      ],
    },
  },
];

export function BattleView() {
  const [mode, setMode] = useState<BattleMode | null>(null);

  if (!mode) {
    return (
      <HubGrid
        title="Battle"
        description="Choose your fight — real-time arena combat or turn-based hex tactics."
        cards={CARDS}
        onPick={setMode}
      />
    );
  }

  return (
    <SubModeFrame backLabel="Back to Battle" onBack={() => setMode(null)}>
      {mode === 'arena'   && <ArenaView />}
      {mode === 'tactics' && <TacticsView />}
    </SubModeFrame>
  );
}
