import { useState } from 'react';
import { Palette as PaletteIcon } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';
import { cn } from '@/lib/cn';
import {
  PREMADE_PALETTES,
  DEFAULT_PALETTE,
  parseHexInput,
  rolesFromHexes,
  normalizeHex,
  type Palette,
  type PaletteColors,
} from '@/engine/palettes';

/** The five editable roles, in swatch order, with friendly labels. */
const ROLES: { key: keyof PaletteColors; label: string }[] = [
  { key: 'dark', label: 'Background' },
  { key: 'light', label: 'Surface' },
  { key: 'gold', label: 'Accent' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'ember', label: 'Action' },
];

function Swatches({ colors }: { colors: PaletteColors }) {
  return (
    <span className="flex overflow-hidden rounded-sm border border-ink/20 shadow-sm">
      {ROLES.map(({ key }) => (
        <span key={key} className="h-5 w-5" style={{ background: colors[key] }} />
      ))}
    </span>
  );
}

/** Settings → Appearance: pick a premade color palette or build a custom one. */
export function AppearanceSection() {
  const paletteId = useGameStore((s) => s.settings.paletteId);
  const customPalette = useGameStore((s) => s.settings.customPalette);
  const updateSettings = useGameStore((s) => s.updateSettings);

  // Editable draft for the custom palette — starts from the saved custom (if any)
  // or the default palette's colors so there's always something to tweak.
  const [draft, setDraft] = useState<PaletteColors>(customPalette ?? DEFAULT_PALETTE.colors);
  const [text, setText] = useState<Record<string, string>>(() => ({ ...(customPalette ?? DEFAULT_PALETTE.colors) }));
  const [paste, setPaste] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  const selectPremade = (p: Palette) => updateSettings({ paletteId: p.id });

  // Commit a custom draft: selecting custom and applying happen in one step, so
  // editing a swatch immediately re-skins the app (live preview).
  const commit = (next: PaletteColors) => {
    setDraft(next);
    updateSettings({ paletteId: 'custom', customPalette: next });
  };

  const setRole = (key: keyof PaletteColors, hex: string) => {
    setText((t) => ({ ...t, [key]: hex }));
    const norm = normalizeHex(hex);
    if (norm) commit({ ...draft, [key]: norm });
  };

  const loadFromPaste = () => {
    const hexes = parseHexInput(paste);
    if (!hexes) {
      setPasteError('Paste exactly 5 hex colors (e.g. #0d3b66).');
      return;
    }
    setPasteError(null);
    const roles = rolesFromHexes(hexes);
    setText({ ...roles });
    commit(roles);
  };

  const isCustom = paletteId === 'custom';

  return (
    <Panel tone="parchment" className="space-y-3 p-4">
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5">
          <PaletteIcon className="h-4 w-4" /> Appearance
        </span>
      </SectionTitle>
      <p className="text-xs text-ink-muted">
        Choose a color palette for the whole app, or design your own.
      </p>

      {/* Premade palette cards */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PREMADE_PALETTES.map((p) => (
          <button
            key={p.id}
            onClick={() => selectPremade(p)}
            className={cn(
              'flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
              paletteId === p.id
                ? 'border-gold-bright bg-gold/15 shadow-gold-sm'
                : 'border-gold-deep/30 bg-parchment-100/60 hover:border-gold-deep',
            )}
          >
            <Swatches colors={p.colors} />
            <span className="font-display text-xs font-bold text-ink">{p.name}</span>
          </button>
        ))}
      </div>

      {/* Custom palette editor */}
      <div
        className={cn(
          'space-y-3 rounded-md border px-3 py-3',
          isCustom ? 'border-gold-bright bg-gold/10' : 'border-gold-deep/30 bg-parchment-100/40',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-xs font-bold uppercase tracking-wider text-ink">
            Custom palette
          </span>
          <Swatches colors={draft} />
        </div>

        {/* Five color rows: GUI picker + hex text field. */}
        <div className="space-y-1.5">
          {ROLES.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <input
                type="color"
                aria-label={`${label} color`}
                value={draft[key]}
                onChange={(e) => setRole(key, e.target.value)}
                className="h-7 w-9 cursor-pointer rounded border border-gold-deep/40 bg-transparent p-0.5"
              />
              <span className="w-20 text-xs text-ink-muted">{label}</span>
              <input
                type="text"
                aria-label={`${label} hex`}
                value={text[key] ?? draft[key]}
                onChange={(e) => setRole(key, e.target.value)}
                spellCheck={false}
                className="w-24 rounded-md border border-gold-deep/50 bg-parchment-100/80 px-2 py-1 font-mono text-xs text-ink focus:border-gold-deep focus:outline-none"
              />
            </div>
          ))}
        </div>

        {/* Paste a CSS hex block (colorschemes.txt format) or plain hex list. */}
        <div className="space-y-1.5 border-t border-gold-deep/20 pt-2">
          <label className="text-[11px] text-ink-muted">
            Or paste CSS / hex (5 colors) — generate a palette at{' '}
            <a href="https://coolors.co/generate" target="_blank" rel="noreferrer" className="underline hover:text-ink">coolors.co</a>
            , then Export → CSS → CSS (Hex)
          </label>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={3}
            placeholder={'--regal-navy: #0d3b66ff;\n--lemon-chiffon: #faf0caff;\n…'}
            spellCheck={false}
            className="w-full rounded-md border border-gold-deep/50 bg-parchment-100/80 px-2 py-1.5 font-mono text-[11px] text-ink focus:border-gold-deep focus:outline-none"
          />
          {pasteError && <p className="text-[11px] text-ember">{pasteError}</p>}
          <Button variant="secondary" onClick={loadFromPaste} className="px-3 py-1 text-xs">
            Import colors
          </Button>
        </div>
      </div>
    </Panel>
  );
}
