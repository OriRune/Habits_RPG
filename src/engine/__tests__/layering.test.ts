/**
 * Layering guard — enforces that src/engine/ is pure: no imports from react,
 * the store, or the net layer. This rule is documented in CLAUDE.md and was
 * previously maintained only by convention; this test makes it a CI gate.
 *
 * Technique: uses Vite/Vitest's `import.meta.glob` to eagerly import all
 * engine .ts source files as raw strings (no Node fs or path needed), then
 * scans each file's content for forbidden import patterns.
 *
 * Excluded automatically: __tests__ directories (the glob pattern skips them).
 */
import { describe, it, expect } from 'vitest';

/**
 * Eagerly load every engine .ts file (excluding __tests__) as a raw string.
 * Keys are repo-relative paths like `/src/engine/mining.ts`.
 * The glob pattern must be a string literal for Vite's static analysis.
 */
const engineSources = import.meta.glob<string>(
  '/src/engine/**/*.ts',
  { eager: true, query: '?raw', import: 'default' },
);

/**
 * Import patterns that must never appear in engine/ code.
 * Catches both static `from '...'` and dynamic `import('...')` variants.
 */
const FORBIDDEN: RegExp[] = [
  /from\s+['"]react['"]/,
  /from\s+['"]@\/store\//,
  /from\s+['"]\.\.\/store\//,
  /from\s+['"]@\/net\//,
  /from\s+['"]\.\.\/net\//,
  /import\s*\(\s*['"]react['"]/,
  /import\s*\(\s*['"]@\/store\//,
  /import\s*\(\s*['"]@\/net\//,
];

describe('engine/ layering guard', () => {
  // Filter out __tests__ files (glob can't exclude a directory segment easily
  // in all Vite versions, so we do it post-load).
  const sourceEntries = Object.entries(engineSources).filter(
    ([path]) => !path.includes('/__tests__/'),
  );

  it('engine/ contains source .ts files to scan', () => {
    expect(sourceEntries.length).toBeGreaterThan(10);
  });

  const violations: string[] = [];

  for (const [filePath, source] of sourceEntries) {
    if (typeof source !== 'string') continue;
    const lines = source.split('\n');
    lines.forEach((line: string, idx: number) => {
      for (const pattern of FORBIDDEN) {
        if (pattern.test(line)) {
          violations.push(`${filePath}:${idx + 1}  ${line.trim()}`);
        }
      }
    });
  }

  it('no engine file imports from react, @/store, or @/net', () => {
    if (violations.length > 0) {
      expect.fail(
        'engine/ layering violation(s) — forbidden import(s) found:\n\n' +
          violations.map((v) => `  ${v}`).join('\n') +
          '\n\nEngine files must be pure: no react, store, or net imports. ' +
          'Move the logic to src/store/ or src/hooks/ instead.',
      );
    }
  });
});
