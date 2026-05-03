import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow } from './helpers/localStorage';
import { setupApiMock } from './helpers/apiMock';
import * as fs from 'fs';
import * as path from 'path';

test.describe('GPX URL import', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await setupApiMock(page);
    await page.reload();
  });

  test('fetches a GPX from a URL and displays it', async ({ page }) => {
    const gpxText = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'sample-track.gpx'),
      'utf8'
    );
    const remoteUrl = 'https://example.invalid/tracks/sample.gpx';

    await page.route(remoteUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/gpx+xml',
        body: gpxText,
      })
    );

    await page.locator('#track-url').fill(remoteUrl);
    await page.locator('#track-url-btn').click();

    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator(selectors.legendContainer)).toContainText('Jan 1, 2024');

    // Input is cleared and no error is shown on success.
    await expect(page.locator('#track-url')).toHaveValue('');
    await expect(page.locator('#track-url-error')).toHaveText('');
  });

  test('shows an error when the URL returns a non-ok response', async ({ page }) => {
    const remoteUrl = 'https://example.invalid/missing.gpx';
    await page.route(remoteUrl, (route) => route.fulfill({ status: 404, body: 'nope' }));

    await page.locator('#track-url').fill(remoteUrl);
    await page.locator('#track-url-btn').click();

    await expect(page.locator('#track-url-error')).toContainText('404', { timeout: 5000 });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(0);
  });

  test('rejects an invalid URL without fetching', async ({ page }) => {
    await page.locator('#track-url').fill('not a url');
    await page.locator('#track-url-btn').click();

    await expect(page.locator('#track-url-error')).toHaveText('Invalid URL.');
  });
});
