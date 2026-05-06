import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow } from './helpers/localStorage';
import { setupApiMock } from './helpers/apiMock';
import * as fs from 'fs';
import * as path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');

/**
 * Derive a slowed-down GPX from gpxText by stretching the first 1/3 of
 * timestamps by factor 1.5. Returns the modified GPX and the resulting
 * constant time gap in seconds.
 */
function makeSlowGPX(gpxText: string): { slowGPX: string; expectedGapSeconds: number } {
  const timePattern = /<time>([^<]+)<\/time>/g;
  const entries: Array<{ full: string; epochMs: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = timePattern.exec(gpxText)) !== null) {
    entries.push({ full: m[0], epochMs: new Date(m[1]).getTime() });
  }

  const startMs = entries[0].epochMs;
  const relSeconds = entries.map(e => (e.epochMs - startMs) / 1000);
  const n = relSeconds.length;
  // Slow down the first 1/3 of points by factor k=1.5.
  const windowEndIdx = Math.floor(n / 3);          // exclusive upper bound
  const windowDuration = relSeconds[windowEndIdx - 1]; // last point inside window
  const k = 1.5;
  const offset = (k - 1) * windowDuration;           // constant gap added to rest

  const newRelSeconds = relSeconds.map((t, i) =>
    i < windowEndIdx ? t * k : t + offset
  );

  let result = gpxText;
  // Replace from last to first so string offsets are not disturbed.
  for (let i = entries.length - 1; i >= 0; i--) {
    const newEpochMs = startMs + newRelSeconds[i] * 1000;
    const newISO = new Date(newEpochMs).toISOString();
    result = result.replace(entries[i].full, `<time>${newISO}</time>`);
  }

  return { slowGPX: result, expectedGapSeconds: offset };
}

/**
 * Compute the time-behind diff series from window.tracks using the same
 * two-branch formula as drawDifferenceGraph in graphs.js:
 *   - t > compEnd (comp finished first): tCompAtDLeader - t
 *   - otherwise: t - tLeaderAtDComp
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
      const dComp = gvap(comp, 'time', t, 'displayDistance');
      if (dComp > leaderMaxDist) continue;
      const tLeader = gvap(leader, 'displayDistance', dComp, 'time');
      diff = t - tLeader;
    }
    diffs.push(diff);
  }
  return diffs;
}

/**
 * Parse the diff SVG path's L-command y-values and return the ratio of
 * the tail's y-range to the total y-range.  A value near zero means the
 * tail is flat (no spike); a large value (> 0.2) indicates a cliff.
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
  if (yRange < 1) return 0; // all values the same → flat line

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

  test('fast-first: tail stays flat at known gap', async ({ page }) => {
    const fastGPX = fs.readFileSync(path.join(fixturesDir, 'track1.gpx'), 'utf-8');
    const { slowGPX, expectedGapSeconds: gap } = makeSlowGPX(fastGPX);

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

    // comp (slow) is behind leader (fast), so diff at tail ≈ +gap
    expect(Math.abs(last - gap)).toBeLessThan(5);
    // No cliff between the last two samples
    expect(Math.abs(last - prev)).toBeLessThan(5);

    const tailRatio = await page.evaluate(tailFlatnessScript);
    expect(tailRatio).not.toBeNull();
    expect(tailRatio!).toBeLessThan(0.2);
  });

  test('slow-first: tail stays flat at known gap', async ({ page }) => {
    const fastGPX = fs.readFileSync(path.join(fixturesDir, 'track1.gpx'), 'utf-8');
    const { slowGPX, expectedGapSeconds: gap } = makeSlowGPX(fastGPX);

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

    // comp (fast) is ahead of leader (slow), so diff at tail ≈ -gap
    expect(Math.abs(last - (-gap))).toBeLessThan(5);
    // No cliff between the last two samples
    expect(Math.abs(last - prev)).toBeLessThan(5);

    // SVG tail flatness — this is what catches the graphs.js cliff
    const tailRatio = await page.evaluate(tailFlatnessScript);
    expect(tailRatio).not.toBeNull();
    expect(tailRatio!).toBeLessThan(0.2);
  });
});
