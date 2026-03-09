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
