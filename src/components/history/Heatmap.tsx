import { type Habit } from '@/engine/habits';
import { type CellState, heatmapWeeks } from '@/engine/tracking';
import { toISODate } from '@/engine/date';

const CELL_COLOR: Record<CellState, string> = {
  green: '#2e8a5e',
  yellow: '#c9a227',
  red: '#b23b2e',
  gray: '#4a3320',
  future: 'transparent',
  none: 'transparent',
};

const LEGEND: { state: CellState; label: string }[] = [
  { state: 'green', label: 'Done' },
  { state: 'yellow', label: 'Partial' },
  { state: 'red', label: 'Missed' },
  { state: 'gray', label: 'Off day' },
];

/** GitHub-style heatmap: columns = weeks, rows = days (Sun..Sat). */
export function Heatmap({ habit, weeks = 26 }: { habit: Habit; weeks?: number }) {
  const today = toISODate();
  const cols = heatmapWeeks(habit, today, weeks);

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div className="inline-block">
          {/* Month labels */}
          <div className="mb-1 flex gap-[3px]">
            {cols.map((w) => (
              <div key={w.weekStart} className="w-[12px] text-[9px] leading-none text-ink-muted">
                {w.monthLabel ?? ''}
              </div>
            ))}
          </div>
          {/* Week columns */}
          <div className="flex gap-[3px]">
            {cols.map((w) => (
              <div key={w.weekStart} className="flex flex-col gap-[3px]">
                {w.cells.map((c) => (
                  <div
                    key={c.iso}
                    title={`${c.iso}: ${c.state}`}
                    className="h-[12px] w-[12px] rounded-[2px]"
                    style={{
                      backgroundColor: CELL_COLOR[c.state],
                      border: c.state === 'future' || c.state === 'none' ? '1px solid rgba(122,86,40,0.25)' : 'none',
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {LEGEND.map((l) => (
          <span key={l.state} className="flex items-center gap-1 text-[10px] text-ink-muted">
            <span className="h-[10px] w-[10px] rounded-[2px]" style={{ backgroundColor: CELL_COLOR[l.state] }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
