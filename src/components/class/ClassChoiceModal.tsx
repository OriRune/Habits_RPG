import { getStat } from '@/engine/stats';
import { useGameStore } from '@/store/useGameStore';
import { Modal } from '@/components/ui/Modal';
import { Sprite } from '@/components/ui/Sprite';
import { classCrest } from '@/lib/sprites';

/** Shown when stats tie at the class-unlock milestone (brief: "if tied, player chooses"). */
export function ClassChoiceModal() {
  const choice = useGameStore((s) => s.pendingClassChoice);
  const chooseClass = useGameStore((s) => s.chooseClass);
  if (!choice) return null;

  return (
    <Modal title="Choose Your Path" dismissable={false}>
      <p className="mb-4 text-sm text-ink-muted">
        Your highest virtues are tied. Choose the path that fits who you're becoming.
      </p>
      <div className="space-y-2">
        {choice.options.map((opt) => (
          <button
            key={`${opt.primary}-${opt.secondary}`}
            onClick={() => chooseClass(opt.primary, opt.secondary)}
            className="flex w-full items-center gap-3 rounded-md border border-ink-light/40 bg-parchment-100/70 p-3 text-left transition-colors hover:border-gold-deep hover:bg-gold/10"
          >
            <Sprite spriteKey={`class:${opt.classId}`} look={classCrest(opt.classId)} size="sm" label={opt.classId} />
            <span className="flex-1 font-display font-semibold text-ink">{opt.classId}</span>
            <span className="text-xs text-ink-light">
              {getStat(opt.primary).short} · {getStat(opt.secondary).short}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
