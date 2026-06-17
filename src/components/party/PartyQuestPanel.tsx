import { useState } from 'react';
import { Scroll } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';
import type { ChallengeDef } from '@/engine/challenges';
import { partyActions, usePartyStore } from '@/hooks/useParty';

/**
 * Shared party quest: a combined progress bar everyone contributes to via habit
 * completions. The lead can set/replace the active quest. v1 quests are 'count'
 * goals (any habit completion counts), so progress reports cleanly.
 */
export function PartyQuestPanel({ isLead }: { isLead: boolean }) {
  const quest = usePartyStore((s) => s.quest);
  const [showForm, setShowForm] = useState(false);

  return (
    <Panel tone="parchment" className="space-y-3 p-4">
      <SectionTitle>Party Quest</SectionTitle>

      {quest ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Scroll size={16} className="text-gold-deep" />
            <span className="font-display text-sm font-bold text-ink">{quest.def.name}</span>
          </div>
          <p className="text-xs text-ink-muted">{quest.def.description}</p>
          <ProgressBar value={quest.progress} target={quest.target} />
          <div className="flex justify-between text-[11px] text-ink-muted">
            <span className="tabular-nums">
              {quest.progress} / {quest.target} completions
            </span>
            {quest.status === 'completed' && (
              <span className="font-semibold text-jewel-green">Complete! 🎉</span>
            )}
          </div>
        </div>
      ) : (
        <p className="py-2 text-center text-xs italic text-ink-muted">
          No active party quest{isLead ? ' — set one below.' : '.'}
        </p>
      )}

      {isLead && (
        <>
          {showForm ? (
            <QuestForm
              onCancel={() => setShowForm(false)}
              onCreate={async (def, target, days) => {
                await partyActions.createQuest(def, target, days);
                setShowForm(false);
              }}
            />
          ) : (
            <Button variant="secondary" className="w-full" onClick={() => setShowForm(true)}>
              {quest ? 'Replace quest' : 'Set a party quest'}
            </Button>
          )}
        </>
      )}
    </Panel>
  );
}

function ProgressBar({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div className="h-3 overflow-hidden rounded-full border border-gold-deep/40 bg-wood-900/20">
      <div
        className="h-full bg-gradient-to-r from-gold-bright to-gold-deep transition-[width]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function QuestForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (def: ChallengeDef, target: number, days: number) => void;
}) {
  const [name, setName] = useState('Party Push');
  const [target, setTarget] = useState(50);
  const [days, setDays] = useState(7);

  const submit = () => {
    const def: ChallengeDef = {
      id: `party_${Date.now()}`,
      name: name.trim() || 'Party Quest',
      description: `Complete ${target} habits together within ${days} day${days === 1 ? '' : 's'}.`,
      kind: 'count',
      goal: target,
      durationDays: days,
      reward: { gold: 0 },
      custom: true,
    };
    onCreate(def, target, days);
  };

  return (
    <div className="space-y-2 rounded-md border border-gold-deep/30 bg-parchment-100/50 p-3">
      <label className="block space-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          className="w-full rounded border border-gold-deep/50 bg-parchment-100/80 px-2 py-1 text-sm text-ink focus:border-gold-deep focus:outline-none"
        />
      </label>
      <div className="flex gap-2">
        <label className="flex-1 space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Target completions
          </span>
          <input
            type="number"
            min={1}
            value={target}
            onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 1))}
            className="w-full rounded border border-gold-deep/50 bg-parchment-100/80 px-2 py-1 text-sm tabular-nums text-ink focus:border-gold-deep focus:outline-none"
          />
        </label>
        <label className="flex-1 space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Days</span>
          <input
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
            className="w-full rounded border border-gold-deep/50 bg-parchment-100/80 px-2 py-1 text-sm tabular-nums text-ink focus:border-gold-deep focus:outline-none"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={submit}>
          Create
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
