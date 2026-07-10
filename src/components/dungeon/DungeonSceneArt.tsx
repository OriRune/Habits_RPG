import { type ReactNode, useId } from 'react';

const SUPPORTED_SCENES = new Set([
  'room:combat', 'room:treasure', 'room:rest', 'room:boss', 'room:encounter',
  'room:shrine', 'room:merchant', 'room:elite',
  'dungeon:entrance', 'dungeon:checkpoint', 'dungeon:cleared', 'dungeon:retreat',
  'outcome:success', 'outcome:partial', 'outcome:fail',
  'combat:victory', 'combat:defeat',
]);

export function hasDungeonSceneArt(sceneKey: string): boolean {
  return SUPPORTED_SCENES.has(sceneKey);
}

function Campfire() {
  return <>
    <ellipse cx="320" cy="194" rx="88" ry="18" fill="#0b0807" opacity=".72" />
    <path d="m273 202 92-39m-89 0 86 41" stroke="#61361f" strokeWidth="15" strokeLinecap="round" />
    <g className="dungeon-scene-flame">
      <path d="M320 184c-31-27 4-46-2-78 35 28 48 52 24 78z" fill="#c45b2d" />
      <path d="M321 184c-14-19 11-31 7-52 20 20 23 35 9 52z" fill="#f3c562" />
    </g>
  </>;
}

function Chest() {
  return <g transform="translate(242 91)">
    <ellipse cx="80" cy="113" rx="103" ry="19" fill="#0b0807" opacity=".72" />
    <path d="M3 55h154v65H3z" fill="#5b311a" stroke="#d1a43a" strokeWidth="6" />
    <path d="M3 55C3 16 31 4 80 4s77 12 77 51z" fill="#744426" stroke="#d1a43a" strokeWidth="6" />
    <path d="M70 48h20v35H70z" fill="#e8c860" stroke="#6e4e17" strokeWidth="4" />
    <g className="dungeon-scene-glow" fill="#f6dc7c">
      <circle cx="34" cy="22" r="4" /><circle cx="127" cy="30" r="3" /><path d="m105 8 4 8 8 4-8 4-4 8-4-8-8-4 8-4z" />
    </g>
  </g>;
}

function Shrine() {
  return <g>
    <ellipse cx="320" cy="199" rx="92" ry="16" fill="#0b0807" opacity=".65" />
    <path d="M250 187h140l-14-38H264zM277 149h86l-12-55h-62z" fill="#474047" stroke="#8d7a71" strokeWidth="5" />
    <g className="dungeon-scene-glow">
      <path d="m320 53 27 39-27 31-27-31z" fill="#b69bea" stroke="#f1ddff" strokeWidth="4" />
      <circle cx="320" cy="88" r="56" fill="none" stroke="#b69bea" strokeWidth="3" opacity=".35" />
    </g>
  </g>;
}

function Scroll() {
  return <g transform="translate(222 63) rotate(-4 98 70)">
    <path d="M24 11h149v122H24c12-12 12-25 0-37 12-14 12-29 0-43 12-14 12-28 0-42z" fill="#e7d4a2" stroke="#8b6335" strokeWidth="6" />
    <path d="M49 43h99M49 65h82M49 87h91M49 109h64" stroke="#7b5a35" strokeWidth="6" strokeLinecap="round" opacity=".72" />
    <circle cx="171" cy="122" r="24" fill="#963f31" stroke="#d8a05a" strokeWidth="4" />
  </g>;
}

function Merchant() {
  return <g>
    <ellipse cx="320" cy="204" rx="110" ry="17" fill="#0b0807" opacity=".7" />
    <path d="M272 175c4-82 18-119 49-119s48 40 51 119z" fill="#30273a" stroke="#8f7440" strokeWidth="5" />
    <path d="M289 94c8-38 22-55 32-55s28 20 36 55c-20-12-48-12-68 0z" fill="#191522" />
    <circle cx="308" cy="91" r="4" fill="#e8c860" /><circle cx="335" cy="91" r="4" fill="#e8c860" />
    <path d="M218 173h204v38H218z" fill="#67401f" stroke="#a97c35" strokeWidth="5" />
    <g className="dungeon-scene-glow" fill="#e8c860"><circle cx="265" cy="166" r="13" /><circle cx="389" cy="163" r="9" /><circle cx="410" cy="177" r="7" /></g>
  </g>;
}

function Door({ open = false }: { open?: boolean }) {
  return <g>
    <path d="M229 205V76c0-47 40-67 91-67s91 20 91 67v129z" fill="#201716" stroke="#75604e" strokeWidth="10" />
    <path d="M262 205V78c0-30 24-43 58-43s58 13 58 43v127z" fill={open ? '#d7ad55' : '#100b0b'} stroke="#a87c35" strokeWidth="6" />
    {open && <path className="dungeon-scene-glow" d="M278 205V91c0-23 17-34 42-34s42 11 42 34v114z" fill="#f5d77c" opacity=".35" />}
    <path d="M320 38v166" stroke="#6d4926" strokeWidth="5" opacity=".65" />
  </g>;
}

