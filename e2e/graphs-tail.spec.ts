import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow } from './helpers/localStorage';
import { setupApiMock } from './helpers/apiMock';
import * as fs from 'fs';
import * as path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');

/**
 * Derive a slowed-down GPX from gpxText by stretching the first 1/3 of
 * timestamps by factor 1.5.  Returns the modified GPX and the steady-state
 * gap in seconds — the constant time offset between the two tracks that
 * holds for all positions AFTER the slowdown window ends.  Within the
 * window the gap grows from 0 to tailGapSeconds; it is NOT constant
 * throughout the entire track.
 */
function makeSlowGPX(gpxText: string): { slowGPX: string; tailGapSeconds: number } {
  const timePattern = /<time>([^<]+)<\/time>/g;
  const entries: Array<{ full: string; epochMs: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = timePattern.exec(gpxText)) !== null) {
    entries.push({ full: m[0], epochMs: new Date(m[1]).getTime() });
  }

  const startMs = entries[0].epochMs;
  const relSeconds = entries.map(e => (e.epochMs - startMs) / 1000);
  const n = relSeconds.length;
  if (n < 3) throw new Error('makeSlowGPX requires at least 3 track points');
  // Slow down the first 1/3 of points by factor k=1.5.
  const windowEndIdx = Math.floor(n / 3);          // exclusive upper bound
  const windowDuration = relSeconds[windowEndIdx - 1]; // last point inside window
  const k = 1.5;
  const tailGapSeconds = (k - 1) * windowDuration; // offset applied to all points after the window

  const newRelSeconds = relSeconds.map((t, i) =>
    i < windowEndIdx ? t * k : t + tailGapSeconds
  );

  let result = gpxText;
  // Replace from last to first so string offsets are not disturbed.
  for (let i = entries.length - 1; i >= 0; i--) {
    const newEpochMs = startMs + newRelSeconds[i] * 1000;
    const newISO = new Date(newEpochMs).toISOString();
    result = result.replace(entries[i].full, `<time>${newISO}</time>`);
  }

  return { slowGPX: result, tailGapSeconds };
}

/**
 * Compute the time-behind diff series from window.tracks using the same
 * two-branch formula as drawDifferenceGraph in graphs.js:
 *   - t > compEnd (comp finished first): tCompAtDLeader - t
 *   - otherwise: t - tLeaderAtDComp
 * gvap() clamps at track endpoints, so no explicit out-of-range guard is needed.
 */
function diffSeriesScript() {
  const tracks = (window as any).tracks;
  const leader = tracks[0];
  const comp = tracks[1];
  const leaderMaxDist = leader[leader.length - 1].displayDistance;
  const leaderEnd = leader[leader.length - 1].time;
  const compEnd = comp[comp.length - 1].time;
  const compFinishedFirst = compEnd < leaderEnd;
  const maxT = Math.max(leaderEnd, compEnd);

  function gvap(tr: any[], posField: string, pos: number, valField: string): number {
    if (pos <= tr[0][posField]) return tr[0][valField];
    if (pos >= tr[tr.length - 1][posField]) return tr[tr.length - 1][valField];
    for (let i = 1; i < tr.length; i++) {
      if (tr[i][posField] >= pos) {
        const p0 = tr[i - 1][posField], p1 = tr[i][posField];
        const v0 = tr[i - 1][valField], v1 = tr[i][valField];
        return v0 + (pos - p0) / (p1 - p0) * (v1 - v0);
      }
    }
    return tr[tr.length - 1][valField];
  }

  const diffs: number[] = [];
  for (let t = 0; t <= maxT; t++) {
    let diff: number;
    if (compFinishedFirst && t > compEnd) {
      // Mirror graphs.js: anchor to leader's position, find when comp was there.
      const dLeader = gvap(leader, 'time', t, 'displayDistance');
      const tCompAtD = gvap(comp, 'displayDistance', dLeader, 'time');
      diff = tCompAtD - t;
    } else {
      // Both running, or leader finished first.
      const dComp = gvap(comp, 'time', t, 'displayDistance');
      const tLeader = gvap(leader, 'displayDistance', dComp, 'time');
      diff = t - tLeader;
    }
    diffs.push(diff);
  }
  return diffs;
}

