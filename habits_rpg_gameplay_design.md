# Habits RPG Gameplay Design

## 1. Core Design Pillars

**The real-life habit tracker is the engine.**  
Players should progress mainly through completing habits, not by grinding minigames.

**The minigames are the payoff.**  
They make the stats feel real. Strength, Wisdom, Dexterity, and the other attributes should matter in actual gameplay.

**Failure should slow progress, not punish harshly.**  
Missing habits should not make players quit. Use recovery systems, streak freezes, partial credit, and weekly resets.

**Social play should motivate, not shame.**  
Party challenges should reward cooperation and friendly rivalry without making lower-performing players feel useless.

---

## 2. Main Gameplay Loop

### Daily Loop

1. **Player completes real-life habits**
   - Examples: run 30 minutes, read 10 pages, practice harp, clean room, meditate, study Spanish.

2. **Player checks off or enters quantity**
   - Yes/no habit: “Did I meditate?”
   - Quantity habit: “How many minutes did I run?”

3. **Habit grants XP**
   - Each habit is assigned to one stat.
   - Examples:
     - Running → Endurance
     - Strength training → Strength
     - Drawing → Dexterity
     - Reading → Knowledge
     - Journaling → Wisdom
     - Social outreach → Charisma
     - Sleep target → Hit Points

4. **Stats update**
   - XP fills stat bars.
   - Character level increases when total XP reaches a threshold.

5. **Player spends rewards**
   - Gold
   - Items
   - Cosmetics
   - Potions
   - Streak freezes
   - Crafting materials

6. **Optional minigame**
   - Boss fight
   - Dungeon run
   - Duel
   - Expedition
   - Crafting challenge
   - Party raid

### Weekly Loop

At the end of each week:

- Player gets a **weekly report**
- Party members compare progress
- Weekly challenge rewards are distributed
- Character may unlock class upgrades
- Player can adjust habits for next week
- A weekly boss or quest becomes available

The weekly structure gives players something to anticipate and prevents the daily habit loop from becoming repetitive.

### Monthly / Seasonal Loop

Every month or season:

- New themed quests
- New cosmetic rewards
- New bosses
- New item sets
- New class titles
- Party leaderboard reset
- Optional prestige or rebirth system later

This gives long-term players fresh reasons to return.

---

## 3. Habit XP System

Each habit should have these settings:

| Setting | Example |
|---|---|
| Habit name | Read |
| Stat | Knowledge |
| Type | Yes/no or quantity |
| Target | 20 pages |
| Frequency | Daily, weekdays, 3x/week, custom |
| Difficulty | Easy, Normal, Hard, Epic |
| Reward cap | Prevents abuse |
| Streak bonus | Optional |
| Rest days | Optional |

### XP for Yes/No Habits

| Difficulty | XP |
|---|---:|
| Easy | 10 XP |
| Normal | 20 XP |
| Hard | 35 XP |
| Epic | 50 XP |

### XP for Quantity Habits

```text
XP = Base XP × Completion %
```

Example:

- Habit: Read 20 pages
- Difficulty: Normal, worth 20 XP
- Player reads 10 pages
- Completion: 50%
- Reward: 10 XP

Cap completion at **150%** so players can overachieve without exploiting the system.

```text
Final XP = Base XP × min(Completion %, 150%)
```

Example:

- Goal: 20 pages
- Actual: 40 pages
- Completion: 200%
- Capped completion: 150%
- Final reward: 30 XP

---

## 4. Leveling System

Use total XP across all stats to determine character level.

Recommended formula:

```text
XP required for next level = 100 × Level^1.5
```

Examples:

| Level | XP Needed for Next Level |
|---:|---:|
| 1 | 100 |
| 2 | 283 |
| 3 | 520 |
| 4 | 800 |
| 5 | 1,118 |
| 10 | 3,162 |
| 20 | 8,944 |

### Level-Up Boss Rule

When players hit the XP threshold, they do **not** level up instantly.

Instead:

1. They unlock a **Level-Up Trial**
2. They fight a boss or complete a challenge
3. If they win, they level up
4. If they lose, they can retry after completing more habits

This gives level-ups emotional weight.

---

## 5. Stat System

Stats should affect both the character sheet and the minigames.

