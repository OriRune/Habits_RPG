// Shared reward-chip renderer for the crawler result screens (banking/death recaps).
// Originally lived only in ForestRunOverlay.tsx; hoisted here (5.3) so Mine's matching
// kept/lost recap columns can use the same component instead of hand-rolling the same
// Object.entries(materials).filter(...) + gold-span + empty-fallback boilerplate.
import type { Reward } from '@/engine/challenges';
import { getMaterial } from '@/engine/materials';

export function rewardChips(reward: Reward): Array<{ label: string; color: string }> {
  const out: Array<{ label: string; color: string }> = [];
  if (reward.gold) out.push({ label: `${reward.gold} gold`, color: '#e8c860' });
  for (const [key, n] of Object.entries(reward.materials ?? {})) {
    if (!n) continue;
    const mat = getMaterial(key);
    out.push({ label: `${n} ${mat?.name ?? key}`, color: mat?.color ?? '#f3e7c9' });
  }
  return out;
}

export function HaulChips({ reward, empty }: { reward: Reward; empty: string }) {
  const chips = rewardChips(reward);
  if (chips.length === 0) return <span className="text-parchment-300/50">{empty}</span>;
  return (
    <>
      {chips.map((chip) => (
        <span key={chip.label} style={{ color: chip.color }}>
          {chip.label}
        </span>
      ))}
    </>
  );
}
