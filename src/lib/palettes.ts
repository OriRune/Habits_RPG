// DOM-side palette application (ARCH-12).
//
// This is a rendering effect — it writes CSS custom properties onto :root — so it
// lives in lib/ alongside the other DOM/render helpers (sprites.ts, cn.ts), NOT in
// engine/, which must stay pure (no DOM access). The pure colour math and
// `resolvePalette` stay in @/engine/palettes; this file only performs the write.
import { deriveThemeVars, type Palette, type ThemeMode } from '@/engine/palettes';

/**
 * Write a palette's derived vars onto :root.
 *
 * For the default palette in light mode we clear the inline overrides so the
 * exact index.css stylesheet baseline shows through (zero rounding drift).
 * For default+dark, or any custom/premade palette, we derive and apply real vars.
 */
export function applyPalette(palette: Palette, mode: ThemeMode = 'light'): void {
  const root = document.documentElement;
  if (palette.id === 'default' && mode === 'light') {
    for (const key of Object.keys(deriveThemeVars(palette.colors, 'light'))) {
      root.style.removeProperty(key);
    }
    return;
  }
  const vars = deriveThemeVars(palette.colors, mode);
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}