| Stat | Represents | Gameplay Effects |
|---|---|---|
| Dexterity | Precision, craft, accuracy | Critical hits, timing windows, crafting success |
| Agility | Speed, evasion, reaction | Turn order, dodge chance, movement speed |
| Strength | Power, force | Damage, breaking obstacles |
| Endurance | Stamina, persistence | Energy, resistance to fatigue |
| Wisdom | Insight, healing, defense | Healing, buffs, resistance to curses |
| Charisma | Influence, leadership | Party bonuses, negotiation, summon allies |
| Knowledge | Study, magic, strategy | Spells, puzzles, elemental attacks |
| Hit Points | Health, resilience | Max HP, survival, tanking |

### Note on Hit Points

Hit Points may work better as a derived combat value rather than as a trainable stat.

Recommended alternative:

```text
Hit Points → Vitality (VT)
```

However, the game can still keep **Hit Points (HP)** as a trainable stat if desired.

---

## 6. Class System

Players start as:

```text
Adventurer
```

At a certain level, such as **Level 10**, they receive a class based on their two highest stats.

### Class Assignment Rules

- Highest stat = primary class axis
- Second-highest stat = secondary class axis
- If tied, player chooses
- Class can update weekly or at major milestones
- Once discovered, classes are added to a **Class Codex**

This lets players naturally discover their identity through their habits.

### Complete Class Chart

Rows = highest stat.  
Columns = second-highest stat.

| Primary / Secondary | DX | AG | ST | EN | WI | CH | KN | HP |
|---|---|---|---|---|---|---|---|---|
| **Dexterity** | Duelist | Illusionist | Pirate | Trapper | Magician | Rogue | Artist | Craftsman |
| **Agility** | Thief | Acrobat | Ninja | Skirmisher | Windwalker | Daredevil | Saboteur | Escape Artist |
| **Strength** | Knight | Warrior | Strongman | Barbarian | Paladin | Samurai | Martial Artist | Juggernaut |
| **Endurance** | Ranger | Trailblazer | Vanguard | Sentinel | Wilder | Spy | Scout | Mountain Man |
| **Wisdom** | Healer | Mystic | Monk | Druid | Sage | Shaman | Seer | Battle Monk |
| **Charisma** | Bard | Performer | General | Field Marshal | Philosopher | Lord | Pyromancer | Ardent |
| **Knowledge** | Sorcerer | Warlock | Battle Mage | Field Mage | Wizard | Mage | Scholar | Alchemist |
| **Hit Points** | Guardian | Wardancer | Soldier | Fortress | Crusader | Warlord | Cleric | Tank |

### Advanced Classes

Advanced classes can unlock at higher levels.

| Base Class | Advanced Class |
|---|---|
| Rogue | Shadowblade |
| Bard | Maestro |
| Knight | Champion |
| Wizard | Archmage |
| Tank | Ironwall |
| Healer | Saint |
| Ninja | Phantom |
| Druid | Verdant Oracle |

---

## 7. Minigames

The game should have several quick, optional minigames that connect directly to habit progress.

---

### Minigame 1: Level-Up Boss Battle

This should be the core minigame.

#### How It Works

When the player earns enough XP to level up:

- A boss appears
- Boss difficulty depends on the level being attempted
- Player fights using stats, gear, spells, and consumables
- Winning grants the level-up
- Losing does not remove XP, but delays the level-up

#### Battle Format

A simple turn-based battle works well.

Each turn, the player chooses:

- Attack
- Defend
- Skill
- Item
- Class ability
- Party assist

#### Stat Effects in Boss Battles

| Stat | Boss Battle Effect |
|---|---|
| Strength | Physical damage |
| Dexterity | Critical hit chance |
| Agility | Dodge and turn order |
| Endurance | Stamina and damage reduction |
| Wisdom | Healing and cleansing |
| Charisma | Ally assist chance |
| Knowledge | Spell damage and enemy analysis |
| HP | Maximum health |

#### Boss Examples

**Level 5 Boss: The Procrastination Slime**

- Low damage
- Splits into smaller slimes
- Weak to Knowledge and Dexterity
- Rewards:
  - 100 gold
  - Minor potion
  - Level-up

**Level 20 Boss: The Burnout Golem**

- High HP
- Punishes overuse of one stat
- Requires defensive play
- Rewards:
  - Class relic
  - Title
  - Level-up

---

### Minigame 2: Dungeon Expeditions

This is the main repeatable PvE mode.

#### How It Works

Players send their character into a dungeon made of rooms.

Each room has a challenge:

