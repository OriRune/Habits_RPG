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
//    - A choice can optionally carry a `check` to make it a Charisma gambit:
//        check.dc        — difficulty class the player's d20 + CH modifier must meet.
//        check.failDelta — favour applied on a failed roll (0 or negative).
//        favorDelta      — favour applied on a SUCCESSFUL roll (the success payoff).
//      Use COURT_DC.easy / .medium / .hard from the engine for consistent DCs.
// ============================================================================

import { COURT_DC } from '@/engine/trials/royalCourt';

export interface SpiritGroveRound {
  omen: string;
  choices: { label: string; clue?: string }[];
  correctIndex: number;
  difficulty: 'easy' | 'medium' | 'hard';
  /** Shown after selection during the feedback pause. */
  explanation?: string;
}

export interface CourtExchange {
  npc: string;
  /** Optional emoji shown beside the NPC name in the dialogue box. */
  icon?: string;
  dialogue: string;
  choices: {
    label: string;
    /**
     * For a safe choice: favour applied immediately.
     * For a gambit (has `check`): favour applied on a SUCCESSFUL roll.
     * Used by the maxFavor formula — a perfect run = pass every gambit.
     */
    favorDelta: number;
    /**
     * Optional — makes this choice a Charisma skill-check gambit.
     * The player rolls d20 + CH modifier against `dc`.
     * On success: `favorDelta` is applied. On failure: `failDelta` is applied.
     * Natural 20 always succeeds; natural 1 always fails.
     */
    check?: {
      /** Difficulty class from COURT_DC.easy / .medium / .hard. */
      dc: number;
      /** Favour applied on a failed roll (0 or negative). */
      failDelta: number;
    };
  }[];
}

// ── Spirit Grove ───────────────────────────────────────────────────────────────
//
// Pool of 15 rounds: 5 easy, 5 medium, 5 hard.
// The trial draws 1 easy + 2 medium + 2 hard per session, presented in that
// order so difficulty ramps across the five rounds.
//
// Easy:   omen maps almost directly to the correct blessing; clues clinch it.
// Medium: omen requires one inference step; one distractor looks plausible.
// Hard:   omen is genuinely ambiguous; two or three choices seem reasonable.

