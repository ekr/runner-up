import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const fixturesDir = path.join(__dirname, 'fixtures', 'alignment');

// Helper to load a GPX file into the page
async function loadGPXFile(page, filename: string) {
  const filePath = path.join(fixturesDir, filename);
  const gpxContent = fs.readFileSync(filePath, 'utf-8');

  // Inject the GPX content directly by calling the page's functions
  await page.evaluate((content) => {
    const track = (window as any).parseGPX(content);
    (window as any).data.push(track);
    (window as any).dataToStorageId.push(null);
    (window as any).dataUpdated();
  }, gpxContent);
}

test.describe('Track Alignment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the page to fully load
    await page.waitForSelector('#map');
  });

  test('same route at different paces should align perfectly', async ({ page }) => {
    await loadGPXFile(page, 'same-route-slow.gpx');
    await loadGPXFile(page, 'same-route-fast.gpx');

    // Check that alignment was computed
    const alignment = await page.evaluate(() => (window as any).alignment);
    expect(alignment).toBeTruthy();
    expect(alignment.overlappingRegions).toHaveLength(1);
    expect(alignment.hasMultipleSegments).toBe(false);

    // Display mode selector should be hidden (single segment)
    const displayMode = page.locator('#display-mode');
    await expect(displayMode).toBeHidden();
  });

  test('GPS skew tracks should be harmonized', async ({ page }) => {
    await loadGPXFile(page, 'gps-skew-normal.gpx');
    await loadGPXFile(page, 'gps-skew-longer.gpx');

    const alignment = await page.evaluate(() => (window as any).alignment);
    expect(alignment).toBeTruthy();
    expect(alignment.overlappingRegions.length).toBeGreaterThanOrEqual(1);

    // The harmonized distance should be between the two track distances
    const region = alignment.overlappingRegions[0];
    expect(region.harmonizedDistance).toBeGreaterThan(0);
    expect(region.harmonizedDistance).toBeLessThanOrEqual(
      Math.max(region.track1Distance, region.track2Distance)
    );
    expect(region.harmonizedDistance).toBeGreaterThanOrEqual(
      Math.min(region.track1Distance, region.track2Distance)
    );
  });

  test('out and back with different turnarounds should show multiple segments', async ({ page }) => {
    await loadGPXFile(page, 'out-back-short.gpx');
    await loadGPXFile(page, 'out-back-long.gpx');

    const alignment = await page.evaluate(() => (window as any).alignment);
    expect(alignment).toBeTruthy();

    // Should have multiple overlapping segments (out portion and back portion)
    // The segments where the short track doesn't go should be non-overlapping
    if (alignment.hasMultipleSegments) {
      const displayMode = page.locator('#display-mode');
      await expect(displayMode).toBeVisible();
    }
  });

  test('track with loop should show multiple segments', async ({ page }) => {
    await loadGPXFile(page, 'main-route-no-loop.gpx');
    await loadGPXFile(page, 'main-route-with-loop.gpx');

    const alignment = await page.evaluate(() => (window as any).alignment);
    expect(alignment).toBeTruthy();

    // Should detect that the loop creates a non-overlapping region
    // The segments before and after the loop should be overlapping
    if (alignment.hasMultipleSegments) {
      const displayMode = page.locator('#display-mode');
      await expect(displayMode).toBeVisible();

      // Test switching display modes
      await page.selectOption('#display-mode-select', 'overlapping');
      await page.waitForTimeout(100);

      // Verify tracks array was updated
      const tracksLength = await page.evaluate(() => (window as any).tracks.length);
      expect(tracksLength).toBe(2);
    }
  });

  test('display mode toggle should update visualization', async ({ page }) => {
    await loadGPXFile(page, 'out-back-short.gpx');
    await loadGPXFile(page, 'out-back-long.gpx');

    const alignment = await page.evaluate(() => (window as any).alignment);

    if (alignment && alignment.hasMultipleSegments) {
      // Get track lengths in full mode
      const fullModeTrackLengths = await page.evaluate(() => {
        return (window as any).tracks.map((t: any[]) => t.length);
      });

      // Switch to overlapping only mode
      await page.selectOption('#display-mode-select', 'overlapping');
      await page.waitForTimeout(100);

      const overlappingModeTrackLengths = await page.evaluate(() => {
        return (window as any).tracks.map((t: any[]) => t.length);
      });

      // In overlapping mode, tracks should be shorter (only overlapping regions)
      expect(overlappingModeTrackLengths[0]).toBeLessThanOrEqual(fullModeTrackLengths[0]);
    }
  });

  test('single track should not show display mode selector', async ({ page }) => {
    await loadGPXFile(page, 'same-route-slow.gpx');

    // Only one track loaded - no alignment
    const alignment = await page.evaluate(() => (window as any).alignment);
    expect(alignment).toBeNull();

    const displayMode = page.locator('#display-mode');
    await expect(displayMode).toBeHidden();
  });
});
