import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { setupApiMock } from './helpers/apiMock';
import { clearLocalStorageNow } from './helpers/localStorage';
import * as fs from 'fs';
import * as path from 'path';

const track1Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track1.gpx'), 'utf-8');
const track2Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track2.gpx'), 'utf-8');

test.describe('Shared Tracks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
  });

  test('should show shared tracks in dropdown labeled with sharer username', async ({ page }) => {
    const mock = await setupApiMock(page);
    await mock.seedTracks([track2Data]);
    mock.seedSharedTracks([{
      trackId: mock.getTrackId(track1Data),
      sharedBy: 'alice',
      date: '2024-01-15T10:00:00Z',
      startLat: 37.7749,
      startLon: -122.4194,
      sizeBytes: 1000,
    }]);
    // Seed track1 data so GET /tracks/{id} works.
    await mock.seedTracks([track1Data]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);
    const options = dropdown.locator('option');

    // Should have an option with "(alice)" suffix.
    await expect(options.filter({ hasText: '(alice)' })).toHaveCount(1);
    await expect(options.filter({ hasText: '(alice)' })).toContainText('Mon Jan 15 2024');
  });

  test('should load shared track when selected from dropdown', async ({ page }) => {
    const mock = await setupApiMock(page);
    // Only seed as shared (not owned).
    const trackId = mock.getTrackId(track1Data);
    mock.seedSharedTracks([{
      trackId,
      sharedBy: 'alice',
      date: '2024-01-15T10:00:00Z',
      startLat: 37.7749,
      startLon: -122.4194,
      sizeBytes: 1000,
    }]);
    // Seed track data so GET /tracks/{id} works.
    await mock.seedTracks([track1Data]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);

    // Find and select the shared track option.
    const sharedOption = dropdown.locator('option').filter({ hasText: '(alice)' });
    await expect(sharedOption).toHaveCount(1);
    await dropdown.selectOption({ value: trackId });

    // Track should be displayed on map.
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator(selectors.legendContainer)).toContainText('Mon Jan 15 2024');
  });

  test('should remove shared track from list on shift+click delete', async ({ page }) => {
    const mock = await setupApiMock(page);
    const trackId = mock.getTrackId(track1Data);
    mock.seedSharedTracks([{
      trackId,
      sharedBy: 'alice',
      date: '2024-01-15T10:00:00Z',
      startLat: 37.7749,
      startLon: -122.4194,
      sizeBytes: 1000,
    }]);
    await mock.seedTracks([track1Data]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);

    // Select the shared option specifically (has data-shared attribute).
    await page.evaluate(() => {
      const select = document.getElementById('saved-tracks') as HTMLSelectElement;
      for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].dataset.shared === 'true') {
          select.selectedIndex = i;
          select.dispatchEvent(new Event('change'));
          break;
        }
      }
    });

    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Set up dialog handler.
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Shift+click delete — should call removeSharedTrack, not deleteGPXFromStorage.
    const deleteButton = page.locator(selectors.deleteButton).first();
    await deleteButton.click({ modifiers: ['Shift'] });

    await expect(page.locator(selectors.legendEntry)).toHaveCount(0);

    // Track data should still exist on server.
    expect(mock.getTrackCount()).toBe(1);
    // Shared track entry should have been removed.
    expect(mock.getSharedTrackCount()).toBe(0);
  });

  test('should auto-save track to shared list when loaded via URL hash', async ({ page }) => {
    const mock = await setupApiMock(page);
    await mock.seedTracks([track1Data]);
    const trackId = mock.getTrackId(track1Data);

    // Set the hash and reload so the page loads with the track ID in the URL.
    await page.evaluate((id) => { window.location.hash = id; }, trackId);
    await page.reload();

    // Track should load on the map.
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // The shared track count should have increased (auto-saved via POST /shared-tracks).
    await page.waitForTimeout(500);
    expect(mock.getSharedTrackCount()).toBe(1);
  });
});
