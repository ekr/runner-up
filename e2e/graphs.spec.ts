import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow } from './helpers/localStorage';
import { setupApiMock } from './helpers/apiMock';
import * as path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');

test.describe('Graphs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await setupApiMock(page);
    await page.reload();
  });

  test('should show compare-by menu', async ({ page }) => {
    await expect(page.locator(selectors.compareByMenu)).toBeVisible();
  });

  test('footer renders below graph container after plots are drawn', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    await fileInput.setInputFiles(path.join(fixturesDir, 'track2.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    // Wait for the elevation graph SVG to appear inside #graph.
    await expect(page.locator('#graph svg').first()).toBeVisible({ timeout: 5000 });

    const result = await page.evaluate(() => {
      const graph = document.getElementById('graph') as HTMLElement;
      const footer = document.getElementById('footer') as HTMLElement;
      const graphRect = graph.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        graphBottom: graphRect.bottom,
        footerTop: footerRect.top,
        footerBelowGraph: footerRect.top >= graphRect.bottom,
      };
    });

    expect(result.footerBelowGraph).toBe(true);
  });
});

test.describe('displayTime in non-overlapping segments', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await setupApiMock(page);
    await page.reload();
  });

  test('time slider bounds are continuous in overlapping mode', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Load track without the loop (shorter)
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-no-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // Load track with extra loop (creates non-overlapping segment)
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-with-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    // Wait for alignment
    await page.waitForTimeout(500);

    // Verify multiple segments detected (display mode should be visible)
    await expect(page.locator('#display-mode')).toBeVisible();

    // Select 'Overlapping' display mode
    await page.selectOption('#display-mode-select', 'overlapping');
    await page.waitForTimeout(300);

    // Get the time slider bounds
    const sliderBounds = await page.evaluate(() => {
      const slider = document.getElementById('time-slider') as HTMLInputElement;
      return {
        min: parseFloat(slider.min),
        max: parseFloat(slider.max)
      };
    });

    // Verify slider has valid bounds
    expect(sliderBounds.min).toBeGreaterThanOrEqual(0);
    expect(sliderBounds.max).toBeGreaterThan(sliderBounds.min);

    // Get the harmonized tracks and verify continuous time
    const trackInfo = await page.evaluate(() => {
      const tracks = (window as any).tracks;
      if (!tracks || tracks.length < 2) return null;

      // Check that times are monotonically increasing (no gaps from segment stitching)
      const checkContinuous = (track: any[]) => {
        for (let i = 1; i < track.length; i++) {
          if (track[i].time <= track[i - 1].time) {
            return false;
          }
        }
        return true;
      };

      return {
        track1Continuous: checkContinuous(tracks[0]),
        track2Continuous: checkContinuous(tracks[1]),
        track1Length: tracks[0].length,
        track2Length: tracks[1].length
      };
    });

    expect(trackInfo).not.toBeNull();
    expect(trackInfo!.track1Continuous).toBe(true);
    expect(trackInfo!.track2Continuous).toBe(true);
  });

  test('graphs render using displayDistance from harmonized tracks', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Load tracks with non-overlapping segments
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-no-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-with-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    await page.waitForTimeout(500);

    // Select 'Overlapping' display mode
    await page.selectOption('#display-mode-select', 'overlapping');
    await page.waitForTimeout(300);

    // Verify graphs are rendered
    const graphContainer = page.locator(selectors.graphContainer);
    await expect(graphContainer).toBeVisible();

    // Check that graph SVGs are present (elevation graph + difference graph)
    // Observable Plot creates SVG elements directly, not <figure> elements
    const graphs = page.locator('#graph svg');
    await expect(graphs).toHaveCount(2, { timeout: 5000 });

    // Verify displayDistance is set on track points
    const hasDisplayDistance = await page.evaluate(() => {
      const tracks = (window as any).tracks;
      if (!tracks || tracks.length < 1) return false;

      // Check that all points have displayDistance
      return tracks.every((track: any[]) =>
        track.every((point: any) => typeof point.displayDistance === 'number')
      );
    });

    expect(hasDisplayDistance).toBe(true);
  });

  test('overlapping mode sets up harmonized tracks for comparison', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Load tracks with non-overlapping segments
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-no-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-with-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    // Wait for alignment and verify display mode is available
    await expect(page.locator('#display-mode')).toBeVisible({ timeout: 5000 });

    // Select 'Overlapping' display mode
    await page.selectOption('#display-mode-select', 'overlapping');
    await page.waitForTimeout(300);

    // Verify all_match is true in overlapping mode (required for comparison)
    const allMatch = await page.evaluate(() => {
      return (window as any).all_match;
    });
    expect(allMatch).toBe(true);

    // Verify both the elevation and difference graphs are rendered
    const graphs = page.locator('#graph svg');
    await expect(graphs).toHaveCount(2, { timeout: 5000 });

    // Verify tracks are harmonized (both have displayDistance)
    const tracksInfo = await page.evaluate(() => {
      const tracks = (window as any).tracks;
      if (!tracks || tracks.length < 2) return null;
      return {
        track1HasDisplayDist: tracks[0].every((p: any) => typeof p.displayDistance === 'number'),
        track2HasDisplayDist: tracks[1].every((p: any) => typeof p.displayDistance === 'number'),
        track1Length: tracks[0].length,
        track2Length: tracks[1].length
      };
    });

    expect(tracksInfo).not.toBeNull();
    expect(tracksInfo!.track1HasDisplayDist).toBe(true);
    expect(tracksInfo!.track2HasDisplayDist).toBe(true);
    expect(tracksInfo!.track1Length).toBeGreaterThan(0);
    expect(tracksInfo!.track2Length).toBeGreaterThan(0);
  });

  test('markers move correctly along harmonized tracks', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Load tracks
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-no-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-with-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    await page.waitForTimeout(500);

    // Select 'Overlapping' display mode
    await page.selectOption('#display-mode-select', 'overlapping');
    await page.waitForTimeout(300);

    // Verify both markers are visible
    await expect(page.locator(selectors.mapMarker)).toHaveCount(2, { timeout: 5000 });

    // Move the time slider and verify markers update
    const slider = page.locator(selectors.timeSlider);
    const sliderBounds = await page.evaluate(() => {
      const s = document.getElementById('time-slider') as HTMLInputElement;
      return { min: parseFloat(s.min), max: parseFloat(s.max) };
    });

    // Move slider to middle position
    const midValue = (sliderBounds.min + sliderBounds.max) / 2;
    await slider.fill(midValue.toString());
    await slider.dispatchEvent('input');
    await page.waitForTimeout(200);

    // Markers should still be visible after slider move
    await expect(page.locator(selectors.mapMarker)).toHaveCount(2);

    // Verify positions were updated (markers have location data)
    const markerPositions = await page.evaluate(() => {
      const markers = document.querySelectorAll('.my-div-icon');
      return Array.from(markers).map(m => {
        const transform = (m as HTMLElement).style.transform;
        return transform !== '';
      });
    });

    expect(markerPositions.length).toBe(2);
    expect(markerPositions.every(hasTransform => hasTransform)).toBe(true);
  });

  test('overlapping mode removes time gaps from non-matching segments', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Load no-loop track first (track[0]), then with-loop track (track[1])
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-no-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-with-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    await page.waitForTimeout(500);

    // Select 'Overlapping' display mode
    await page.selectOption('#display-mode-select', 'overlapping');
    await page.waitForTimeout(300);

    // Check that the looped track doesn't have a large time gap
    // The loop in the fixture takes ~70s. Without the fix, there's a 70s gap
    // between the two overlapping segments. With the fix, the gap is removed.
    const timeGapInfo = await page.evaluate(() => {
      const tracks = (window as any).tracks;
      if (!tracks || tracks.length < 2) return null;

      // Find the maximum time gap between consecutive points in each track
      const maxGap = (track: any[]) => {
        let max = 0;
        for (let i = 1; i < track.length; i++) {
          const gap = track[i].time - track[i - 1].time;
          if (gap > max) max = gap;
        }
        return max;
      };

      return {
        track1MaxGap: maxGap(tracks[0]),
        track2MaxGap: maxGap(tracks[1]),
        track1LastTime: tracks[0][tracks[0].length - 1].time,
        track2LastTime: tracks[1][tracks[1].length - 1].time,
      };
    });

    expect(timeGapInfo).not.toBeNull();

    // The fixture has 10s between consecutive points. After removing the
    // non-matching loop segment, the max gap should be ~10s, not ~70s.
    // Use 15s as threshold to allow some tolerance.
    expect(timeGapInfo!.track2MaxGap).toBeLessThan(15);

    // The looped track's final time should be close to the no-loop track's
    // final time (both cover similar matching distance at similar pace),
    // not inflated by 70s of loop time.
    const timeDiff = Math.abs(timeGapInfo!.track1LastTime - timeGapInfo!.track2LastTime);
    expect(timeDiff).toBeLessThan(30);
  });

  test('time-behind graph extends to slowest runner finish', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // hairpin-fast finishes in 80s (leader), hairpin-slow finishes in 240s (comp)
    await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-fast.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-slow.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    await page.waitForTimeout(500);

    // Verify all_match is true (same course, single overlapping segment)
    const allMatch = await page.evaluate(() => (window as any).all_match);
    expect(allMatch).toBe(true);

    // Both elevation + diff graphs should be present
    await expect(page.locator('#graph svg')).toHaveCount(2, { timeout: 5000 });

    const info = await page.evaluate(() => {
      const tracks = (window as any).tracks;
      const leaderEnd = tracks[0][tracks[0].length - 1].time;
      const compEnd = tracks[1][tracks[1].length - 1].time;

      // Read x-axis tick labels from the diff graph SVG (second SVG)
      const diffSvg = document.querySelectorAll('#graph svg')[1];
      const tickValues = Array.from(diffSvg.querySelectorAll('text'))
        .map((el) => parseFloat((el as HTMLElement).textContent || ''))
        .filter((v) => !isNaN(v) && v > 0);
      const maxTick = tickValues.length ? Math.max(...tickValues) : 0;

      return { leaderEnd, compEnd, maxTick };
    });

    // Confirm fixture setup: slow runner finishes later than fast runner
    expect(info.compEnd).toBeGreaterThan(info.leaderEnd);

    // The diff graph x-axis must extend well past the leader's finish
    expect(info.maxTick).toBeGreaterThan(info.leaderEnd);
  });

  test('time-behind graph extends past comp finish when slow track uploaded first', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Upload slow runner first (becomes tracks[0] leader), fast runner second (becomes tracks[1] comp)
    await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-slow.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-fast.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    await page.waitForTimeout(500);

    const allMatch = await page.evaluate(() => (window as any).all_match);
    expect(allMatch).toBe(true);

    await expect(page.locator('#graph svg')).toHaveCount(2, { timeout: 5000 });

    const info = await page.evaluate(() => {
      const tracks = (window as any).tracks;
      const leaderEnd = tracks[0][tracks[0].length - 1].time;
      const compEnd = tracks[1][tracks[1].length - 1].time;
      return { leaderEnd, compEnd };
    });

    // Confirm fixture setup: fast comp finishes before slow leader
    expect(info.compEnd).toBeLessThan(info.leaderEnd);

    // Count L-segment commands in the diff graph's path element. Plot.line
    // with the default linear curve emits one L per data point (after the
    // opening M), so this count equals the number of loop iterations that
    // produced a valid diff value. Without the fix the loop stopped at
    // compEnd (~80 iterations → ~80 L commands); with the fix it runs to
    // leaderEnd (~240 iterations → ~240 L commands).
    const lineSegments = await page.evaluate(() => {
      const diffSvg = document.querySelectorAll('#graph svg')[1];
      let maxL = 0;
      diffSvg.querySelectorAll('path').forEach((p) => {
        const lCount = (p.getAttribute('d') || '').split('L').length - 1;
        maxL = Math.max(maxL, lCount);
      });
      return maxL;
    });
    expect(lineSegments).toBeGreaterThan(info.compEnd);
  });

  test('time-behind value at leader finish is non-flat (keeps growing)', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-fast.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-slow.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    await page.waitForTimeout(500);

    const allMatch = await page.evaluate(() => (window as any).all_match);
    expect(allMatch).toBe(true);

    // Compute time-behind at leader-finish and near the comp's finish using
    // the same follower-anchored formula as graphs.js.
    const values = await page.evaluate(() => {
      const tracks = (window as any).tracks;
      const leader = tracks[0];
      const comp = tracks[1];
      const leaderEnd = leader[leader.length - 1].time;
      const compEnd = comp[comp.length - 1].time;
      const leaderMaxDist = leader[leader.length - 1].displayDistance;

      function gvap(track: any[], posField: string, pos: number, valField: string): number {
        if (pos <= track[0][posField]) return track[0][valField];
        if (pos >= track[track.length - 1][posField]) return track[track.length - 1][valField];
        for (let i = 1; i < track.length; i++) {
          if (track[i][posField] >= pos) {
            const t0 = track[i - 1][posField], t1 = track[i][posField];
            const v0 = track[i - 1][valField], v1 = track[i][valField];
            return v0 + (pos - t0) / (t1 - t0) * (v1 - v0);
          }
        }
        return track[track.length - 1][valField];
      }

      function timeBehindAt(t: number): number | null {
        const d = gvap(comp, 'time', t, 'displayDistance');
        if (d > leaderMaxDist) return null;
        const tL = gvap(leader, 'displayDistance', d, 'time');
        return t - tL;
      }

      const atLeaderEnd = timeBehindAt(leaderEnd);
      // Sample partway through the comp's remaining run
      const atMidExtra = timeBehindAt(leaderEnd + (compEnd - leaderEnd) * 0.5);
      const atCompEnd = timeBehindAt(compEnd);

      return { leaderEnd, compEnd, atLeaderEnd, atMidExtra, atCompEnd };
    });

    // At the leader's finish, the slow runner is behind
    expect(values.atLeaderEnd).not.toBeNull();
    expect(values.atLeaderEnd!).toBeGreaterThan(0);

    // Time-behind continues growing past the leader's finish
    expect(values.atMidExtra).not.toBeNull();
    expect(values.atMidExtra!).toBeGreaterThan(values.atLeaderEnd!);

    // At comp's finish, time-behind equals the full gap between finishes
    expect(values.atCompEnd).not.toBeNull();
    const expectedFinalGap = values.compEnd - values.leaderEnd;
    expect(values.atCompEnd!).toBeCloseTo(expectedFinalGap, 0);
  });

  test('time-behind value is monotone past comp finish when slow track uploaded first', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Upload slow runner first (tracks[0] = slow leader, leaderEnd ≈ 240s), fast runner second (comp, compEnd ≈ 80s)
    await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-slow.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-fast.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    await page.waitForTimeout(500);

    const allMatch = await page.evaluate(() => (window as any).all_match);
    expect(allMatch).toBe(true);

    // Evaluate the new comp-anchored formula in the post-compEnd region
    const values = await page.evaluate(() => {
      const tracks = (window as any).tracks;
      const leader = tracks[0];
      const comp = tracks[1];
      const leaderEnd = leader[leader.length - 1].time;
      const compEnd = comp[comp.length - 1].time;

      function gvap(track: any[], posField: string, pos: number, valField: string): number {
        if (pos <= track[0][posField]) return track[0][valField];
        if (pos >= track[track.length - 1][posField]) return track[track.length - 1][valField];
        for (let i = 1; i < track.length; i++) {
          if (track[i][posField] >= pos) {
            const t0 = track[i - 1][posField], t1 = track[i][posField];
            const v0 = track[i - 1][valField], v1 = track[i][valField];
            return v0 + (pos - t0) / (t1 - t0) * (v1 - v0);
          }
        }
        return track[track.length - 1][valField];
      }

      // New comp-anchored formula for the post-compEnd region
      function timeBehindCompAnchored(t: number): number {
        const d_leader = gvap(leader, 'time', t, 'displayDistance');
        const tCompAtDLeader = gvap(comp, 'displayDistance', d_leader, 'time');
        return tCompAtDLeader - t;
      }

      const atCompEnd = timeBehindCompAnchored(compEnd);
      const atMid = timeBehindCompAnchored(compEnd + 0.5 * (leaderEnd - compEnd));
      const atLeaderEnd = timeBehindCompAnchored(leaderEnd);

      return { leaderEnd, compEnd, atCompEnd, atMid, atLeaderEnd };
    });

    // Comp finished first, so all values should be negative (comp is ahead)
    expect(values.atCompEnd).toBeLessThan(0);
    expect(values.atMid).toBeLessThan(0);
    expect(values.atLeaderEnd).toBeLessThan(0);

    // Magnitude grows monotonically toward leaderEnd
    expect(Math.abs(values.atMid)).toBeGreaterThanOrEqual(Math.abs(values.atCompEnd));
    expect(Math.abs(values.atLeaderEnd)).toBeGreaterThanOrEqual(Math.abs(values.atMid));

    // At leaderEnd, value converges to compEnd - leaderEnd
    const expectedFinalGap = values.compEnd - values.leaderEnd;
    expect(values.atLeaderEnd).toBeCloseTo(expectedFinalGap, 0);
  });

  test('distance-behind converges to zero at slowest finish (fast-first)', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Upload fast runner first (tracks[0] = fast leader, leaderEnd ≈ 80s), slow runner second (comp, compEnd ≈ 240s)
    await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-fast.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-slow.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    await page.waitForTimeout(500);

    const allMatch = await page.evaluate(() => (window as any).all_match);
    expect(allMatch).toBe(true);

    // Evaluate the leader-finished-first formula for the distance variant
    const values = await page.evaluate(() => {
      const tracks = (window as any).tracks;
      const leader = tracks[0];
      const comp = tracks[1];
      const leaderEnd = leader[leader.length - 1].time;
      const compEnd = comp[comp.length - 1].time;
      const courseEnd = Math.max(
        leader[leader.length - 1].displayDistance,
        comp[comp.length - 1].displayDistance
      );

      function gvap(track: any[], posField: string, pos: number, valField: string): number {
        if (pos <= track[0][posField]) return track[0][valField];
        if (pos >= track[track.length - 1][posField]) return track[track.length - 1][valField];
        for (let i = 1; i < track.length; i++) {
          if (track[i][posField] >= pos) {
            const t0 = track[i - 1][posField], t1 = track[i][posField];
            const v0 = track[i - 1][valField], v1 = track[i][valField];
            return v0 + (pos - t0) / (t1 - t0) * (v1 - v0);
          }
        }
        return track[track.length - 1][valField];
      }

      // Leader-finished-first formula: comp's remaining distance to finish (positive = comp behind)
      function distBehindLeaderFirst(t: number): number {
        const compDist = gvap(comp, 'time', t, 'displayDistance');
        return courseEnd - compDist;
      }

      const mid = leaderEnd + 0.5 * (compEnd - leaderEnd);
      const atLeaderEnd = distBehindLeaderFirst(leaderEnd);
      const atMid = distBehindLeaderFirst(mid);
      const atCompEnd = distBehindLeaderFirst(compEnd);

      return { leaderEnd, compEnd, courseEnd, atLeaderEnd, atMid, atCompEnd };
    });

    // Leader finished first; comp still running → positive remaining distance
    expect(values.atLeaderEnd).toBeGreaterThan(0);
    expect(values.atMid).toBeGreaterThan(0);

    // Converges to ~0 at comp's finish (within 10 meters)
    expect(Math.abs(values.atCompEnd)).toBeLessThan(10);

    // Remaining distance decreases monotonically toward comp's finish
    expect(values.atLeaderEnd).toBeGreaterThanOrEqual(values.atMid);
    expect(values.atMid).toBeGreaterThanOrEqual(values.atCompEnd);
  });

  test('distance-behind converges to zero at slowest finish (slow-first)', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Upload slow runner first (tracks[0] = slow leader, leaderEnd ≈ 240s), fast runner second (comp, compEnd ≈ 80s)
    await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-slow.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-fast.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    await page.waitForTimeout(500);

    const allMatch = await page.evaluate(() => (window as any).all_match);
    expect(allMatch).toBe(true);

    // Evaluate the comp-finished-first formula for the distance variant
    const values = await page.evaluate(() => {
      const tracks = (window as any).tracks;
      const leader = tracks[0];
      const comp = tracks[1];
      const leaderEnd = leader[leader.length - 1].time;
      const compEnd = comp[comp.length - 1].time;
      const courseEnd = Math.max(
        leader[leader.length - 1].displayDistance,
        comp[comp.length - 1].displayDistance
      );

      function gvap(track: any[], posField: string, pos: number, valField: string): number {
        if (pos <= track[0][posField]) return track[0][valField];
        if (pos >= track[track.length - 1][posField]) return track[track.length - 1][valField];
        for (let i = 1; i < track.length; i++) {
          if (track[i][posField] >= pos) {
            const t0 = track[i - 1][posField], t1 = track[i][posField];
            const v0 = track[i - 1][valField], v1 = track[i][valField];
            return v0 + (pos - t0) / (t1 - t0) * (v1 - v0);
          }
        }
        return track[track.length - 1][valField];
      }

      // Comp-finished-first formula: leader's remaining distance to finish (negative = leader behind comp)
      function distBehindCompFirst(t: number): number {
        const leaderDist = gvap(leader, 'time', t, 'displayDistance');
        return leaderDist - courseEnd;
      }

      const mid = compEnd + 0.5 * (leaderEnd - compEnd);
      const atCompEnd = distBehindCompFirst(compEnd);
      const atMid = distBehindCompFirst(mid);
      const atLeaderEnd = distBehindCompFirst(leaderEnd);

      return { leaderEnd, compEnd, courseEnd, atCompEnd, atMid, atLeaderEnd };
    });

    // Comp finished first; leader still running → negative (leader is behind)
    expect(values.atCompEnd).toBeLessThan(0);
    expect(values.atMid).toBeLessThan(0);

    // Converges to ~0 at leader's finish (within 10 meters)
    expect(Math.abs(values.atLeaderEnd)).toBeLessThan(10);

    // Magnitude decreases monotonically toward leader's finish
    expect(Math.abs(values.atCompEnd)).toBeGreaterThanOrEqual(Math.abs(values.atMid));
    expect(Math.abs(values.atMid)).toBeGreaterThanOrEqual(Math.abs(values.atLeaderEnd));
  });

  test('harmonized tracks have continuous displayDistance across segments', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Load tracks
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-no-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-with-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    await page.waitForTimeout(500);

    // Select 'Overlapping' display mode
    await page.selectOption('#display-mode-select', 'overlapping');
    await page.waitForTimeout(300);

    // Verify displayDistance is monotonically increasing (continuous, no gaps)
    const distanceInfo = await page.evaluate(() => {
      const tracks = (window as any).tracks;
      if (!tracks || tracks.length < 2) return null;

      const checkMonotonic = (track: any[]) => {
        for (let i = 1; i < track.length; i++) {
          if (track[i].displayDistance < track[i - 1].displayDistance) {
            return false;
          }
        }
        return true;
      };

      return {
        track1Monotonic: checkMonotonic(tracks[0]),
        track2Monotonic: checkMonotonic(tracks[1]),
        track1StartDist: tracks[0][0].displayDistance,
        track1EndDist: tracks[0][tracks[0].length - 1].displayDistance,
        track2StartDist: tracks[1][0].displayDistance,
        track2EndDist: tracks[1][tracks[1].length - 1].displayDistance
      };
    });

    expect(distanceInfo).not.toBeNull();
    expect(distanceInfo!.track1Monotonic).toBe(true);
    expect(distanceInfo!.track2Monotonic).toBe(true);

    // Both tracks should start at 0 distance
    expect(distanceInfo!.track1StartDist).toBe(0);
    expect(distanceInfo!.track2StartDist).toBe(0);

    // Both tracks should end at similar harmonized distances
    const endDistDiff = Math.abs(distanceInfo!.track1EndDist - distanceInfo!.track2EndDist);
    const avgEndDist = (distanceInfo!.track1EndDist + distanceInfo!.track2EndDist) / 2;
    // Allow for small differences (< 5% of average)
    expect(endDistDiff / avgEndDist).toBeLessThan(0.05);
  });
});
