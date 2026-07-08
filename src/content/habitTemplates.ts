// Habit templates — pre-built habit sets for guided creation.
// Static data only; no game logic. Each template maps directly to NewHabitInput so
// addHabit() can consume it without transformation.
import type { NewHabitInput } from '@/store/shared';
import type { StatId } from '@/engine/stats';

// ---------------------------------------------------------------------------
// Template group
// ---------------------------------------------------------------------------

export interface HabitTemplateGroup {
  id: string;
  label: string;
  description: string;
  /** Suggested primary stat for this template group. */
  primaryStat: StatId;
  habits: Omit<NewHabitInput, never>[];
}

export const HABIT_TEMPLATE_GROUPS: HabitTemplateGroup[] = [
  {
    id: 'beginner_fitness',
    label: 'Beginner Fitness',
    description: 'Small daily movement habits that build a foundation.',
    primaryStat: 'EN',
    habits: [
      {
        name: 'Walk 10 minutes',
        stat: 'EN',
        type: 'binary',
        frequency: 'daily',
        difficulty: 'easy',
        tag: 'Fitness',
      },
      {
        name: 'Stretch',
        stat: 'AG',
        type: 'binary',
        frequency: 'daily',
        difficulty: 'easy',
        tag: 'Fitness',
      },
      {
        name: 'Drink 8 glasses of water',
        stat: 'HP',
        type: 'binary',
        frequency: 'daily',
        difficulty: 'easy',
        tag: 'Health',
      },
      {
        name: 'Sleep by 11 pm',
        stat: 'ST',
        type: 'binary',
        frequency: 'daily',
        difficulty: 'normal',
        tag: 'Sleep',
      },
    ],
  },
  {
    id: 'reading_routine',
    label: 'Reading Routine',
    description: 'Daily reading practice to grow Knowledge and Wisdom.',
    primaryStat: 'KN',
    habits: [
      {
        name: 'Read 10 pages',
        stat: 'KN',
        type: 'quantity',
        target: 10,
        unit: 'pages',
        frequency: 'daily',
        difficulty: 'easy',
        tag: 'Study',
      },
      {
        name: 'Review notes',
        stat: 'WI',
        type: 'binary',
        frequency: 'weekdays',
        difficulty: 'easy',
        tag: 'Study',
      },
      {
        name: 'No-phone reading block',
        stat: 'WI',
        type: 'binary',
        frequency: 'times_per_week',
        timesPerWeek: 3,
        difficulty: 'normal',
        tag: 'Mental health',
      },
    ],
  },
  {
    id: 'writing_practice',
    label: 'Writing Practice',
    description: 'Build a consistent writing habit, starting small.',
    primaryStat: 'KN',
    habits: [
      {
        name: 'Write 250 words',
        stat: 'KN',
        type: 'quantity',
        target: 250,
        unit: 'words',
        frequency: 'daily',
        difficulty: 'normal',
        tag: 'Creativity',
      },
      {
        name: 'Edit one section',
        stat: 'CH',
        type: 'binary',
        frequency: 'times_per_week',
        timesPerWeek: 3,
        difficulty: 'normal',
        tag: 'Creativity',
      },
      {
        name: 'Brainstorm ideas',
        stat: 'CH',
        type: 'binary',
        frequency: 'times_per_week',
        timesPerWeek: 3,
        difficulty: 'easy',
        tag: 'Creativity',
      },
    ],
  },
  {
    id: 'study_plan',
    label: 'Study Plan',
    description: 'Structured daily study sessions for deep learning.',
    primaryStat: 'KN',
    habits: [
      {
        name: 'Study 25 minutes',
        stat: 'KN',
        type: 'quantity',
        target: 25,
        unit: 'min',
        frequency: 'weekdays',
        difficulty: 'normal',
        tag: 'Study',
      },
      {
        name: 'Review flashcards',
        stat: 'WI',
        type: 'binary',
        frequency: 'daily',
        difficulty: 'easy',
        tag: 'Study',
      },
      {
        name: 'Summarize one concept',
        stat: 'KN',
        type: 'binary',
        frequency: 'weekdays',
        difficulty: 'easy',
        tag: 'Study',
      },
    ],
  },
  {
    id: 'chore_reset',
    label: 'Chore Reset',
    description: 'Keep your living space tidy with small daily actions.',
    primaryStat: 'EN',
    habits: [
      {
        name: '10-minute tidy',
        stat: 'EN',
        type: 'binary',
        frequency: 'daily',
        difficulty: 'easy',
        tag: 'Chores',
      },
      {
        name: 'Clean one surface',
        stat: 'EN',
        type: 'binary',
        frequency: 'daily',
        difficulty: 'easy',
        tag: 'Chores',
      },
      {
        name: 'Do dishes',
        stat: 'EN',
        type: 'binary',
        frequency: 'daily',
        difficulty: 'easy',
        tag: 'Chores',
      },
      {
        name: 'Laundry step',
        stat: 'EN',
        type: 'binary',
        frequency: 'times_per_week',
        timesPerWeek: 2,
        difficulty: 'easy',
        tag: 'Chores',
      },
    ],
  },
  {
    id: 'social_confidence',
    label: 'Social Confidence',
    description: 'Build Charisma through small social actions.',
    primaryStat: 'CH',
    habits: [
      {
        name: 'Message a friend',
        stat: 'CH',
        type: 'binary',
        frequency: 'times_per_week',
        timesPerWeek: 3,
        difficulty: 'easy',
        tag: 'Social',
      },
      {
        name: 'Practice conversation',
        stat: 'CH',
        type: 'binary',
        frequency: 'times_per_week',
        timesPerWeek: 2,
        difficulty: 'normal',
        tag: 'Social',
      },
      {
        name: 'Attend or plan one social activity',
        stat: 'CH',
        type: 'binary',
        frequency: 'times_per_week',
        timesPerWeek: 1,
        difficulty: 'hard',
        tag: 'Social',
      },
    ],
  },
];
