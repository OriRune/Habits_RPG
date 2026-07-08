// Procedural SVG art for the Deep Mine's two band-gate guardians (4.1). No sprite sheet
// exists for either boss, so — same idea as src/components/town/townArt.tsx — each is a
// small hand-drawn silhouette instead of a plain glyph, legible at the ~28-32px grid-cell
// size they render at in MineRunOverlay. Swap for a real sprite later via mineOreSprite's
// seam if art ever ships; no caller change needed beyond dropping the PNG in place.

/** Stone Golem (floor 7 gate) — a blocky rock-humanoid with jagged rubble shoulders. */
export function StoneGolemArt() {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
      <defs>
        <radialGradient id="golem-body" cx="45%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#a89a86" />
          <stop offset="100%" stopColor="#6b5d4d" />
        </radialGradient>
      </defs>
      {/* shoulders / arms */}
      <polygon points="8,52 24,40 30,66 12,78" fill="#8a7a6a" stroke="#4a3f32" strokeWidth="2" />
      <polygon points="92,52 76,40 70,66 88,78" fill="#8a7a6a" stroke="#4a3f32" strokeWidth="2" />
      {/* torso */}
      <polygon points="30,42 70,42 76,86 24,86" fill="url(#golem-body)" stroke="#4a3f32" strokeWidth="2.5" />
      {/* head */}
      <rect x="34" y="16" width="32" height="26" rx="4" fill="#948572" stroke="#4a3f32" strokeWidth="2.5" />
      {/* cracks */}
      <path d="M40 50 L48 62 L42 78" fill="none" stroke="#3a2f24" strokeWidth="2" strokeLinecap="round" />
      <path d="M62 48 L56 60 L64 80" fill="none" stroke="#3a2f24" strokeWidth="2" strokeLinecap="round" />
      {/* eyes */}
      <circle cx="43" cy="29" r="3.4" fill="#ffb020" />
      <circle cx="57" cy="29" r="3.4" fill="#ffb020" />
    </svg>
  );
}

/** Magma Colossus (floor 15 gate) — a molten-veined rock-humanoid with an ember core. */
export function MagmaColossusArt() {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
      <defs>
        <radialGradient id="colossus-core" cx="50%" cy="55%" r="60%">
          <stop offset="0%" stopColor="#ffcf5c" />
          <stop offset="55%" stopColor="#ff6a1a" />
          <stop offset="100%" stopColor="#2a0f06" />
        </radialGradient>
      </defs>
      {/* shoulders */}
      <polygon points="6,50 26,38 32,64 10,80" fill="#3a1a0e" stroke="#180a05" strokeWidth="2" />
      <polygon points="94,50 74,38 68,64 90,80" fill="#3a1a0e" stroke="#180a05" strokeWidth="2" />
      {/* torso — dark rock with a glowing molten core */}
      <polygon points="30,40 70,40 78,88 22,88" fill="#241008" stroke="#0e0603" strokeWidth="2.5" />
      <circle cx="50" cy="64" r="16" fill="url(#colossus-core)" />
      {/* head */}
      <rect x="35" y="14" width="30" height="24" rx="4" fill="#2a140a" stroke="#0e0603" strokeWidth="2.5" />
      <circle cx="44" cy="26" r="3" fill="#ffcf5c" />
      <circle cx="56" cy="26" r="3" fill="#ffcf5c" />
      {/* molten cracks */}
      <path d="M38 44 L46 56" fill="none" stroke="#ff8a2a" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M62 44 L54 56" fill="none" stroke="#ff8a2a" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M50 80 L50 90" fill="none" stroke="#ff8a2a" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** Guardian key → art component, or undefined for a non-guardian (caller keeps its glyph). */
export function guardianArt(monsterKey: string) {
  if (monsterKey === 'stone_golem') return <StoneGolemArt />;
  if (monsterKey === 'magma_colossus') return <MagmaColossusArt />;
  return undefined;
}
