/** A simple heraldic figure used as the backdrop for the equipment paper-doll. */
export function CharacterSilhouette({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 160" className={className} aria-hidden="true">
      <g fill="rgba(120,86,40,0.16)" stroke="rgba(138,109,31,0.55)" strokeWidth="2" strokeLinejoin="round">
        <circle cx="50" cy="20" r="13" />
        <rect x="33" y="35" width="34" height="48" rx="9" />
        <rect x="19" y="37" width="12" height="42" rx="6" />
        <rect x="69" y="37" width="12" height="42" rx="6" />
        <rect x="35" y="82" width="13" height="58" rx="6" />
        <rect x="52" y="82" width="13" height="58" rx="6" />
      </g>
    </svg>
  );
}