function Crown({ broken = false }: { broken?: boolean }) {
  return <g className="dungeon-scene-glow" transform={broken ? 'translate(318 121) rotate(18) translate(-318 -121)' : undefined}>
    <path d="m235 82 48 41 37-72 38 72 48-41-18 105H253z" fill={broken ? '#77706b' : '#d8ad35'} stroke={broken ? '#aaa19a' : '#f7df81'} strokeWidth="7" />
    <path d="M253 159h135v31H253z" fill={broken ? '#57514e' : '#9e6f19'} />
    {broken && <path d="m325 70-23 43 28 18-25 58" fill="none" stroke="#2b2221" strokeWidth="9" />}
  </g>;
}

function Blades({ boss = false }: { boss?: boolean }) {
  return <g transform="translate(320 126)">
    <g transform="rotate(-42)"><path d="M-9-88h18v134H-9z" fill="#c6c5bd" stroke="#5d6265" strokeWidth="5" /><path d="m0-116 13 28h-26z" fill="#e8e4d6" /><path d="M-35 42h70v14h-70z" fill="#bd8a2e" /></g>
    <g transform="rotate(42)"><path d="M-9-88h18v134H-9z" fill="#c6c5bd" stroke="#5d6265" strokeWidth="5" /><path d="m0-116 13 28h-26z" fill="#e8e4d6" /><path d="M-35 42h70v14h-70z" fill="#bd8a2e" /></g>
    {boss && <path className="dungeon-scene-glow" d="m0-75 17 33 37 5-27 26 7 37L0 9l-34 17 7-37-27-26 37-5z" fill="#b04332" opacity=".9" />}
  </g>;
}

function SceneSubject({ sceneKey }: { sceneKey: string }): ReactNode {
  if (sceneKey === 'dungeon:entrance') return <Door />;
  if (sceneKey === 'dungeon:checkpoint' || sceneKey === 'room:rest') return <Campfire />;
  if (sceneKey === 'room:treasure') return <Chest />;
  if (sceneKey === 'room:shrine') return <Shrine />;
  if (sceneKey === 'room:merchant') return <Merchant />;
  if (sceneKey === 'room:encounter' || sceneKey === 'outcome:partial') return <Scroll />;
  if (sceneKey === 'dungeon:cleared' || sceneKey === 'combat:victory' || sceneKey === 'outcome:success') return <Crown />;
  if (sceneKey === 'dungeon:retreat') return <Door open />;
  if (sceneKey === 'combat:defeat' || sceneKey === 'outcome:fail') return <Crown broken />;
  if (sceneKey === 'room:boss' || sceneKey === 'room:elite') return <Blades boss />;
  return <Blades />;
}

/** Cohesive, code-native scene art for Dungeon Delve. */
export function DungeonSceneArt({ sceneKey, label }: { sceneKey: string; label: string }) {
  const uid = useId().replace(/:/g, '');
  const bgId = `dungeon-bg-${uid}`;
  const haloId = `dungeon-halo-${uid}`;
  const stoneId = `dungeon-stone-${uid}`;
  const danger = /boss|elite|combat|defeat|fail/.test(sceneKey);
  const safe = /checkpoint|rest|cleared|success|victory/.test(sceneKey);
  const accent = danger ? '#8f3429' : safe ? '#997622' : '#53425f';

  return <svg
    viewBox="0 0 640 240"
    preserveAspectRatio="xMidYMid slice"
    role="img"
    aria-label={label}
    className="h-full w-full"
    data-dungeon-scene={sceneKey}
  >
    <defs>
      <linearGradient id={bgId} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#17131b" /><stop offset="1" stopColor="#080607" /></linearGradient>
      <radialGradient id={haloId}><stop stopColor={accent} stopOpacity=".75" /><stop offset="1" stopColor={accent} stopOpacity="0" /></radialGradient>
      <pattern id={stoneId} width="64" height="32" patternUnits="userSpaceOnUse"><path d="M0 1h64M0 31h64M32 1v30M0 16h32M48 16h16" stroke="#847266" strokeOpacity=".15" strokeWidth="2" /></pattern>
    </defs>
    <rect width="640" height="240" fill={`url(#${bgId})`} />
    <ellipse className="dungeon-scene-glow" cx="320" cy="124" rx="240" ry="145" fill={`url(#${haloId})`} />
    <path d="M0 39h105v201H0zm535 0h105v201H535z" fill={`url(#${stoneId})`} />
    <path d="M0 222Q160 199 320 220t320 2v18H0z" fill="#1d1512" />
    <g className="dungeon-scene-dust" fill="#ead9ad" opacity=".34"><circle cx="130" cy="82" r="2" /><circle cx="481" cy="61" r="2.5" /><circle cx="518" cy="144" r="1.8" /><circle cx="174" cy="171" r="1.5" /></g>
    <SceneSubject sceneKey={sceneKey} />
    <rect x="12" y="12" width="616" height="216" rx="8" fill="none" stroke="#b88b32" strokeOpacity=".48" strokeWidth="3" />
  </svg>;
}