export const SPIRIT_GROVE_ROUNDS: SpiritGroveRound[] = [

  // ── EASY ────────────────────────────────────────────────────────────────────

  {
    difficulty: 'easy',
    omen: 'The bark of the elder tree has split, and sap weeps upward like tears.',
    choices: [
      { label: 'Blessing of Mending', clue: 'Seals wounds and cracks.' },
      { label: 'Blessing of Growth', clue: 'Encourages new life and expansion.' },
      { label: 'Blessing of Silence', clue: 'Stills the restless.' },
      { label: 'Blessing of Fire', clue: 'Purges the old to make way for new.' },
    ],
    correctIndex: 0,
    explanation: 'Sap weeping from a split — the tree is wounded. The spirits call for Mending, not growth or purging.',
  },
  {
    difficulty: 'easy',
    omen: 'The stream runs backwards for three heartbeats, then resumes.',
    choices: [
      { label: 'Blessing of Time', clue: 'Grants patience and perspective.' },
      { label: 'Blessing of Balance', clue: 'Restores harmony to what is upset.' },
      { label: 'Blessing of Strength', clue: 'Fortifies the body against hardship.' },
      { label: 'Blessing of Speed', clue: 'Quickens the slow.' },
    ],
    correctIndex: 1,
    explanation: 'The stream reversed itself — something disturbed its natural course. Balance restores harmony to what is upset.',
  },
  {
    difficulty: 'easy',
    omen: 'Frost appears on the leaves in midsummer, then melts at your touch.',
    choices: [
      { label: 'Blessing of Warmth', clue: 'Counters the cold and comforts.' },
      { label: 'Blessing of Preservation', clue: 'Holds things as they are.' },
      { label: 'Blessing of Change', clue: 'Turns one state into another.' },
      { label: 'Blessing of Clarity', clue: 'Sharpens the clouded mind.' },
    ],
    correctIndex: 0,
    explanation: 'Cold where it has no place, and it yields to your touch. Warmth counters the cold directly.',
  },
  {
    difficulty: 'easy',
    omen: 'A fallen oak now bridges the stream, and fox, deer, and beetle all use it to cross.',
    choices: [
      { label: 'Blessing of Purpose', clue: 'Reveals the use hidden in every form.' },
      { label: 'Blessing of Shelter', clue: 'Guards the vulnerable from harm.' },
      { label: 'Blessing of Unity', clue: 'Draws many into one bond.' },
      { label: 'Blessing of Passage', clue: 'Eases transitions and endings.' },
    ],
    correctIndex: 0,
    explanation: 'The tree does not gather them — they simply use its shape. What has ended has found its purpose, not a shared bond or final crossing.',
  },
  {
    difficulty: 'easy',
    omen: 'Frost on a spider\'s web at dawn makes every thread glow — the whole pattern revealed at once.',
    choices: [
      { label: 'Blessing of Clarity', clue: 'Shows what was always there, sharpened into sight.' },
      { label: 'Blessing of Revelation', clue: 'Draws hidden truths into the open.' },
      { label: 'Blessing of Preservation', clue: 'Holds things exactly as they are.' },
      { label: 'Blessing of Warding', clue: 'Protects against what would intrude.' },
    ],
    correctIndex: 0,
    explanation: 'The web was always there — the frost only made its threads visible. Clarity sharpens what exists; Revelation implies something was concealed.',
  },

  // ── MEDIUM ──────────────────────────────────────────────────────────────────

  {
    difficulty: 'medium',
    omen: 'A raven circles the grove seven times, then lands facing west.',
    choices: [
      { label: 'Blessing of Foresight', clue: 'Sees what lies ahead.' },
      { label: 'Blessing of Passage', clue: 'Eases transitions and endings.' },
      { label: 'Blessing of the Storm', clue: 'Calls change through force.' },
      { label: 'Blessing of Iron Will', clue: 'Hardens the spirit against doubt.' },
    ],
    correctIndex: 1,
    explanation: 'Seven circuits, then facing west — completion and the direction long held to mark endings. Foresight would mean the raven sees ahead, not that it marks a close.',
  },
  {
    difficulty: 'medium',
    omen: 'Three fireflies form a perfect triangle, hold it for a long breath, then scatter.',
    choices: [
      { label: 'Blessing of Union', clue: 'Binds separate things into one purpose.' },
      { label: 'Blessing of Dispersal', clue: 'Spreads what is concentrated.' },
      { label: 'Blessing of Light', clue: 'Illuminates and reveals hidden truths.' },
      { label: 'Blessing of the Wanderer', clue: 'Guides the lost to new paths.' },
    ],
    correctIndex: 0,
    explanation: 'Three things formed a shape together and held it — the scattering came after. The blessing is the act of union, not the dispersal that follows.',
  },
  {
    difficulty: 'medium',
    omen: 'An acorn cracks open and a fully-grown sapling springs out in moments.',
    choices: [
      { label: 'Blessing of Patience', clue: 'The gift of waiting for the right moment.' },
      { label: 'Blessing of Potential', clue: 'Brings latent power to the surface.' },
      { label: 'Blessing of the Harvest', clue: 'Rewards long labour with its due.' },
      { label: 'Blessing of Haste', clue: 'Compresses time and effort.' },
    ],
    correctIndex: 1,
    explanation: 'The sapling was always inside the acorn — it needed only a moment to emerge. Potential brings latent power to the surface; Haste compresses time, which is not the same thing.',
  },
  {
    difficulty: 'medium',
    omen: 'A wolf pup stands at the tree line in silence, watching the storm, and does not step into the open field.',
    choices: [
      { label: 'Blessing of Wisdom', clue: 'Knows the edge of one\'s own readiness.' },
      { label: 'Blessing of Caution', clue: 'Tempers boldness with restraint.' },
      { label: 'Blessing of Fear', clue: 'Heeds the body\'s warning of danger.' },
      { label: 'Blessing of Foresight', clue: 'Reads what the storm will bring.' },
    ],
    correctIndex: 0,
    explanation: 'The pup does not seem frightened — it is still, not shrinking. Wisdom recognises the limit of one\'s current strength. Caution reacts to perceived danger; this pup simply knows where it stands.',
  },
  {
    difficulty: 'medium',
    omen: 'A single candle left burning in an empty hall keeps the darkness at bay all night.',
    choices: [
      { label: 'Blessing of Vigilance', clue: 'Holds watch when all others have gone.' },
      { label: 'Blessing of Perseverance', clue: 'Continues without faltering, however long it takes.' },
      { label: 'Blessing of Defiance', clue: 'Stands firm against what presses in.' },
      { label: 'Blessing of Endurance', clue: 'Weathers what is sustained and heavy.' },
    ],
    correctIndex: 0,
    explanation: 'The candle does not push back and it does not struggle — it simply stays lit, watching. Vigilance holds the watch; Perseverance and Endurance imply contest, but darkness is merely the candle\'s natural companion.',
  },

  // ── HARD ────────────────────────────────────────────────────────────────────

  {
    difficulty: 'hard',
    omen: 'The shadow of the great oak falls toward the sun at noon.',
    choices: [
      { label: 'Blessing of Defiance', clue: 'Acts against the expected order by choice.' },
      { label: 'Blessing of Inversion', clue: 'Reverses what the natural order dictates.' },
      { label: 'Blessing of Will', clue: 'Holds its shape against all pressure.' },
      { label: 'Blessing of the Omen', clue: 'Carries a sign that demands to be read.' },
    ],
    correctIndex: 0,
    explanation: 'Shadows always fall away from the sun — this one does not. It is not a mistake of the light; it is deliberate opposition to nature\'s rule. Defiance acts against the order by choice. Inversion merely reverses — it does not choose.',
  },
  {
    difficulty: 'hard',
    omen: 'Smoke rises from a cold, unlit hearth — no embers, no flame, only the scent of old wood.',
    choices: [
      { label: 'Blessing of Memory', clue: 'Carries the trace of what once was.' },
      { label: 'Blessing of Haunting', clue: 'Holds a place between what was and what is.' },
      { label: 'Blessing of Return', clue: 'Draws what is absent back to where it belonged.' },
      { label: 'Blessing of Longing', clue: 'Reaches across time toward something absent.' },
    ],
    correctIndex: 0,
    explanation: 'The fire is gone, but its mark remains in the smoke. Memory carries the trace of what once was — it does not summon anything back, nor does it grieve. The smoke does not call anyone home; it only remembers.',
  },
  {
    difficulty: 'hard',
    omen: 'A river bends sharply around the base of a mountain rather than cutting through it.',
    choices: [
      { label: 'Blessing of Prudence', clue: 'Takes the path that avoids what cannot be overcome.' },
      { label: 'Blessing of Wisdom', clue: 'Knows the true limit of its own strength.' },
      { label: 'Blessing of Patience', clue: 'Waits for what will not yield to soften in time.' },
      { label: 'Blessing of Perseverance', clue: 'Keeps moving long after the easy paths are gone.' },
    ],
    correctIndex: 0,
    explanation: 'The river does not wait, and it does not grind the mountain down — it bends. Prudence is the act of choosing the better path. Wisdom would be knowing the mountain cannot be cut; Prudence is going around it.',
  },
  {
    difficulty: 'hard',
    omen: 'A bird continues its call in a forest where all its kind have already flown south for winter.',
    choices: [
      { label: 'Blessing of Faithfulness', clue: 'Keeps faith with what was, even when all else has left.' },
      { label: 'Blessing of Grief', clue: 'Sings what cannot be taken back.' },
      { label: 'Blessing of Solitude', clue: 'Finds strength in standing alone with what is.' },
      { label: 'Blessing of Folly', clue: 'Continues past the point of usefulness.' },
    ],
    correctIndex: 0,
    explanation: 'The bird is not lost — it calls because it has always called. It stays not because it cannot leave but because it will not. Faithfulness, not grief or folly — those would imply the bird knows something is wrong.',
  },
  {
    difficulty: 'hard',
    omen: 'At the moment of the first snowfall, every remaining leaf on every tree falls at once.',
    choices: [
      { label: 'Blessing of Release', clue: 'Lets go of what has been held past its time.' },
      { label: 'Blessing of Surrender', clue: 'Yields to what cannot be refused.' },
      { label: 'Blessing of Endings', clue: 'Marks the close of what has run its full course.' },
      { label: 'Blessing of Accord', clue: 'Brings separate things into alignment.' },
    ],
    correctIndex: 0,
    explanation: 'The leaves did not fall from wind or rot — they waited for the snow, then let go together. Release is a choice, even when it is the right one. Surrender implies defeat; Endings is what follows the act, not the act itself.',
  },
];