- Combat room
- Puzzle room
- Trap room
- Treasure room
- Rest room
- Social encounter
- Boss room

Different stats help in different rooms.

| Room Type | Useful Stats |
|---|---|
| Trap Room | Dexterity, Agility |
| Combat Room | Strength, HP, Endurance |
| Puzzle Room | Knowledge, Wisdom |
| Negotiation Room | Charisma, Wisdom |
| Survival Room | Endurance, HP |
| Treasure Room | Dexterity, Knowledge |

#### Habit Integration

To enter a dungeon, players need **Energy**.

Energy comes from completing habits.

Example:

- 1 completed habit = 1 Energy
- Dungeon entry = 3 Energy
- Boss dungeon = 10 Energy

This prevents players from ignoring habits and only playing the minigame.

---

### Minigame 3: Party Raid

This is the main cooperative group mode.

A raid boss has huge HP and multiple phases.

Each player contributes based on their habits and class.

#### Example Raid Boss: The Chaos Dragon

| Phase | Objective | Useful Stats |
|---|---|---|
| Phase 1 | Break the Shield | Strength, Knowledge |
| Phase 2 | Survive the Flame | HP, Endurance, Wisdom |
| Phase 3 | Rally the Party | Charisma |
| Phase 4 | Final Strike | Dexterity, Agility |

Players deal damage by completing habits during the raid window.

```text
Damage = Habit XP earned × Class multiplier
```

Example:

- Player earns 200 XP from habits during the raid
- Their class multiplier is 1.2
- They deal 240 raid damage

This turns real-life consistency into party progress.

---

### Minigame 4: Skill Trials

Skill Trials are short stat-based challenges.

| Trial | Main Stat | Gameplay |
|---|---|---|
| Lockpicking | Dexterity | Timing minigame |
| Rooftop Chase | Agility | Dodge obstacles |
| Armory Break | Strength | Click/hold power challenge |
| Long March | Endurance | Resource-management challenge |
| Spirit Grove | Wisdom | Choose the right blessing |
| Royal Court | Charisma | Dialogue choices |
| Ancient Library | Knowledge | Puzzle/trivia/card logic |
| Last Stand | HP | Survive waves |

Skill Trials can be used for:

- Daily bonuses
- Class unlocks
- Special rewards
- Challenge completions

---

### Minigame 5: Crafting and Equipment

Players collect materials from habits, dungeons, and challenges.

Then they craft gear.

| Item | Effect |
|---|---|
| Runner’s Boots | +Agility, bonus from exercise habits |
| Scholar’s Lantern | +Knowledge, extra XP from reading/studying |
| Iron Kettle Bell | +Strength |
| Bard’s Cloak | +Charisma |
| Sage Ring | +Wisdom |
| Adventurer’s Bedroll | +HP from sleep habits |
| Lockpick Gloves | +Dexterity in trap rooms |

Crafting should not be too complex at first.

Start with:

- Weapon
- Armor
- Trinket
- Tool
- Cosmetic

---

## 8. Difficulty Scaling

Difficulty should increase in both the habit system and the game system.

### Habit Difficulty

Avoid making players increase their real-life targets automatically. That can become demotivating.

Instead, let players choose:

- Keep habit the same
- Increase target
- Increase frequency
- Add a harder version
- Create a new habit
- Convert habit into a challenge

Example progression:

```text
Read 5 pages daily
```

Later:

```text
Read 15 pages daily
```

The game should encourage progression without forcing it.

### Game Difficulty

Minigames should scale based on:

- Character level
- Number of completed habits
- Party size
- Class tier
- Equipment score
- Recent win/loss record

Bosses can gain:

| Difficulty Element | Example |
|---|---|
| More HP | Boss survives longer |
| More damage | Player needs healing or defense |
| New mechanics | Boss shields, poison, curses |
| Stat checks | Requires certain stat thresholds |
| Multi-phase fights | Boss changes behavior mid-fight |
| Limited turns | Win before burnout meter fills |
| Environmental hazards | Traps, weather, darkness |

### Anti-Frustration Scaling

If a player loses repeatedly:

- Boss HP drops slightly
- Player gets a strategy hint
- NPC ally appears
- Player can use habit-earned potions
- Retry cost decreases

The game should challenge players without blocking them.

---

## 9. Challenges

Challenges are one of the strongest parts of the concept.

### Challenge Types

