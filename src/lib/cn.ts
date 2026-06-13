/** Tiny classnames helper — joins truthy class fragments. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