// Each session draws 1 easy + 2 medium + 2 hard from the pool above.
// Five rounds give all three star tiers: 4–5 correct → 3★, 2–3 → 2★, 0–1 → 1★.
export const SPIRIT_GROVE_ROUND_COUNT = 5;

// ── Royal Court ────────────────────────────────────────────────────────────────

export const ROYAL_COURT_EXCHANGES: CourtExchange[] = [
  // ── Original six ──────────────────────────────────────────────────────────────
  {
    npc: 'The Court Herald',
    icon: '📯',
    dialogue:
      '"The queen has been informed of your… arrival. She values proper decorum above all else. What do you say to announce yourself?"',
    choices: [
      { label: '"I come with tidings of great import, Your Grace."', favorDelta: 2 },
      { label: '"I\'m here. Where\'s the queen?"', favorDelta: -1 },
      { label: '"It is my profound honour to attend the court today."', favorDelta: 3 },
      // 🎲 Gambit — blunt candour. High CH turns it into refreshing confidence; low CH reads as flat rudeness.
      { label: '"I was told to show up. So here I am."', favorDelta: 4, check: { dc: COURT_DC.medium, failDelta: -3 } },
    ],
  },
  {
    npc: 'Lord Aldric (rival courtier)',
    icon: '⚔️',
    dialogue:
      '"Interesting to see an outsider at court. Tell me — what exactly qualifies you to stand in the queen\'s presence?"',
    choices: [
      { label: '"The same qualities that brought you here, I\'d wager."', favorDelta: 2 },
      { label: '"More than you, clearly."', favorDelta: -2 },
      { label: '"I have served the realm faithfully and ask only for an audience."', favorDelta: 3 },
      // 🎲 Gambit — bold defiance in the queen's court. High CH commands the room; low CH is simply rude.
      { label: '"I don\'t answer to you."', favorDelta: 4, check: { dc: COURT_DC.hard, failDelta: -3 } },
    ],
  },
  {
    npc: 'Lady Serafin (royal advisor)',
    icon: '📜',
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
    // Queen's encounter is weighted: her best response rewards +4 favour instead
    // of +3, making this the pivotal exchange in any session she appears in.
    npc: 'Queen Elowen',
    icon: '👑',
    dialogue:
      '"You have come far. Tell me honestly — what do you hope to gain from my favour?"',
    choices: [
      { label: '"To serve the realm and earn your trust, nothing more."', favorDelta: 4 },
      { label: '"Gold and a title would be a fine start."', favorDelta: -1 },
      { label: '"The chance to prove my worth in your service."', favorDelta: 2 },
      { label: '"Permission to do what I came here to do."', favorDelta: 0 },
    ],
  },
  {
    npc: 'The Court Jester',
    icon: '🎭',
    dialogue:
      '"Quick — the queen loves wit! Make her laugh before the bell tolls!"',
    choices: [
      { label: '"I see the bell is the only thing in this court that tells the truth."', favorDelta: 3 },
      { label: '"Ha. Ha. Ha. I am being funny now."', favorDelta: -1 },
      // 🎲 Gambit — grand theatrical confidence. High CH draws a genuine laugh; low CH draws silence.
      { label: '"Your Majesty, my arrival alone should suffice as entertainment."', favorDelta: 4, check: { dc: COURT_DC.medium, failDelta: -2 } },
      { label: '"I am not here to perform."', favorDelta: -2 },
    ],
  },
  {
    npc: 'The Master of Coin',
    icon: '💰',
    dialogue:
      '"The royal treasury funds everything, including your little venture. How would you justify the expense?"',
    choices: [
      { label: '"Every coin invested will return tenfold to the crown."', favorDelta: 2 },
      { label: '"The cost is trivial compared to the risk of inaction."', favorDelta: 3 },
      { label: '"You\'ll have to trust me."', favorDelta: 0 },
      { label: '"It\'s a small price for glory, surely?"', favorDelta: 1 },
    ],
  },

  // ── Eight additional exchanges ────────────────────────────────────────────────
  {
    npc: 'Lady Brienna (lady-in-waiting)',
    icon: '💌',
    dialogue:
      '"Forgive the interruption — a sealed letter has arrived from the queen\'s private quarters. Lord Aldric is mid-sentence beside you. The herald watches."',
    choices: [
      { label: '"Excuse me a moment." You step aside and read it at once.', favorDelta: 3 },
      { label: 'You pocket the letter and finish the conversation first.', favorDelta: -1 },
      { label: 'You open it openly in front of Lord Aldric.', favorDelta: 1 },
      { label: '"Ask the herald to return later — we are occupied."', favorDelta: -3 },
    ],
  },
  {
    npc: 'The Court Chronicler',
    icon: '📖',
    dialogue:
      '"I compile the record of all who stand before the queen. What single quality would you have me note beside your name?"',
    choices: [
      { label: '"My loyalty to the crown, above all else."', favorDelta: 3 },
      { label: '"The respect I carry for those who came before me."', favorDelta: 2 },
      { label: '"My victories — let them speak for themselves."', favorDelta: 1 },
      { label: '"I\'d rather not be reduced to a single word."', favorDelta: -1 },
    ],
  },
  {
    npc: 'Ambassador Kessir (foreign envoy)',
    icon: '🌍',
    dialogue:
      '"In my homeland, honoured guests are welcomed with a shared cup — unfiltered, faintly bitter. The queen watches your reaction."',
    choices: [
      // 🎲 Gambit — drain the cup with a smile and hold eye contact throughout. High CH makes it effortlessly charming; low CH ends in a cough.
      { label: 'You accept with a gracious smile and drink without hesitation.', favorDelta: 4, check: { dc: COURT_DC.easy, failDelta: -2 } },
      { label: 'You accept, lift the cup, and take a small sip.', favorDelta: 2 },
      { label: 'You accept graciously but set the cup aside, untouched.', favorDelta: 1 },
      { label: 'You decline politely, citing unfamiliarity with foreign customs.', favorDelta: -2 },
    ],
  },
  {
    npc: 'The Royal Steward',
    icon: '🍽️',
    dialogue:
      '"The kitchen staff has taken ill — three days before the queen\'s birthday banquet. Your name was put forward to oversee arrangements. What do you say?"',
    choices: [
      { label: '"I accept. Tell me what must be done."', favorDelta: 3 },
      { label: '"I can help, but I\'ll need experienced hands beside me."', favorDelta: 2 },
      { label: '"I can offer ideas, though I\'m no steward."', favorDelta: 1 },
      { label: '"There must be someone better suited than I."', favorDelta: -2 },
    ],
  },
  {
    npc: 'Lady Voss (scheming noble)',
    icon: '🕯️',
    dialogue:
      '"Word of advice, since you\'re new here — stay clear of Lord Aldric\'s affairs. A friend in the right place could make your time at court considerably easier."',
    choices: [
      { label: '"I appreciate the counsel, but I prefer to make my own judgements."', favorDelta: 3 },
      { label: '"Duly noted. I\'ll bear that in mind."', favorDelta: 1 },
      // 🎲 Gambit — call her bluff directly. High CH earns her respect; low CH reads as clumsy and suspicious.
      { label: '"That sounds very much like an offer. What would you want in return?"', favorDelta: 3, check: { dc: COURT_DC.medium, failDelta: -2 } },
      { label: '"Lord Aldric seems perfectly reasonable to me."', favorDelta: -2 },
    ],
  },
  {
    npc: 'Captain Rhovas (palace guard)',
    icon: '🛡️',
    dialogue:
      '"A courtier has accused your travelling companion of theft. No hard evidence — her word against his. I await your response before acting."',
    choices: [
      { label: '"I vouch for my companion and ask that all evidence be heard first."', favorDelta: 3 },
      // 🎲 Gambit — publicly challenge the accuser's credibility. High CH sways the room; low CH seems presumptuous.
      { label: '"Question the accuser\'s motivations — something feels wrong here."', favorDelta: 4, check: { dc: COURT_DC.medium, failDelta: -2 } },
      { label: '"Defer to the palace\'s justice — whatever you decide."', favorDelta: 1 },
      { label: '"Detain my companion for now. I won\'t interfere with palace law."', favorDelta: -2 },
    ],
  },
  {
    npc: 'A young page',
    icon: '🪶',
    dialogue:
      '"A boy of perhaps ten trips and spills ink across your formal documents — moments before your audience with the queen. He looks up, horrified."',
    choices: [
      { label: 'You help him up and reassure him quietly before continuing.', favorDelta: 3 },
      { label: 'You set the papers aside and ask a servant to prepare replacements.', favorDelta: 2 },
      { label: 'You signal a guard to remove the child and hurry on.', favorDelta: -1 },
      { label: 'You send the child away firmly and ask the queen to delay.', favorDelta: -2 },
    ],
  },
  {
    npc: 'The Royal Physician',
    icon: '⚕️',
    dialogue:
      '"The queen has noted your absence from morning audience last week. She asks — through me — whether you are well enough for court duties."',
    choices: [
      { label: '"I am fully recovered and entirely at Her Majesty\'s service."', favorDelta: 3 },
      { label: '"I was unwell, but did not wish to trouble the court."', favorDelta: 2 },
      { label: '"Fatigue from travel, nothing more. I am fine."', favorDelta: 1 },
      // 🎲 Gambit — push back on being called to account. High CH reads as principled; low CH reads as entitled.
      { label: '"I was not informed my schedule required accounting."', favorDelta: 3, check: { dc: COURT_DC.hard, failDelta: -3 } },
    ],
  },
];

// The trial picks 4 exchanges at random from this pool each day.
export const ROYAL_COURT_EXCHANGE_COUNT = 4;
