// The smithy interior — a pure inline-SVG backdrop for the Forge scene (no state, no
// effects). Scenery darks are fixed (stone/soot/wood read the same under every palette);
// the fire, metal rim-lights, and water pick up the active palette via CSS variables so
// the smithy retints with the player's chosen theme. If real art is ever registered for
// 'forge:anvil' (resolveSceneImage seam), it replaces the SVG wholesale.
import { memo } from 'react';
import { resolveSceneImage } from '@/lib/scenes';

export const SmithyBackdrop = memo(function SmithyBackdrop() {
  const img = resolveSceneImage('forge:anvil');
  if (img) {
    return <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover" />;
  }
  return (
    <svg
      viewBox="0 0 320 140"
      preserveAspectRatio="xMidYMax slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      {/* Wall + floor */}
      <rect x="0" y="0" width="320" height="140" fill="#241a12" />
      <rect x="0" y="118" width="320" height="22" fill="#191008" />
      <line x1="0" y1="118" x2="320" y2="118" stroke="#0e0804" strokeWidth="1.5" />
      {/* Faint stone coursing on the wall */}
      <g stroke="#2e2115" strokeWidth="1">
        <line x1="0" y1="34" x2="320" y2="34" />
        <line x1="0" y1="62" x2="320" y2="62" />
        <line x1="0" y1="90" x2="320" y2="90" />
        <line x1="48" y1="8" x2="48" y2="34" />
        <line x1="140" y1="34" x2="140" y2="62" />
        <line x1="262" y1="8" x2="262" y2="34" />
        <line x1="300" y1="62" x2="300" y2="90" />
      </g>

      {/* Hearth (left): chimney, stone arch, dark opening, coal bed */}
      <rect x="52" y="0" width="36" height="34" fill="#2a1c11" />
      <path d="M18,118 L18,56 Q70,24 122,56 L122,118 Z" fill="#332416" stroke="#43301f" strokeWidth="2" />
      <path d="M30,118 L30,68 Q70,44 110,68 L110,118 Z" fill="#0f0805" />
      {/* Coal mound — the fire glow overlay breathes on top of this */}
      <ellipse cx="70" cy="113" rx="37" ry="9" fill="#0a0503" />
      <circle cx="56" cy="110" r="4" fill="#221108" />
      <circle cx="70" cy="112" r="5" fill="#26130a" />
      <circle cx="84" cy="110" r="4" fill="#221108" />
      <circle cx="63" cy="106" r="3" fill="#2c170c" />
      <circle cx="78" cy="106" r="3" fill="#2c170c" />

      {/* Tool wall (centre): hanging tongs + spare hammer silhouettes */}
      <g stroke="#171009" strokeWidth="2.5" strokeLinecap="round">
        <line x1="146" y1="18" x2="146" y2="44" />
        <line x1="141" y1="44" x2="146" y2="58" />
        <line x1="151" y1="44" x2="146" y2="58" />
      </g>
      <g stroke="#171009" strokeWidth="2.5" strokeLinecap="round">
        <line x1="166" y1="18" x2="166" y2="40" />
      </g>
      <rect x="159" y="38" width="14" height="8" rx="2" fill="#171009" />

      {/* Anvil (centre-right) on its stump */}
      <rect x="182" y="102" width="42" height="16" rx="2" fill="#2c1d10" />
      <ellipse cx="203" cy="102" rx="21" ry="4" fill="#3a2716" />
      <path
        d="M165,74 L238,74 Q252,74 258,67 Q254,84 238,86 L223,86 L219,100 L208,100 L204,86 L188,86 L184,100 L173,100 L169,86 L165,84 Z"
        fill="#2e2a26"
        stroke="#4a423a"
        strokeWidth="1.5"
      />
      {/* Rim light along the working face — palette gold */}
      <line x1="166" y1="74.5" x2="252" y2="71" stroke="var(--c-gold-deep, #8a6a1a)" strokeOpacity="0.55" strokeWidth="1.5" />

      {/* Slack tub (right): barrel + still water */}
      <rect x="270" y="92" width="40" height="26" rx="4" fill="#3a2716" stroke="#241708" strokeWidth="1.5" />
      <line x1="270" y1="100" x2="310" y2="100" stroke="#241708" strokeWidth="1.5" />
      <line x1="270" y1="110" x2="310" y2="110" stroke="#241708" strokeWidth="1.5" />
      <ellipse cx="290" cy="93" rx="18" ry="4.5" fill="#1d3a4a" />
      <ellipse cx="286" cy="92.4" rx="7" ry="1.6" fill="#2e5a70" />
    </svg>
  );
});
