import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow } from './helpers/localStorage';
import { setupApiMock } from './helpers/apiMock';
import * as path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');

test.describe('Mobile layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await setupApiMock(page);
    await page.reload();
  });

  test('no horizontal overflow and key elements visible after uploading two tracks', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    await fileInput.setInputFiles([]);
    await fileInput.setInputFiles(path.join(fixturesDir, 'track2.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    // No horizontal overflow
    const noOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1
    );
    expect(noOverflow).toBe(true);

    // Legend container is visible
    await expect(page.locator(selectors.legendContainer)).toBeVisible();

    // Map has non-zero height
    const mapHeight = await page.locator(selectors.mapContainer).evaluate((el) => el.clientHeight);
    expect(mapHeight).toBeGreaterThan(0);

    // Move the slider once
    await page.locator(selectors.timeSlider).fill('50');

    // No JS errors
    expect(errors).toHaveLength(0);
  });
});
