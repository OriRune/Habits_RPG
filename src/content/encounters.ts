// ============================================================================
//  ENCOUNTERS — edit this file to add, change, or remove DnD-style text events.
// ============================================================================
//
//  HOW TO EDIT
//  -----------
//  • Each entry is `key: { title, start, nodes }`. Biomes (content/biomes.ts) list
//    which encounter keys they draw from.
//  • A node has `text` (narration) and optional `choices`. No choices = the encounter
//    ends at that node. The run reaches a checkpoint after the floor's last room.
//  • A choice with a `stat` is a check: on success it goes to `goSuccess`, on fail to
//    `goFail`; `successText`/`failText` are the result lines. A choice without a stat
//    just goes to `go`. `difficulty` ~10–14 (higher = harder). Tune freely.
//  • Loot/heals: `reward` (always) / `rewardOnSuccess`; `hpOnFail` (damage on a miss);
//    `hpOnSuccess` / `staOnSuccess` / `mpOnSuccess` (restore on a hit). Material keys
//    come from content/materials.ts.
// ============================================================================
import type { EncounterDef } from '@/engine/encounters';

export const ENCOUNTERS: Record<string, EncounterDef> = {
  // --- Catacombs ----------------------------------------------------------
  sealed_door: {
    key: 'sealed_door',
    title: 'The Sealed Door',
    start: 'door',
    nodes: {
      door: {
        id: 'door',
        text: 'A door of black iron, sealed with shifting runes, blocks the passage.',
        choices: [
          {
            label: 'Decipher the runes (Knowledge)',
            stat: 'KN',
            difficulty: 12,
            goSuccess: 'opened',
            goFail: 'locked',
            successText: 'The glyphs align and the bolts slide free.',
            failText: 'A glyph flares and lashes you with arcane backlash.',
            rewardOnSuccess: { gold: 30, materials: { crystals: 1 } },
            hpOnFail: -8,
          },
          {
            label: 'Wrench it open (Strength)',
            stat: 'ST',
            difficulty: 14,
            goSuccess: 'forced',
            goFail: 'locked',
            successText: 'Hinges scream and give way.',
            failText: 'The iron holds; you wrench your shoulder against it.',
            rewardOnSuccess: { gold: 20, materials: { iron_bar: 1 } },
            hpOnFail: -10,
          },
        ],
      },
      locked: {
        id: 'locked',
        text: 'Still sealed, the door mocks you. There must be another way through.',
        choices: [
          {
            label: 'Search for a hidden catch (Dexterity)',
            stat: 'DX',
            difficulty: 12,
            goSuccess: 'opened',
            goFail: 'giveup',
            successText: 'Your fingers find a recessed catch — click.',
            failText: 'Nothing. You squeeze through a crack instead, scraping skin.',
            rewardOnSuccess: { gold: 25 },
            hpOnFail: -6,
          },
          { label: 'Leave it and move on', go: 'giveup', successText: 'You abandon the door and press deeper.' },
        ],
      },
      opened: { id: 'opened', text: "Beyond lies a scholar's cache, long undisturbed." },
      forced: { id: 'forced', text: 'The way is open — and a fallen pack spills its contents at your feet.' },
      giveup: { id: 'giveup', text: "You move on, the cache's secrets left behind in the dark." },
    },
  },

  gatekeeper: {
    key: 'gatekeeper',
    title: 'The Gatekeeper',
    start: 'meet',
    nodes: {
      meet: {
        id: 'meet',
        text: "A spectral gatekeeper bars the way. 'A toll,' it intones, 'or a clever tongue.'",
        choices: [
          {
            label: 'Charm it (Charisma)',
            stat: 'CH',
            difficulty: 12,
            goSuccess: 'passed',
            goFail: 'angered',
            successText: 'Flattery softens the wraith; it waves you through.',
            failText: 'Your words ring hollow. It bristles with cold light.',
            rewardOnSuccess: { gold: 40 },
          },
          {
            label: 'Reason with it (Wisdom)',
            stat: 'WI',
            difficulty: 13,
            goSuccess: 'passed',
            goFail: 'angered',
            successText: 'You name the old compact; bound by it, the gatekeeper yields.',
            failText: 'It rejects your logic with a hollow laugh.',
            rewardOnSuccess: { gold: 35, materials: { crystals: 1 } },
          },
        ],
      },
      angered: {
        id: 'angered',
        text: 'The gatekeeper raises a spectral blade. This is your last chance.',
        choices: [
          {
            label: 'Slip past it (Agility)',
            stat: 'AG',
            difficulty: 13,
            goSuccess: 'passed',
            goFail: 'struck',
            successText: 'You dart through the gate before it can react.',
            failText: 'It catches you a glancing blow as you bolt through.',
            hpOnFail: -12,
          },
          {
            label: 'Force the gate (Strength)',
            stat: 'ST',
            difficulty: 14,
            goSuccess: 'forced',
            goFail: 'struck',
            successText: 'You batter the gate from its hinges.',
            failText: "The wraith's blade bites deep before you break through.",
            rewardOnSuccess: { materials: { bronze_bar: 1 } },
            hpOnFail: -14,
          },
        ],
      },
      passed: { id: 'passed', text: 'The gate swings open without a fight.' },
      forced: { id: 'forced', text: 'You break through, the gatekeeper howling into silence behind you.' },
      struck: { id: 'struck', text: 'Bloodied, you stumble past as the apparition fades.' },
    },
  },

  bone_pit: {
    key: 'bone_pit',
    title: 'The Bone Pit',
    start: 'pit',
    nodes: {
      pit: {
        id: 'pit',
        text: 'The floor gives way into a pit of clattering bones that drag at your limbs.',
        choices: [
          {
            label: 'Power through the morass (Endurance)',
            stat: 'EN',
            difficulty: 12,
            goSuccess: 'climbed',
            goFail: 'sinking',
            successText: 'Lungs burning, you haul yourself free.',
            failText: 'The bones drag you down into the cold heap.',
            rewardOnSuccess: { gold: 20, materials: { herbs: 1 } },
            hpOnFail: -8,
          },
          {
            label: 'Pick a careful path (Dexterity)',
            stat: 'DX',
            difficulty: 13,
            goSuccess: 'climbed',
            goFail: 'sinking',
            successText: 'You step from skull to skull and cross clean.',
            failText: 'A footing crumbles and you plunge in.',
            rewardOnSuccess: { gold: 25 },
            hpOnFail: -10,
          },
        ],
      },
      sinking: {
        id: 'sinking',
        text: 'Chest-deep and sinking, you need to get out — now.',
        choices: [
          {
            label: 'Thrash free by main strength (Strength)',
            stat: 'ST',
            difficulty: 12,
            goSuccess: 'climbed',
            goFail: 'crawl',
            successText: 'You burst out in a shower of bone.',
            failText: 'You barely crawl free, wrung out.',
            hpOnFail: -6,
            staDelta: -2,
          },
          {
            label: 'Stay calm and let the bones settle (Wisdom)',
            stat: 'WI',
            difficulty: 11,
            goSuccess: 'climbed',
            goFail: 'crawl',
            successText: 'You still yourself and rise; the heap releases you.',
            failText: 'Panic wins; you flounder out the hard way.',
            hpOnFail: -6,
          },
        ],
      },
      climbed: { id: 'climbed', text: 'You reach solid ground, a relic clutched from the bones.' },
      crawl: { id: 'crawl', text: 'You drag yourself out, rattled and empty-handed.' },
    },
  },

  // --- Overgrown Ruins ----------------------------------------------------
  collapsing_bridge: {
    key: 'collapsing_bridge',
    title: 'The Collapsing Bridge',
    start: 'bridge',
    nodes: {
      bridge: {
        id: 'bridge',
        text: "A rope bridge spans a ravine — and it's coming apart the moment you step on.",
        choices: [
          {
            label: 'Sprint across (Agility)',
            stat: 'AG',
            difficulty: 13,
            goSuccess: 'across',
            goFail: 'falling',
            successText: 'You race the collapse and leap to safety.',
            failText: 'A plank snaps underfoot and you drop.',
            rewardOnSuccess: { gold: 25, materials: { cloth_roll: 1 } },
            hpOnFail: -10,
          },
          {
            label: 'Cross carefully, plank by plank (Dexterity)',
            stat: 'DX',
            difficulty: 12,
            goSuccess: 'across',
            goFail: 'falling',
            successText: 'Sure-footed, you pick your way over.',
            failText: 'The boards give way beneath you.',
            rewardOnSuccess: { gold: 20 },
            hpOnFail: -8,
          },
        ],
      },
      falling: {
        id: 'falling',
        text: 'You dangle over the ravine, one hand on a fraying rope.',
        choices: [
          {
            label: 'Haul yourself up (Strength)',
            stat: 'ST',
            difficulty: 12,
            goSuccess: 'across',
            goFail: 'drop',
            successText: 'Muscles screaming, you climb to safety.',
            failText: 'Your grip fails — you fall, catching a ledge below.',
            hpOnFail: -12,
          },
          {
            label: 'Swing to a ledge (Dexterity)',
            stat: 'DX',
            difficulty: 13,
            goSuccess: 'across',
            goFail: 'drop',
            successText: 'You swing and roll onto solid stone.',
            failText: 'You misjudge it and slam into the rock.',
            hpOnFail: -12,
          },
        ],
      },
      across: { id: 'across', text: 'You reach the far side as the bridge tumbles into the dark.' },
      drop: { id: 'drop', text: 'You land hard in the gorge and limp up the far slope.' },
    },
  },

  wild_grove: {
    key: 'wild_grove',
    title: 'The Wild Grove',
    start: 'grove',
    nodes: {
      grove: {
        id: 'grove',
        text: 'A grove pulses with old magic. A guardian dryad studies you, wary.',
        choices: [
          {
            label: 'Offer respect and parley (Charisma)',
            stat: 'CH',
            difficulty: 12,
            goSuccess: 'blessed',
            goFail: 'spurned',
            successText: "The dryad warms to you and shares the grove's gifts.",
            failText: 'It deems you false and turns its back.',
            rewardOnSuccess: { gold: 30, materials: { herbs: 2 } },
            hpOnSuccess: 10,
          },
          {
            label: "Read the grove's lore (Knowledge)",
            stat: 'KN',
            difficulty: 13,
            goSuccess: 'blessed',
            goFail: 'spurned',
            successText: 'You speak the old names; the dryad bows and gifts you.',
            failText: 'You stumble the rites and offend the guardian.',
            rewardOnSuccess: { gold: 25, materials: { herbs: 1, crystals: 1 } },
            hpOnSuccess: 10,
          },
        ],
      },
      spurned: {
        id: 'spurned',
        text: 'The dryad raises coiling vines. Make amends, or flee.',
        choices: [
          {
            label: 'Soothe it with a song (Wisdom)',
            stat: 'WI',
            difficulty: 12,
            goSuccess: 'blessed',
            goFail: 'lashed',
            successText: 'Your calm reaches it; the grove relents.',
            failText: 'The vines strike before you can finish.',
            hpOnFail: -10,
          },
          {
            label: 'Back away slowly (Agility)',
            stat: 'AG',
            difficulty: 11,
            goSuccess: 'retreat',
            goFail: 'lashed',
            successText: 'You slip out of the grove unharmed.',
            failText: 'A vine catches your ankle as you go.',
            hpOnFail: -8,
          },
        ],
      },
      blessed: { id: 'blessed', text: "The grove's light knits your wounds as you pass on." },
      retreat: { id: 'retreat', text: 'You leave the grove to its guardian, no worse for it.' },
      lashed: { id: 'lashed', text: 'Whipped by thorns, you stagger out of the grove.' },
    },
  },

  // --- Frozen Caverns -----------------------------------------------------
  frozen_chasm: {
    key: 'frozen_chasm',
    title: 'The Frozen Chasm',
    start: 'chasm',
    nodes: {
      chasm: {
        id: 'chasm',
        text: 'A glacier-cut chasm yawns ahead, wind howling with killing cold.',
        choices: [
          {
            label: 'Leap the gap (Strength)',
            stat: 'ST',
            difficulty: 13,
            goSuccess: 'crossed',
            goFail: 'slipped',
            successText: 'You clear the chasm and roll to a stop.',
            failText: 'You come up short, slamming into the ice wall.',
            rewardOnSuccess: { gold: 25, materials: { crystals: 1 } },
            hpOnFail: -12,
          },
          {
            label: 'Endure the cold and climb around (Endurance)',
            stat: 'EN',
            difficulty: 12,
            goSuccess: 'crossed',
            goFail: 'slipped',
            successText: 'Numb but unbroken, you work your way across.',
            failText: 'The cold saps you; you barely reach a ledge.',
            rewardOnSuccess: { gold: 20 },
            hpOnFail: -8,
            staDelta: -2,
          },
        ],
      },
      slipped: {
        id: 'slipped',
        text: 'Clinging to sheer ice, you must move before the cold claims you.',
        choices: [
          {
            label: 'Find handholds and climb (Dexterity)',
            stat: 'DX',
            difficulty: 12,
            goSuccess: 'crossed',
            goFail: 'frostbit',
            successText: 'Inch by inch, you climb to safety.',
            failText: 'Your fingers fail; you drop to a lower shelf.',
            hpOnFail: -10,
          },
          {
            label: 'Will yourself through the pain (Wisdom)',
            stat: 'WI',
            difficulty: 12,
            goSuccess: 'crossed',
            goFail: 'frostbit',
            successText: 'You focus past the cold and pull through.',
            failText: 'The cold wins this round.',
            hpOnFail: -10,
          },
        ],
      },
      crossed: { id: 'crossed', text: 'You reach the far rim, breath steaming in the still air.' },
      frostbit: { id: 'frostbit', text: 'Frostbitten and shaking, you crawl onward.' },
    },
  },

  starving_dark: {
    key: 'starving_dark',
    title: 'The Frozen Shrine',
    start: 'shrine',
    nodes: {
      shrine: {
        id: 'shrine',
        text: 'In a still hollow you find a frozen shrine, ringed by the bones of those who failed here.',
        choices: [
          {
            label: 'Forage the hollow for supplies (Knowledge)',
            stat: 'KN',
            difficulty: 12,
            goSuccess: 'supplied',
            goFail: 'empty',
            successText: 'You find cached rations and herbs, still good.',
            failText: 'Nothing but ice and old bones.',
            rewardOnSuccess: { materials: { herbs: 2 } },
            hpOnSuccess: 15,
          },
          {
            label: 'Pray at the shrine (Wisdom)',
            stat: 'WI',
            difficulty: 12,
            goSuccess: 'blessed',
            goFail: 'empty',
            successText: 'A faint warmth answers — the shrine restores you.',
            failText: 'The shrine is silent and dead.',
            hpOnSuccess: 12,
            mpOnSuccess: 6,
          },
        ],
      },
      empty: {
        id: 'empty',
        text: 'Cold and empty-handed, you search for any way onward.',
        choices: [
          {
            label: 'Rest a moment to gather strength (Endurance)',
            stat: 'EN',
            difficulty: 11,
            goSuccess: 'rested',
            goFail: 'weary',
            successText: 'A brief rest steadies you.',
            failText: "There's no rest to be had in this cold.",
            hpOnSuccess: 10,
            staOnSuccess: 2,
          },
          { label: 'Push on immediately', go: 'weary', successText: 'You waste no time and move deeper.' },
        ],
      },
      supplied: { id: 'supplied', text: 'Restored, you shoulder your finds and go on.' },
      blessed: { id: 'blessed', text: 'Renewed, you leave the shrine to the dark.' },
      rested: { id: 'rested', text: 'Steadier now, you press into the cold.' },
      weary: { id: 'weary', text: 'Weary but alive, you continue.' },
    },
  },
};
