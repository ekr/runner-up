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

  test('should show comparison graph for partially overlapping tracks', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Load first track (shorter out-and-back)
    await fileInput.setInputFiles(path.join(fixturesDir, 'out-and-back-short.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // Load second track (longer out-and-back) - these tracks partially overlap
    await fileInput.setInputFiles(path.join(fixturesDir, 'out-and-back-long.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    // Wait for alignment and graph rendering
    await page.waitForTimeout(500);

    // Verify we have overlapping regions (partial overlap)
    const alignment = await page.evaluate(() => {
      return (window as any).alignment;
    });
    expect(alignment).not.toBeNull();
    expect(alignment.overlappingRegions.length).toBeGreaterThan(0);

    // Verify both graphs are displayed (elevation + comparison/difference)
    // The graph container should have 2 figure elements
    const graphFigures = page.locator('#graph figure');
    await expect(graphFigures).toHaveCount(2, { timeout: 5000 });
  });

  test('should show comparison graph for tracks with extra loop', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Load main route without loop
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-no-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // Load main route with extra loop - these tracks have multiple overlapping segments
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-with-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    // Wait for alignment and graph rendering
    await page.waitForTimeout(500);

    // Verify we have overlapping regions
    const alignment = await page.evaluate(() => {
      return (window as any).alignment;
    });
    expect(alignment).not.toBeNull();
    expect(alignment.overlappingRegions.length).toBeGreaterThan(0);

    // Verify both graphs are displayed (elevation + comparison/difference)
    const graphFigures = page.locator('#graph figure');
    await expect(graphFigures).toHaveCount(2, { timeout: 5000 });
  });
});
