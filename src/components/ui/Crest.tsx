import { cn } from '@/lib/cn';
import { type CrestLook } from '@/lib/sprites';

type CrestSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<CrestSize, { box: string; text: string }> = {
  sm: { box: 'h-8 w-8', text: 'text-sm' },
  md: { box: 'h-14 w-14', text: 'text-xl' },
  lg: { box: 'h-20 w-20', text: 'text-3xl' },
  xl: { box: 'h-28 w-28', text: 'text-5xl' },
};

interface CrestProps {
  look: CrestLook;
  size?: CrestSize;
  /** Undiscovered/locked rendering: shrouded with a '?' glyph. */
  shrouded?: boolean;
  className?: string;
}

/** Heraldic shield stand-in for a sprite: a glyph on a tinted, gold-rimmed shield. */
export function Crest({ look, size = 'md', shrouded = false, className }: CrestProps) {
  const s = SIZES[size];
  const tint = shrouded ? '#4a3320' : look.color;
  return (
    <div className={cn('relative shrink-0', s.box, className)} aria-hidden>
      {/* Gold rim (shield-shaped) */}
      <div className="clip-shield absolute inset-0 bg-gold-deep" />
      {/* Tinted field */}
      <div
        className="clip-shield absolute inset-[2px]"
        style={{ background: `linear-gradient(160deg, ${tint} 0%, rgba(0,0,0,0.45) 140%)` }}
      />
      {/* Glyph */}
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center font-display font-bold',
          s.text,
          shrouded ? 'text-parchment-400/40' : 'text-parchment-100',
        )}
        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}
      >
        {shrouded ? '?' : look.glyph}
      </div>
    </div>
  );
}
