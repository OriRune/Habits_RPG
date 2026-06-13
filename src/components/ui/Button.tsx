import { type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const VARIANTS: Record<Variant, string> = {
  // Gold plaque with dark ink lettering.
  primary:
    'bg-gradient-to-b from-gold-bright to-gold-deep text-wood-900 border border-gold-deep ' +
    'hover:from-gold hover:to-gold-deep shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]',
  // Carved wood with gold trim.
  secondary:
    'texture-wood text-parchment-200 border border-gold-deep/70 hover:border-gold ' +
    'shadow-[inset_0_1px_0_rgba(255,200,120,0.12)]',
  // Ember for destructive/alert.
  danger:
    'bg-gradient-to-b from-ember-bright to-ember text-parchment-100 border border-ember ' +
    'hover:from-ember hover:to-ember/90',
};

/** Themed button with a fantasy serif label and gold/ember styling. */
export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'rounded-md px-4 py-2 font-display text-sm font-semibold tracking-wide transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        VARIANTS[variant],
        className,
      )}
    />
  );
}
