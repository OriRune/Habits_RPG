// ============================================================================
//  SKILL TRIAL CONTENT — edit this file to tune Spirit Grove and Royal Court.
// ============================================================================
//
//  Spirit Grove: the player reads an omen and picks the correct blessing.
//  Royal Court:  the player navigates social exchanges to earn the queen's favour.
//
//  HOW TO EDIT
//  -----------
//  Spirit Grove rounds:
//    - `omen`: flavour text shown to the player.
//    - `choices`: array of blessing options (label + optional clue).
//    - `correctIndex`: which choice is correct (0-based).
//  Royal Court scene:
//    - `npc`: who is speaking.
//    - `dialogue`: what they say.
//    - `choices`: player responses, each with a `label` and hidden `favorDelta`.
//      Positive = earns favour, negative = loses it; the player can't see the delta.
//      Max favour = sum of best choice per exchange.
// ============================================================================

export interface SpiritGroveRound {
  omen: string;
  choices: { label: string; clue?: string }[];
  correctIndex: number;
}

export interface CourtExchange {
  npc: string;
  dialogue: string;
  choices: { label: string; favorDelta: number }[];
}

// ── Spirit Grove ───────────────────────────────────────────────────────────────

export const SPIRIT_GROVE_ROUNDS: SpiritGroveRound[] = [
  {
    omen: 'The bark of the elder tree has split, and sap weeps upward like tears.',
    choices: [
      { label: 'Blessing of Mending', clue: 'Seals wounds and cracks.' },
      { label: 'Blessing of Growth', clue: 'Encourages new life and expansion.' },
      { label: 'Blessing of Silence', clue: 'Stills the restless.' },
      { label: 'Blessing of Fire', clue: 'Purges the old to make way for new.' },
    ],
    correctIndex: 0,
  },
  {
    omen: 'A raven circles the grove seven times, then lands facing west.',
    choices: [
      { label: 'Blessing of Foresight', clue: 'Sees what lies ahead.' },
      { label: 'Blessing of Passage', clue: 'Eases transitions and endings.' },
      { label: 'Blessing of the Storm', clue: 'Calls change through force.' },
      { label: 'Blessing of Iron Will', clue: 'Hardens the spirit against doubt.' },
    ],
    correctIndex: 1,
  },
  {
    omen: 'The stream runs backwards for three heartbeats, then resumes.',
    choices: [
      { label: 'Blessing of Time', clue: 'Grants patience and perspective.' },
      { label: 'Blessing of Balance', clue: 'Restores harmony to what is upset.' },
      { label: 'Blessing of Strength', clue: 'Fortifies the body against hardship.' },
      { label: 'Blessing of Speed', clue: 'Quickens the slow.' },
    ],
    correctIndex: 1,
  },
  {
    omen: 'Three fireflies form a perfect triangle, hold it for a long breath, then scatter.',
    choices: [
      { label: 'Blessing of Union', clue: 'Binds separate things into one purpose.' },
      { label: 'Blessing of Dispersal', clue: 'Spreads what is concentrated.' },
      { label: 'Blessing of Light', clue: 'Illuminates and reveals hidden truths.' },
      { label: 'Blessing of the Wanderer', clue: 'Guides the lost to new paths.' },
    ],
    correctIndex: 0,
  },
  {
    omen: 'Frost appears on the leaves in midsummer, then melts at your touch.',
    choices: [
      { label: 'Blessing of Warmth', clue: 'Counters the cold and comforts.' },
      { label: 'Blessing of Preservation', clue: 'Holds things as they are.' },
      { label: 'Blessing of Change', clue: 'Turns one state into another.' },
      { label: 'Blessing of Clarity', clue: 'Sharpens the clouded mind.' },
    ],
    correctIndex: 0,
  },
  {
    omen: 'An acorn cracks open and a fully-grown sapling springs out in moments.',
    choices: [
      { label: 'Blessing of Patience', clue: 'The gift of waiting.' },
      { label: 'Blessing of Potential', clue: 'Brings latent power to the surface.' },
      { label: 'Blessing of the Harvest', clue: 'Rewards long labour.' },
      { label: 'Blessing of Haste', clue: 'Compresses time and effort.' },
    ],
    correctIndex: 1,
  },
];