| Challenge Type | Example |
|---|---|
| Streak Challenge | Meditate 7 days in a row |
| Quantity Challenge | Read 100 pages this week |
| Party Challenge | Group completes 100 habits total |
| Rival Challenge | Two players compete for most XP in Strength |
| Boss Challenge | Complete habits to weaken a boss |
| Recovery Challenge | Complete 3 habits after missing a day |
| Class Challenge | Wizard must complete Knowledge habits 5 days this week |
| Custom Challenge | User-defined |

### Challenge Rewards

Rewards can include:

- XP
- Gold
- Items
- Potions
- Streak freezes
- Cosmetics
- Titles
- Class skills
- Pets
- Mounts
- Crafting materials
- Dungeon keys

### Challenge Design Template

Every challenge should have:

```text
Goal
Time limit
Participants
Eligible habits
Reward
Failure condition
Partial reward rules
```

### Example Challenge: The Scholar’s Week

- Goal: Read 100 pages total
- Time limit: 7 days
- Stat: Knowledge
- Reward:
  - 150 Knowledge XP
  - Scholar’s Ink
  - 50 gold
- Partial reward:
  - 50% completion gives 50 gold

---

## 10. Items, Spells, and Inventory

Items give the game more depth.

### Item Types

| Type | Function |
|---|---|
| Weapons | Improve attacks |
| Armor | Reduce damage |
| Trinkets | Passive bonuses |
| Tools | Help with specific minigames |
| Potions | One-time effects |
| Scrolls | Temporary spells |
| Cosmetics | Avatar customization |
| Relics | Rare class-based items |

### Potion Examples

| Potion | Effect |
|---|---|
| Healing Potion | Restore HP in battle |
| Focus Potion | Bonus Knowledge for one dungeon |
| Courage Draught | Bonus Charisma |
| Swiftness Tonic | Bonus Agility |
| Streak Freeze | Protects one missed habit |
| Recovery Elixir | Restores lost momentum after missed day |

### Spell Examples

| Spell | Stat |
|---|---|
| Firebolt | Knowledge |
| Mend Wounds | Wisdom |
| Rally | Charisma |
| Iron Skin | Endurance |
| Shadowstep | Agility |
| Precision Strike | Dexterity |
| Heavy Blow | Strength |
| Last Stand | HP |

---

## 11. Avatar and Customization

Players should be able to customize:

- Body type
- Hair
- Face
- Outfit
- Weapon appearance
- Background
- Pet
- Mount
- Class aura
- Title
- Badge frame

Cosmetics are especially good long-term rewards because they do not break balance.

### Cosmetic Examples

- 7-Day Streak Cloak
- 100 Books Read Glasses
- Marathon Boots
- Night Owl Familiar
- First Boss Slayer Badge

---

## 12. Keeping Players Engaged Long-Term

### 1. Class Discovery

Players should want to discover new classes.

A **Class Codex** can show:

- Discovered classes
- Undiscovered silhouettes
- Requirements
- Class abilities
- Cosmetic previews

### 2. Seasonal Content

Every season adds:

- New bosses
- New challenge themes
- New cosmetics
- New dungeons
- New party raids

Example season:

**Season of the Iron Garden**

- Plant-themed bosses
- Growth-based habit challenges
- Druid, Ranger, and Sage cosmetics
- Party raid against the Thorn Colossus

### 3. Personal Quests

The game should generate quests based on habits.

Example for reading:

```text
Quest: Complete 5 Knowledge habits this week.
Reward: Scholar’s Candle.
```

Example for running:

```text
Quest: Complete 3 Endurance habits this week.
Reward: Trailrunner Boots.
```

### 4. Party Progression

Parties can have:

- Shared guild hall
- Shared trophies
- Party raids
- Group streaks
- Party level
- Shared quests
- Friendly leaderboards

### 5. Collection Systems

Players can collect:

- Classes
- Titles
- Pets
- Relics
- Boss trophies
- Cosmetics
- Dungeon maps
- Achievement badges

### 6. Prestige System

At high level, players can retire a character into legend.

They keep:

- Cosmetics
- Titles
- Codex entries
- Legacy bonuses

They reset:

- Level
- Some stats
- World tier

This is optional but useful for long-term players.

---

## 13. Social and Multiplayer Features

### Party System

A party can include friends, family, coworkers, or accountability groups.

Party features:

- Shared challenges
- Group boss fights
- Encouragement reactions
- Weekly summaries
- Party chat
- Guild hall customization
- Cooperative rewards

