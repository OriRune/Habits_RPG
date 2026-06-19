import { useState } from 'react';
import { type LucideIcon, ChevronDown, BookOpen } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface GuideSection {
  heading: string;
  /** Plain instructional lines rendered as a bulleted list. */
  items?: string[];
  /** Icon legend rows: emoji/glyph + short description. */
  legend?: { icon: string; label: string }[];
}

export interface MinigameGuide {
  sections: GuideSection[];
}

export interface HubCard<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
  blurb: string;
  /** Optional inline how-to guide shown via an expandable toggle below the card. */
  guide?: MinigameGuide;
}

interface HubGridProps<T extends string> {
  title: string;
  description?: string;
  cards: HubCard<T>[];
  onPick: (id: T) => void;
}

/** A card-grid hub for navigating to sub-modes (Explore, Battle, etc.). */
export function HubGrid<T extends string>({
  title,
  description,
  cards,
  onPick,
}: HubGridProps<T>) {
  const [openGuide, setOpenGuide] = useState<T | null>(null);

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-wide text-gold-bright">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-on-wood-mid">{description}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ id, label, icon: Icon, blurb, guide }) => (
          <div
            key={id}
            className="rounded-lg texture-parchment shadow-gold transition-shadow hover:shadow-glow"
          >
            {/* Main entry button — click to enter the minigame */}
            <button
              onClick={() => onPick(id)}
              className={cn(
                'relative block w-full p-5 text-left',
                'transition-transform hover:-translate-y-0.5',
                'motion-reduce:hover:translate-y-0',
              )}
            >
              {/* Icon badge */}
              <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-md border border-gold-deep/30 bg-wood/20 text-ember">
                <Icon className="h-6 w-6" />
              </div>

              <div className="font-display text-base font-bold text-ink">{label}</div>
              <p className="mt-1 text-sm leading-snug text-ink-muted">{blurb}</p>

              {/* Subtle chevron */}
              <span className="absolute bottom-3 right-4 font-display text-sm text-gold-deep/40">
                ❯
              </span>
            </button>

            {/* Guide toggle — only rendered when the card has guide content */}
            {guide && (
              <div className="border-t border-gold-deep/20 px-5">
                <button
                  type="button"
                  onClick={() => setOpenGuide(openGuide === id ? null : id)}
                  aria-expanded={openGuide === id}
                  className="flex w-full items-center gap-1.5 py-2 text-xs text-ink-muted transition-colors hover:text-ink"
                >
                  <BookOpen className="h-3 w-3 shrink-0" />
                  <span>How to play</span>
                  <ChevronDown
                    className={cn(
                      'ml-auto h-3 w-3 shrink-0 transition-transform duration-200',
                      openGuide === id && 'rotate-180',
                    )}
                  />
                </button>

                {openGuide === id && (
                  <div className="space-y-3 pb-4 pt-0.5">
                    {guide.sections.map((section) => (
                      <div key={section.heading}>
                        <div className="mb-1 font-display text-[10px] uppercase tracking-widest text-gold-bright">
                          {section.heading}
                        </div>
                        {section.items && section.items.length > 0 && (
                          <ul className="space-y-0.5">
                            {section.items.map((item, i) => (
                              <li key={i} className="flex gap-1.5 text-xs text-ink-muted">
                                <span className="mt-0.5 shrink-0 text-gold-deep/60">·</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {section.legend && section.legend.length > 0 && (
                          <div className="space-y-0.5">
                            {section.legend.map(({ icon, label }) => (
                              <div key={icon + label} className="flex items-start gap-2 text-xs">
                                <span className="w-6 shrink-0 text-center leading-snug">{icon}</span>
                                <span className="text-ink-muted">{label}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