// The trial picks 3 rounds at random from this pool each day.
export const SPIRIT_GROVE_ROUND_COUNT = 3;

// ── Royal Court ────────────────────────────────────────────────────────────────

export const ROYAL_COURT_EXCHANGES: CourtExchange[] = [
  {
    npc: 'The Court Herald',
    dialogue:
      '"The queen has been informed of your… arrival. She values proper decorum above all else. What do you say to announce yourself?"',
    choices: [
      { label: '"I come with tidings of great import, Your Grace."', favorDelta: 2 },
      { label: '"I\'m here. Where\'s the queen?"', favorDelta: -1 },
      { label: '"It is my profound honour to attend the court today."', favorDelta: 3 },
      { label: '"I was told to show up. So here I am."', favorDelta: -2 },
    ],
  },
  {
    npc: 'Lord Aldric (rival courtier)',
    dialogue:
      '"Interesting to see an outsider at court. Tell me — what exactly qualifies you to stand in the queen\'s presence?"',
    choices: [
      { label: '"The same qualities that brought you here, I\'d wager."', favorDelta: 2 },
      { label: '"More than you, clearly."', favorDelta: -2 },
      { label: '"I have served the realm faithfully and ask only for an audience."', favorDelta: 3 },
      { label: '"I don\'t answer to you."', favorDelta: -3 },
    ],
  },
  {
    npc: 'Lady Serafin (royal advisor)',
    dialogue:
      '"Her Majesty will ask you about the village water crisis. Do you favour the speed of redirecting the eastern river, or the care of digging new wells?"',
    choices: [
      { label: '"Speed is vital — redirect the river at once."', favorDelta: 1 },
      { label: '"The villagers deserve a lasting solution — we should dig the wells."', favorDelta: 3 },
      { label: '"I\'d consult the villagers themselves before deciding."', favorDelta: 2 },
      { label: '"That\'s not my problem to solve."', favorDelta: -3 },
    ],
  },
  {
    npc: 'Queen Elowen',
    dialogue:
      '"You have come far. Tell me honestly — what do you hope to gain from my favour?"',
    choices: [
      { label: '"To serve the realm and earn your trust, nothing more."', favorDelta: 3 },
      { label: '"Gold and a title would be a fine start."', favorDelta: -1 },
      { label: '"The chance to prove my worth in your service."', favorDelta: 2 },
      { label: '"Permission to do what I came here to do."', favorDelta: 0 },
    ],
  },
  {
    npc: 'The Court Jester',
    dialogue:
      '"Quick — the queen loves wit! Make her laugh before the bell tolls!"',
    choices: [
      { label: '"I see the bell is the only thing in this court that tells the truth."', favorDelta: 3 },
      { label: '"Ha. Ha. Ha. I am being funny now."', favorDelta: -1 },
      { label: '"Your Majesty, my arrival alone should suffice as entertainment."', favorDelta: 2 },
      { label: '"I am not here to perform."', favorDelta: -2 },
    ],
  },
  {
    npc: 'The Master of Coin',
    dialogue:
      '"The royal treasury funds everything, including your little venture. How would you justify the expense?"',
    choices: [
      { label: '"Every coin invested will return tenfold to the crown."', favorDelta: 2 },
      { label: '"The cost is trivial compared to the risk of inaction."', favorDelta: 3 },
      { label: '"You\'ll have to trust me."', favorDelta: 0 },
      { label: '"It\'s a small price for glory, surely?"', favorDelta: 1 },
    ],
  },
];

// The trial picks 4 exchanges at random from this pool each day.
export const ROYAL_COURT_EXCHANGE_COUNT = 4;
