import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { setupApiMock } from './helpers/apiMock';
import { clearLocalStorageNow } from './helpers/localStorage';
import * as fs from 'fs';
import * as path from 'path';

const track1Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track1.gpx'), 'utf-8');

test.describe('Hash Reload Labels', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
  });

  test('should restore custom label for owned track loaded via URL hash', async ({ page }) => {
    const mock = await setupApiMock(page);
    await mock.seedTracks([track1Data]);
    mock.setTrackLabel(track1Data, 'My Custom Run');
    const trackId = mock.getTrackId(track1Data);

    // Navigate to the page with the track hash so loadTracksFromHash fires.
    await page.evaluate((id) => { window.location.hash = id; }, trackId);
    await page.reload();

    // Track should load on the map.
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Legend should show the custom label, not the date.
    const legendText = page.locator('#legend-container #legend-text');
    await expect(legendText).toHaveText('My Custom Run');
  });

  test('should restore custom label for shared track loaded via URL hash', async ({ page }) => {
    const mock = await setupApiMock(page);
    const trackId = mock.getTrackId(track1Data);
    // Seed as a shared track with a custom label (label was previously assigned by the user).
    mock.seedSharedTracks([{
      trackId,
      sharedBy: 'alice',
      date: '2024-01-15T10:00:00Z',
      startLat: 37.7749,
      startLon: -122.4194,
      sizeBytes: 1000,
      label: 'Alice Morning Run',
    }]);
    // Seed track data (different owner) so GET /tracks/{id} works.
    await mock.seedTracks([track1Data], 'alice');

    // Navigate to the page with the track hash.
    await page.evaluate((id) => { window.location.hash = id; }, trackId);
    await page.reload();

    // Track should load on the map.
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Legend should show the custom label for the shared track.
    const legendText = page.locator('#legend-container #legend-text');
    await expect(legendText).toHaveText('Alice Morning Run (alice)');
  });

  test('should fall back to date when no custom label is set', async ({ page }) => {
    const mock = await setupApiMock(page);
    await mock.seedTracks([track1Data]);
    const trackId = mock.getTrackId(track1Data);

    // Navigate to the page with the track hash (no label set).
    await page.evaluate((id) => { window.location.hash = id; }, trackId);
    await page.reload();

    // Track should load on the map.
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Legend should show the date (default behavior).
    const legendText = page.locator('#legend-container #legend-text');
    await expect(legendText).toContainText('Mon Jan 15 2024');
  });
});
