import { useState } from 'react';
import { Scroll } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';
import type { ChallengeDef } from '@/engine/challenges';
import { STATS, type StatId } from '@/engine/stats';
import { partyActions, usePartyStore } from '@/hooks/useParty';
import { useGameStore } from '@/store/useGameStore';
import { useAuthStore } from '@/net/auth';

// Kinds that aggregate cleanly across party members (i.e. summing each player's
// contributions is meaningful). streak/recovery/rival are per-player concepts and
// cannot be meaningfully combined, so they are intentionally excluded.
type PartyQuestKind = 'count' | 'class' | 'quantity';

const KIND_LABELS: Record<PartyQuestKind, string> = {
  count: 'Any habit (count)',
  class: 'Stat-focused (class)',
  quantity: 'Amount logged (quantity)',
};

/**
 * Shared party quest: a combined progress bar everyone contributes to via habit
 * completions. The lead can set/replace the active quest. v1 quests are 'count'
 * goals (any habit completion counts), so progress reports cleanly.
 */
export function PartyQuestPanel({ isLead }: { isLead: boolean }) {
  const quest = usePartyStore((s) => s.quest);
  const memberCount = usePartyStore((s) => s.members.length);
  const claimedPartyQuests = useGameStore((s) => s.claimedPartyQuests);
  const myId = useAuthStore((s) => s.session?.user?.id);
  const [showForm, setShowForm] = useState(false);

  const reward = Math.min(200, 50 + 10 * memberCount);
  const iContributed = quest ? (quest.contributions?.[myId ?? ''] ?? 0) > 0 : false;
  const alreadyClaimed = quest ? claimedPartyQuests.includes(quest.id) : false;

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
            {quest.status === 'completed' ? (
              <span className="font-semibold text-jewel-green">
                Complete! 🎉{alreadyClaimed && iContributed && ' · Reward claimed'}
              </span>
            ) : (
              <span>Reward: 🪙 {reward} each</span>
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
              memberCount={memberCount}
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
  memberCount,
}: {
  onCancel: () => void;
  onCreate: (def: ChallengeDef, target: number, days: number) => void;
  memberCount: number;
}) {
  const [name, setName] = useState('Party Push');
  const [target, setTarget] = useState(50);
  const [days, setDays] = useState(7);
  const [kind, setKind] = useState<PartyQuestKind>('count');
  const [stat, setStat] = useState<StatId>('ST');

  const targetLabel =
    kind === 'quantity' ? 'Target amount' : 'Target completions';

  const autoDescription = () => {
    if (kind === 'count')
      return `Complete ${target} habits together within ${days} day${days === 1 ? '' : 's'}.`;
    if (kind === 'class')
      return `Log ${target} ${STATS.find((s) => s.id === stat)?.name ?? stat} habit completions together within ${days} day${days === 1 ? '' : 's'}.`;
    return `Log a combined ${target} units of quantity habits within ${days} day${days === 1 ? '' : 's'}.`;
  };

  const submit = () => {
    const rewardGold = Math.min(200, 50 + 10 * memberCount);
    const def: ChallengeDef = {
      id: `party_${Date.now()}`,
      name: name.trim() || 'Party Quest',
      description: autoDescription(),
      kind,
      ...(kind === 'class' ? { stat } : {}),
      goal: target,
      durationDays: days,
      reward: { gold: rewardGold },
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

      <label className="block space-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Quest type</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as PartyQuestKind)}
          className="w-full rounded border border-gold-deep/50 bg-parchment-100/80 px-2 py-1 text-sm text-ink focus:border-gold-deep focus:outline-none"
        >
          {(Object.entries(KIND_LABELS) as [PartyQuestKind, string][]).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      </label>

      {kind === 'class' && (
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Stat</span>
          <select
            value={stat}
            onChange={(e) => setStat(e.target.value as StatId)}
            className="w-full rounded border border-gold-deep/50 bg-parchment-100/80 px-2 py-1 text-sm text-ink focus:border-gold-deep focus:outline-none"
          >
            {STATS.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      )}

      <div className="flex gap-2">
        <label className="flex-1 space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {targetLabel}
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
