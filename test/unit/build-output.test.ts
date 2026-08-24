/**
 * Build-output sanity checks.
 *
 * Guards against the "black screen on the Pi" regression where the
 * production HTML shipped without a CSS link because Vite stripped the
 * static <link> tag and no JS module imported the tokens. If the
 * dist/public artifacts exist we assert each entry HTML contains at
 * least one fingerprinted stylesheet link. If the build hasn't been
 * run, the suite skips cleanly so it doesn't gate `npm test` locally.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const DIST_DIR = resolve(__dirname, '../../dist/public');
const ENTRY_HTMLS = ['index.html'];

const buildIsPresent = existsSync(resolve(DIST_DIR, 'index.html'));

describe.skipIf(!buildIsPresent)('built HTML output', () => {
  for (const file of ENTRY_HTMLS) {
    const filePath = resolve(DIST_DIR, file);

    describe(file, () => {
      it('exists in dist/public', () => {
        expect(existsSync(filePath)).toBe(true);
      });

      it('contains at least one stylesheet <link>', () => {
        const html = readFileSync(filePath, 'utf-8');
        const matches = html.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi);
        expect(matches, `${file} is missing a <link rel="stylesheet"> tag`).not.toBeNull();
        expect(matches!.length).toBeGreaterThan(0);
      });

      it('stylesheet links point at fingerprinted assets', () => {
        const html = readFileSync(filePath, 'utf-8');
        const linkRe = /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi;
        const hrefs: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = linkRe.exec(html)) !== null) {
          hrefs.push(m[1]);
        }
        expect(hrefs.length).toBeGreaterThan(0);
        for (const href of hrefs) {
          expect(
            href.endsWith('.css'),
            `stylesheet href ${href} should end in .css`,
          ).toBe(true);
        }
      });

      it('references a corresponding ESM script entry', () => {
        const html = readFileSync(filePath, 'utf-8');
        expect(html).toMatch(/<script[^>]+type=["']module["']/i);
      });
    });
  }
});

describe.skipIf(buildIsPresent)('built HTML output (build absent)', () => {
  it('skips build-output checks when dist/public is not present', () => {
    expect(buildIsPresent).toBe(false);
  });
});