/**
 * Parse the diff SVG path's L-command y-values and return the ratio of the
 * tail y-range to the total path y-range.
 *
 * Before the PR-81 fix, a spike at t=maxTime caused the tail to jump from
 * its steady-state value to an extreme outlier, giving a ratio near 1.0.
 * After the fix, the tail is smooth and the ratio is near 0.  A threshold
 * of 0.2 leaves generous headroom for normal interpolation variation while
 * reliably catching the pre-fix cliff (which was typically > 0.8).
 */
function tailFlatnessScript() {
  const svgs = document.querySelectorAll('#graph svg');
  if (svgs.length < 2) return null;
  const diffSvg = svgs[1];

  // Find the path with the longest d attribute (the diff line).
  let bestD = '';
  diffSvg.querySelectorAll('path').forEach((p: Element) => {
    const d = p.getAttribute('d') || '';
    if (d.length > bestD.length) bestD = d;
  });

  const ys: number[] = [];
  const re = /L\s*([\d.]+)\s*,\s*([\d.]+)/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(bestD)) !== null) ys.push(parseFloat(mm[2]));

  if (ys.length < 5) return null;
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yRange = yMax - yMin;
  if (yRange < 1) return 0; // all values the same → flat line, trivially passes

  const tail = ys.slice(-20);
  return (Math.max(...tail) - Math.min(...tail)) / yRange;
}

test.describe('Time-behind tail: no spike at graph end', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await setupApiMock(page);
    await page.reload();
  });

  // Sanity check for the normal (comp finishes after leader) upload order.
  // The cliff bug did not manifest here, but the assertions confirm the
  // formula and SVG render remain correct after any future refactor.
  test('fast-first: final diff matches known gap, no cliff in SVG tail', async ({ page }) => {
    const fastGPX = fs.readFileSync(path.join(fixturesDir, 'track1.gpx'), 'utf-8');
    const { slowGPX, tailGapSeconds: gap } = makeSlowGPX(fastGPX);

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles({
      name: 'fast.gpx',
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from(fastGPX),
    });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    await fileInput.setInputFiles({
      name: 'slow.gpx',
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from(slowGPX),
    });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });
    await page.waitForTimeout(500);

    expect(await page.evaluate(() => (window as any).all_match)).toBe(true);
    await expect(page.locator('#graph svg')).toHaveCount(2, { timeout: 5000 });

    const diffs = await page.evaluate(diffSeriesScript);
    expect(diffs.length).toBeGreaterThan(10);
    const last = diffs[diffs.length - 1];
    const prev = diffs[diffs.length - 2];

    // comp (slow) finishes after leader (fast) → diff at tail ≈ +gap
    expect(Math.abs(last - gap)).toBeLessThan(5);
    expect(Math.abs(last - prev)).toBeLessThan(5);

    const tailRatio = await page.evaluate(tailFlatnessScript);
    expect(tailRatio).not.toBeNull();
    expect(tailRatio!).toBeLessThan(0.2);
  });

  // Regression test for the cliff bug: when the comp (fast) finishes before
  // the leader (slow), the pre-#81 formula left an isolated terminal point
  // that caused a spike to ±250-360 s at t=maxTime.  The SVG tailRatio
  // assertion directly verifies the rendered path has no such cliff.
  test('slow-first: final diff matches known gap, no cliff in SVG tail', async ({ page }) => {
    const fastGPX = fs.readFileSync(path.join(fixturesDir, 'track1.gpx'), 'utf-8');
    const { slowGPX, tailGapSeconds: gap } = makeSlowGPX(fastGPX);

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles({
      name: 'slow.gpx',
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from(slowGPX),
    });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    await fileInput.setInputFiles({
      name: 'fast.gpx',
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from(fastGPX),
    });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });
    await page.waitForTimeout(500);

    expect(await page.evaluate(() => (window as any).all_match)).toBe(true);
    await expect(page.locator('#graph svg')).toHaveCount(2, { timeout: 5000 });

    const diffs = await page.evaluate(diffSeriesScript);
    expect(diffs.length).toBeGreaterThan(10);
    const last = diffs[diffs.length - 1];
    const prev = diffs[diffs.length - 2];

    // comp (fast) finishes before leader (slow) → diff at tail ≈ -gap
    expect(Math.abs(last - (-gap))).toBeLessThan(5);
    expect(Math.abs(last - prev)).toBeLessThan(5);

    // SVG-level assertion: the rendered tail must not spike.
    // Before the fix the ratio was near 1.0; after, near 0.
    const tailRatio = await page.evaluate(tailFlatnessScript);
    expect(tailRatio).not.toBeNull();
    expect(tailRatio!).toBeLessThan(0.2);
  });
});
