import { getStat } from '@/engine/stats';
import { useGameStore } from '@/store/useGameStore';
import { Modal } from '@/components/ui/Modal';

/** Shown when stats tie at the class-unlock milestone (brief: "if tied, player chooses"). */
export function ClassChoiceModal() {
  const choice = useGameStore((s) => s.pendingClassChoice);
  const chooseClass = useGameStore((s) => s.chooseClass);
  if (!choice) return null;

  return (
    <Modal title="Choose Your Class" dismissable={false}>
      <p className="mb-4 text-sm text-gray-400">
        Your top stats are tied. Choose the path that fits who you're becoming.
      </p>
      <div className="space-y-2">
        {choice.options.map((opt) => (
          <button
            key={`${opt.primary}-${opt.secondary}`}
            onClick={() => chooseClass(opt.primary, opt.secondary)}
            className="flex w-full items-center justify-between rounded-lg border border-gray-700 bg-gray-900 p-3 text-left hover:border-indigo-500"
          >
            <span className="font-semibold text-indigo-200">{opt.classId}</span>
            <span className="text-xs text-gray-500">
              {getStat(opt.primary).short} · {getStat(opt.secondary).short}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
