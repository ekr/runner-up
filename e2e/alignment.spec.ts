import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow } from './helpers/localStorage';
import * as path from 'path';

// Use the existing fixtures that are known to work
const fixturesDir = path.join(__dirname, 'fixtures');

test.describe('Track Alignment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await page.reload();
  });

  test('loads two tracks and displays them on map', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Load first track
    await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Load second track
    await fileInput.setInputFiles(path.join(fixturesDir, 'track2.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });
  });

  test('single track does not show display mode selector', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Display mode selector should be hidden with single track
    const displayMode = page.locator('#display-mode');
    await expect(displayMode).toBeHidden();
  });

  test('two tracks show alignment visualization', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Load two tracks
    await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'track2.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    // Both tracks should show markers on the map
    await expect(page.locator(selectors.mapMarker)).toHaveCount(2, { timeout: 5000 });
  });
});

test.describe('Out-and-Back with Different Turnaround Points', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await page.reload();
  });

  test('identifies overlapping regions when one track is longer', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Load the short out-and-back track
    await fileInput.setInputFiles(path.join(fixturesDir, 'out-and-back-short.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // Load the longer out-and-back track
    await fileInput.setInputFiles(path.join(fixturesDir, 'out-and-back-long.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    // Wait for alignment
    await page.waitForTimeout(500);

    // Get the alignment result
    const alignment = await page.evaluate(() => {
      return (window as any).alignment;
    });

    // Verify alignment was computed
    expect(alignment).not.toBeNull();
    expect(alignment.overlappingRegions).toBeDefined();

    // The out and back portions that overlap should be detected
    // Even though one track goes further, the common portions should align
    expect(alignment.overlappingRegions.length).toBeGreaterThanOrEqual(1);

    // Both markers should be visible
    await expect(page.locator(selectors.mapMarker)).toHaveCount(2, { timeout: 5000 });
  });
});

test.describe('Track with Extra Loop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await page.reload();
  });

  test('handles tracks where one has an extra loop the other does not', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Load the main route without the loop
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-no-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // Load the main route with the extra loop
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-with-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    // Wait for alignment
    await page.waitForTimeout(500);

    // Get the alignment result
    const alignment = await page.evaluate(() => {
      return (window as any).alignment;
    });

    // Verify alignment was computed
    expect(alignment).not.toBeNull();
    expect(alignment.overlappingRegions).toBeDefined();

    // Should detect the overlapping portions (before and after the loop)
    // The loop creates a non-overlapping section
    expect(alignment.overlappingRegions.length).toBeGreaterThanOrEqual(1);

    // DTW alignment path should exist
    expect(alignment.alignment).toBeDefined();
    expect(alignment.alignment.length).toBeGreaterThan(0);

    // Both markers should be visible
    await expect(page.locator(selectors.mapMarker)).toHaveCount(2, { timeout: 5000 });
  });
});

test.describe('Hairpin Out-and-Back at Different Paces', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await page.reload();
  });

  test('aligns hairpin out-and-back tracks at different paces', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Load the fast-pace hairpin track
    await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-fast.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // Load the slow-pace hairpin track
    await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-slow.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    // Wait for alignment
    await page.waitForTimeout(500);

    // Get the alignment result
    const alignment = await page.evaluate(() => {
      return (window as any).alignment;
    });

    // Verify alignment was computed
    expect(alignment).not.toBeNull();
    expect(alignment.overlappingRegions).toBeDefined();

    // Hairpin out-and-back at different paces should produce overlapping regions
    // The same physical path covered at different speeds
    expect(alignment.overlappingRegions.length).toBeGreaterThanOrEqual(1);

    // DTW alignment should handle the different sampling rates from pace differences
    expect(alignment.alignment).toBeDefined();
    expect(alignment.alignment.length).toBeGreaterThan(0);

    // Both markers should be visible
    await expect(page.locator(selectors.mapMarker)).toHaveCount(2, { timeout: 5000 });
  });
});
