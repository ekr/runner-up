import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow } from './helpers/localStorage';
import * as path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');

test.describe('Graphs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await page.reload();
  });

  test('should show compare-by menu', async ({ page }) => {
    await expect(page.locator(selectors.compareByMenu)).toBeVisible();
  });
});

test.describe('displayTime in non-overlapping segments', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
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

    // Check that graph figures are present (elevation graph at minimum)
    const figures = page.locator('#graph figure');
    await expect(figures).toHaveCount(1, { timeout: 5000 });

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

  test('time difference graph aligns correctly in overlapping mode', async ({ page }) => {
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

    // Set compare-by to 'time' to show time difference graph
    await page.selectOption('#compare-by-menu', 'time');
    await page.waitForTimeout(300);

    // Two graphs should now be visible: elevation and time difference
    const figures = page.locator('#graph figure');
    await expect(figures).toHaveCount(2, { timeout: 5000 });

    // Verify all_match is true (required for difference graph)
    const allMatch = await page.evaluate(() => {
      return (window as any).all_match;
    });
    expect(allMatch).toBe(true);
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
