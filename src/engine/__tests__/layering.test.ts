/**
 * Layering guard — enforces the engine/content boundary as a CI gate (documented
 * in CLAUDE.md, previously convention-only):
 *   1. src/engine/ is pure: no imports from react, the store, or the net layer…
 *   2. …and touches no DOM/browser globals (document/window/localStorage) — ARCH-12.
 *   3. src/content/ is data-only: no react/store/net deps, and no boon-style effect
 *      reducers (those are engine RULES; content holds only the BOONS data) — ARCH-11.
 *
 * Technique: uses Vite/Vitest's `import.meta.glob` to eagerly import all engine and
 * content .ts source files as raw strings (no Node fs or path needed), then scans
 * each file's content for forbidden patterns.
 *
 * Excluded automatically: __tests__ directories (filtered post-load).
 */
import { describe, it, expect } from 'vitest';

/**
 * Eagerly load every engine/content .ts file as a raw string. Keys are repo-relative
 * paths like `/src/engine/mining.ts`. The glob pattern must be a string literal for
 * Vite's static analysis.
 */
const engineSources = import.meta.glob<string>(
  '/src/engine/**/*.ts',
  { eager: true, query: '?raw', import: 'default' },
);
const contentSources = import.meta.glob<string>(
  '/src/content/**/*.ts',
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

/**
 * DOM/browser-global access that must never appear in engine/ — the engine is pure
 * game logic; anything that touches the DOM is a rendering effect and belongs in
 * lib/ or a component (ARCH-12: `applyPalette` moved to lib for exactly this).
 * Matched as MEMBER access (`.<identifier>` or `[`) so prose that merely mentions
 * the word — "the scrolling camera window." — doesn't trip the guard.
 */
const ENGINE_DOM_FORBIDDEN: RegExp[] = [
  /\bdocument\.\w/,   /\bdocument\[/,
  /\bwindow\.\w/,     /\bwindow\[/,
  /\blocalStorage\.\w/,   /\blocalStorage\[/,
  /\bsessionStorage\.\w/, /\bsessionStorage\[/,
];

/** Runtime-dependency imports forbidden in content/ (data-only). Checked only on
 *  non-`import type` lines — a type-only import is erased at runtime and creates no
 *  coupling (e.g. content/habitTemplates.ts imports the NewHabitInput *type*). */
const CONTENT_RUNTIME_FORBIDDEN: RegExp[] = [
  /from\s+['"]react['"]/,
  /from\s+['"]@\/store\//,
  /from\s+['"]\.\.\/store\//,
  /from\s+['"]@\/net\//,
  /from\s+['"]\.\.\/net\//,
];

/** A `boon*` effect reducer is engine logic that leaked into content (the ARCH-11
 *  inversion). Deliberately NOT a blanket function-export ban — content legitimately
 *  holds trivial `TABLE[key]` accessors (getMineOre/getForestNode/…), which don't
 *  start with `boon`. */
const CONTENT_REDUCER_FORBIDDEN = /export\s+function\s+boon[A-Z]/;

function scan(
  sources: Record<string, string>,
  patterns: RegExp[],
): string[] {
  const violations: string[] = [];
  for (const [filePath, source] of Object.entries(sources)) {
    if (typeof source !== 'string' || filePath.includes('/__tests__/')) continue;
    source.split('\n').forEach((line, idx) => {
      for (const pattern of patterns) {
        if (pattern.test(line)) violations.push(`${filePath}:${idx + 1}  ${line.trim()}`);
      }
    });
  }
  return violations;
}

function scanContent(sources: Record<string, string>): string[] {
  const violations: string[] = [];
  for (const [filePath, source] of Object.entries(sources)) {
    if (typeof source !== 'string' || filePath.includes('/__tests__/')) continue;
    source.split('\n').forEach((line, idx) => {
      const isTypeImport = /^\s*(import|export)\s+type\b/.test(line);
      if (!isTypeImport) {
        for (const pattern of CONTENT_RUNTIME_FORBIDDEN) {
          if (pattern.test(line)) violations.push(`${filePath}:${idx + 1}  ${line.trim()}`);
        }
      }
      if (CONTENT_REDUCER_FORBIDDEN.test(line)) {
        violations.push(`${filePath}:${idx + 1}  ${line.trim()}`);
      }
    });
  }
  return violations;
}

describe('engine/ layering guard', () => {
  const sourceEntries = Object.entries(engineSources).filter(
    ([path]) => !path.includes('/__tests__/'),
  );

  it('engine/ contains source .ts files to scan', () => {
    expect(sourceEntries.length).toBeGreaterThan(10);
  });

  it('no engine file imports from react, @/store, or @/net', () => {
    const violations = scan(engineSources, FORBIDDEN);
    if (violations.length > 0) {
      expect.fail(
        'engine/ layering violation(s) — forbidden import(s) found:\n\n' +
          violations.map((v) => `  ${v}`).join('\n') +
          '\n\nEngine files must be pure: no react, store, or net imports. ' +
          'Move the logic to src/store/ or src/hooks/ instead.',
      );
    }
  });

  it('no engine file touches the DOM (document/window/localStorage) — ARCH-12', () => {
    const violations = scan(engineSources, ENGINE_DOM_FORBIDDEN);
    if (violations.length > 0) {
      expect.fail(
        'engine/ purity violation(s) — DOM/browser-global access found:\n\n' +
          violations.map((v) => `  ${v}`).join('\n') +
          '\n\nEngine files must not touch the DOM. Move the rendering effect to ' +
          'src/lib/ or a component (see applyPalette → @/lib/palettes).',
      );
    }
  });
});

/**
 * Party-visit forward-compat freeze (plan3 10.6 / M6): the Homestead is solo in v1. The future
 * read-only party-visit is the ONLY sanctioned path to broadcast town state, and it doesn't
 * exist yet — so net/coop must not import engine/town today. This guard makes that a CI gate.
 */
const coopSources = import.meta.glob<string>(
  '/src/net/coop/**/*.ts',
  { eager: true, query: '?raw', import: 'default' },
);

const COOP_TOWN_FORBIDDEN: RegExp[] = [
  /from\s+['"]@\/engine\/town['"]/,
  /from\s+['"][^'"]*\/town['"]/,
  /import\s*\(\s*['"]@\/engine\/town['"]/,
];

describe('net/coop → town freeze guard', () => {
  it('no net/coop file imports engine/town (v1 must not broadcast town state)', () => {
    const violations = scan(coopSources, COOP_TOWN_FORBIDDEN);
    if (violations.length > 0) {
      expect.fail(
        'net/coop imports engine/town — the party-visit protocol is not built yet:\n\n' +
          violations.map((v) => `  ${v}`).join('\n') +
          '\n\nv1 is solo; town state must not be broadcast. See the TownState doc block.',
      );
    }
  });
});

describe('content/ data-only guard', () => {
  it('content/ contains source .ts files to scan', () => {
    const count = Object.keys(contentSources).filter((p) => !p.includes('/__tests__/')).length;
    expect(count).toBeGreaterThan(5);
  });

  it('content/ is data-only: no react/store/net deps, no boon-effect reducers — ARCH-11', () => {
    const violations = scanContent(contentSources);
    if (violations.length > 0) {
      expect.fail(
        'content/ layering violation(s) found:\n\n' +
          violations.map((v) => `  ${v}`).join('\n') +
          '\n\nContent is static data only. Effect reducers (boon*Mult/…) are engine ' +
          'RULES — put them in src/engine/crawl.ts; content holds just the BOONS table.',
      );
    }
  });
});