### Avoid Toxic Competition

Do not only reward “most XP.”

Also reward:

- Most consistent
- Best recovery after missed day
- Most improved
- Most helpful teammate
- Completed hardest habit
- Longest streak
- Party support actions

This prevents high-achievers from dominating everything.

---

## 14. Failure, Rest, and Recovery

This is crucial.

Habit trackers often fail because missing one day makes people feel like they ruined everything.

### Streak Freezes

Protect a streak once.

Can be earned through:

- Challenges
- Level-ups
- Shops
- Weekly rewards

### Rest Days

Players can define planned rest days.

Example:

- Exercise habit due Monday, Wednesday, Friday
- No penalty on other days

### Partial Credit

Quantity habits can give partial XP.

Example:

- Goal: 30 minutes
- Completed: 10 minutes
- Reward: 33% XP

### Recovery Bonus

If a player misses a habit but completes it the next day:

```text
Recovery bonus: +10% XP
```

This encourages returning instead of quitting.

### No Permanent Punishment

Avoid:

- Losing levels
- Losing items
- Breaking characters
- Publicly shaming missed habits

---

## 15. Economy

The game likely needs several reward currencies.

Keep it simple at first.

### Recommended Currencies

| Currency | Source | Use |
|---|---|---|
| XP | Habits | Leveling stats |
| Gold | Habits, quests, bosses | Buy items |
| Gems | Rare achievements/seasons | Cosmetics only |
| Energy | Daily habit completions | Enter minigames |
| Materials | Dungeons/challenges | Crafting |

Avoid making premium currency affect real habit progression. Cosmetics are safer.

---

## 16. MVP Version

For a first playable version, build only this:

### Core MVP

1. Create habits
2. Assign each habit to a stat
3. Track yes/no or quantity
4. Gain XP
5. Show character sheet
6. Level up based on total XP
7. Unlock class at level 10
8. Simple boss battle for level-ups
9. Basic inventory
10. Basic party challenge system

### First Minigame MVP

Use a simple turn-based boss fight:

- Attack
- Defend
- Use item
- Use class skill

Stats modify combat.

That is enough to prove the concept.

---

## 17. Example Player Journey

### Day 1

Ryan creates habits:

| Habit | Stat |
|---|---|
| Run 20 minutes | Endurance |
| Read 10 pages | Knowledge |
| Practice harp 15 minutes | Dexterity |
| Clean apartment | HP |
| Message a friend | Charisma |

He completes 4 out of 5 and gains XP.

### Day 7

He completes a weekly challenge:

```text
Complete 20 total habits this week.
```

Reward:

- 100 XP
- 50 gold
- Minor Healing Potion

### Level 5

He reaches enough XP to level up.

Boss appears:

```text
The Procrastination Slime
```

He beats it and reaches Level 5.

### Level 10

His highest stats are:

1. Knowledge
2. Dexterity

He becomes:

```text
Sorcerer
```

He unlocks:

```text
Spell: Arcane Needle
Effect: Magic attack with bonus critical chance from Dexterity.
```

---

## 18. Additional Systems Worth Adding

### Habit Tags

Users can tag habits:

- Health
- Fitness
- Study
- Creativity
- Social
- Chores
- Mental health
- Work
- Sleep

This helps with reports and challenges.

### Habit Load Warning

If a player adds too many habits, warn them gently.

Example:

```text
You currently have 14 daily habits. Consider making some weekly or optional.
```

### Smart Habit Suggestions

Based on stat imbalance:

```text
Your Wisdom is much lower than your other stats. Add a reflection, meditation, or planning habit?
```

### Character Mood

Character mood reflects recent consistency.

Possible moods:

- Inspired
- Steady
- Tired
- Recovering
- Burned out

Mood can provide gentle feedback without being punitive.

### Story Mode

Players progress through regions:

1. Beginner’s Village
2. Forest of Focus
3. Caves of Consistency
4. City of Discipline
5. Mountains of Mastery
6. Tower of Legacy

Each region introduces new bosses and mechanics.

---

## 19. Key Design Recommendation

The strongest version of this game is not merely “a habit tracker with some RPG art.”

It should be:

```text
A life-progress RPG where real habits create the character, and minigames let players feel the consequences of who they are becoming.
```

The habit system should answer:

```text
What did I do today?
```

The RPG system should answer:

```text
Who am I becoming because of it?
```
