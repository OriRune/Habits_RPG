import { useGameStore } from '@/store/useGameStore';
import { type Habit } from '@/engine/habits';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface Props {
  habit: Habit;
  onClose: () => void;
}

/**
 * Confirmation dialog for deleting a habit.
 * Warns that all log history is permanently erased and offers "Retire instead"
 * as a safer alternative that preserves history.
 */
export function DeleteHabitDialog({ habit, onClose }: Props) {
  const removeHabit = useGameStore((s) => s.removeHabit);
  const retireHabit = useGameStore((s) => s.retireHabit);

  const loggedDays = Object.keys(habit.log).length;

  function handleDelete() {
    removeHabit(habit.id);
    onClose();
  }

  function handleRetire() {
    retireHabit(habit.id);
    onClose();
  }

  return (
    <Modal title="Delete Habit?" onClose={onClose}>
      <p className="mb-1 font-medium text-ink">"{habit.name}"</p>
      <p className="mb-4 text-sm text-ink-muted">
        Deleting this habit will permanently erase{' '}
        {loggedDays > 0 ? (
          <>
            all <span className="font-semibold text-ink">{loggedDays} logged day{loggedDays !== 1 ? 's' : ''}</span> of history.
          </>
        ) : (
          'it and all its data.'
        )}{' '}
        This cannot be undone.
      </p>
      <p className="mb-5 text-sm text-ink-muted">
        If you just want to pause or hide this habit, <span className="font-medium text-ink">retire it</span> instead — history is kept and it can be reactivated later.
      </p>
      <div className="flex flex-col gap-2">
        <Button variant="secondary" onClick={handleRetire} className="w-full">
          Retire instead (keep history)
        </Button>
        <Button
          onClick={handleDelete}
          className="w-full bg-ember hover:bg-ember/90 text-white border-ember"
        >
          Delete forever
        </Button>
      </div>
    </Modal>
  );
}
