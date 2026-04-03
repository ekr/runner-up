import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { setupApiMock } from './helpers/apiMock';
import { clearLocalStorageNow } from './helpers/localStorage';
import * as fs from 'fs';
import * as path from 'path';

const track1Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track1.gpx'), 'utf-8');

test.describe('Hash Change Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
  });

  test('should load track when hash changes without page reload', async ({ page }) => {
    const mock = await setupApiMock(page);
    await mock.seedTracks([track1Data]);
    const trackId = mock.getTrackId(track1Data);
    await page.reload();

    // No tracks should be displayed initially.
    await expect(page.locator(selectors.legendEntry)).toHaveCount(0);

    // Change the hash without reloading the page.
    await page.evaluate((id) => {
      window.location.hash = id;
    }, trackId);

    // Track should appear in the legend.
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
  });
});
