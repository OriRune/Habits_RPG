import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { resolveSaveConflict, type SaveConflictSummary } from '@/net/cloudSave';

/**
 * Forced choice raised on first sign-in when this device has real pre-account
 * progress AND the account already has a cloud save (MP-06). Not dismissable:
 * whichever side loses is overwritten, so the player must decide explicitly.
 */
export function SaveConflictModal({ conflict }: { conflict: SaveConflictSummary }) {
  const side = (label: string, s: SaveConflictSummary['local']) => (
    <div className="rounded border border-gold-deep/40 p-3">
      <p className="mb-1 font-medium text-ink">{label}</p>
      <p className="text-sm text-ink-muted">
        Level {s.level} · {s.habitCount} habit{s.habitCount !== 1 ? 's' : ''}
        {s.lastActiveISO && <> · last active {s.lastActiveISO}</>}
      </p>
    </div>
  );

  return (
    <div className="texture-wood min-h-full">
      <Modal title="Two saves found" dismissable={false}>
        <p className="mb-4 text-sm text-ink-muted">
          This device has progress that was never synced, and your account already
          has a cloud save. Choose which one to keep — <span className="font-medium text-ink">the
          other will be overwritten</span>.
        </p>
        <div className="mb-5 flex flex-col gap-2">
          {side('This device', conflict.local)}
          {side('Cloud save', conflict.cloud)}
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={() => void resolveSaveConflict('keep-local')} className="w-full">
            Keep this device's save
          </Button>
          <Button
            variant="secondary"
            onClick={() => void resolveSaveConflict('keep-cloud')}
            className="w-full"
          >
            Keep the cloud save
          </Button>
        </div>
      </Modal>
    </div>
  );
}
