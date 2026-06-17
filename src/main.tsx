import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Fantasy typography (offline, bundled): Cinzel for display, EB Garamond for body.
import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/500.css';
import '@fontsource/eb-garamond/600.css';
import '@fontsource/eb-garamond/400-italic.css';
import './index.css';
import { applyPalette, resolvePalette } from '@/engine/palettes';

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
