import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Fantasy typography (offline, bundled): Cinzel for display, EB Garamond for body.
// All seven weight/style variants are in use (weightless `font-display` text relies
// on Cinzel 500; body uses 400/500/600 + 400-italic). We import the *latin-only*
// subsets — the bare `cinzel/500.css` etc. also bundle latin-ext/cyrillic/greek/
// vietnamese glyph files this English-only app never renders. Latin-only keeps every
// weight identical while dropping the unused glyph payload.
import '@fontsource/cinzel/latin-500.css';
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/eb-garamond/latin-400.css';
import '@fontsource/eb-garamond/latin-500.css';
import '@fontsource/eb-garamond/latin-600.css';
import '@fontsource/eb-garamond/latin-400-italic.css';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { applyPalette, resolvePalette } from '@/engine/palettes';

// PWA service worker (precache-only app shell; see vite.config.ts). autoUpdate
// swaps in new builds on activation. Android keeps installed PWAs resumed for
// days, so also check for a new build whenever the app returns to foreground.
registerSW({
  onRegisteredSW(_url, registration) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration?.update();
    });
  },
});

// Apply the saved palette before the first paint so a non-default theme never
// flashes the default. Read straight from the persisted save; any failure just
// leaves the :root baseline (default theme) in place.
try {
  const raw = localStorage.getItem('habits-rpg-save');
  if (raw) {
    const settings = JSON.parse(raw)?.state?.settings;
    if (settings?.paletteId) applyPalette(resolvePalette(settings));
  }
} catch {
  /* ignore — fall back to the default baseline */
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
