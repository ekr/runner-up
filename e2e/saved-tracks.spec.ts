import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { setupApiMock } from './helpers/apiMock';
import { clearLocalStorageNow } from './helpers/localStorage';
import * as fs from 'fs';
import * as path from 'path';

const track1Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track1.gpx'), 'utf-8');
const track2Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track2.gpx'), 'utf-8');
// hairpin-fast starts ~55km away from track1/track2 (Sunnyvale vs SF)
const hairpinFastData = fs.readFileSync(path.join(__dirname, 'fixtures', 'hairpin-fast.gpx'), 'utf-8');

test.describe('Saved Tracks Dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
  });

  test('should save uploaded track to server with unique ID', async ({ page }) => {
    const mock = await setupApiMock(page);
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Check mock server has the track with an ID
    expect(mock.getTrackCount()).toBe(1);
    const stored = mock.getStoredTracks();
    expect(stored[0].id).toBeDefined();
    expect(stored[0].data).toContain('<gpx');
  });

  test('should populate dropdown with saved tracks', async ({ page }) => {
    const mock = await setupApiMock(page);
    await mock.seedTracks([track1Data, track2Data]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);
    const options = dropdown.locator('option');

    // Should have placeholder + 2 tracks = 3 options
    await expect(options).toHaveCount(3);
    // Dropdown text is now the start date+time of the GPX track
    await expect(options.nth(1)).toContainText('Mon Jan 15 2024');
    await expect(options.nth(2)).toContainText('Tue Jan 16 2024');
  });

  test('should load correct track when selected from dropdown', async ({ page }) => {
    const mock = await setupApiMock(page);
    await mock.seedTracks([track1Data]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);

    // Verify dropdown has correct label (now shows track date+time)
    await expect(dropdown.locator('option').nth(1)).toContainText('Mon Jan 15 2024');

    // Select by index since label now includes time (timezone-dependent)
    await dropdown.selectOption({ index: 1 });

    // Track should be displayed on map
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    // Verify it's the correct track by checking the date (track1 is Jan 15 2024)
    await expect(page.locator(selectors.legendContainer)).toContainText('Mon Jan 15 2024');
  });

  test('should remove loaded track from dropdown', async ({ page }) => {
    const mock = await setupApiMock(page);
    await mock.seedTracks([track1Data, track2Data]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);

    // Initially should have placeholder + 2 tracks
    await expect(dropdown.locator('option')).toHaveCount(3);

    // Load track1 (select by index since label includes timezone-dependent time)
    await dropdown.selectOption({ index: 1 });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Dropdown should now only have placeholder + track2 (track1 is being displayed)
    await expect(dropdown.locator('option')).toHaveCount(2);
    await expect(dropdown.locator('option').nth(1)).toContainText('Tue Jan 16 2024');
  });

  test('should remove track from display on delete click', async ({ page }) => {
    const mock = await setupApiMock(page);
    await mock.seedTracks([track1Data]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);
    await dropdown.selectOption({ index: 1 });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Track should not be in dropdown while displayed
    await expect(dropdown.locator('option')).toHaveCount(1);

    // Click delete button (normal click - removes from view only)
    const deleteButton = page.locator(selectors.deleteButton).first();
    await deleteButton.click();

    // Track should be removed from map
    await expect(page.locator(selectors.legendEntry)).toHaveCount(0);

    // Track should still be on the server
    expect(mock.getTrackCount()).toBe(1);

    // Track should reappear in dropdown
    await expect(dropdown.locator('option')).toHaveCount(2);
  });

  test('should delete track permanently on Shift+click', async ({ page }) => {
    const mock = await setupApiMock(page);
    await mock.seedTracks([track1Data]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);
    await dropdown.selectOption({ index: 1 });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Set up dialog handler for confirm dialog
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Shift+click delete button - permanently deletes
    const deleteButton = page.locator(selectors.deleteButton).first();
    await deleteButton.click({ modifiers: ['Shift'] });

    // Track should be removed from map
    await expect(page.locator(selectors.legendEntry)).toHaveCount(0);

    // Track should be removed from server
    expect(mock.getTrackCount()).toBe(0);

    // Track should not reappear in dropdown
    await expect(dropdown.locator('option')).toHaveCount(1); // Only placeholder
  });

  test('should persist tracks across page reload', async ({ page }) => {
    const mock = await setupApiMock(page);
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);

    // Upload a track
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Reload page
    await page.reload();

    // Map should be empty (no auto-load)
    await expect(page.locator(selectors.legendEntry)).toHaveCount(0);

    // Dropdown should have the track
    const dropdown = page.locator(selectors.savedTracksDropdown);
    await expect(dropdown.locator('option')).toHaveCount(2);

    // Can load track from dropdown (now shows date+time instead of filename)
    await dropdown.selectOption({ index: 1 });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
  });

  test('should not store bitwise duplicate tracks', async ({ page }) => {
    const mock = await setupApiMock(page);
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);

    // Upload track1
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Remove from display
    const deleteButton = page.locator(selectors.deleteButton).first();
    await deleteButton.click();
    await expect(page.locator(selectors.legendEntry)).toHaveCount(0);

    // Clear file input and upload the same file again
    await fileInput.setInputFiles([]);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Should only have one entry on server (not duplicated)
    expect(mock.getTrackCount()).toBe(1);
  });

  test('should sort saved tracks by proximity to displayed track', async ({ page }) => {
    const mock = await setupApiMock(page);
    // Seed with 3 tracks:
    // - track1: starts in SF (37.7749, -122.4194)
    // - track2: starts in SF (same location as track1)
    // - hairpin-fast: starts in Sunnyvale (~55km away)
    await mock.seedTracks([track1Data, track2Data, hairpinFastData]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);

    // Load track1 by its ID
    const track1Id = mock.getTrackId(track1Data);
    await dropdown.selectOption({ value: track1Id });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Now dropdown should have 2 remaining tracks, sorted by proximity:
    // 1. track2 (same start location - 0 km away)
    // 2. hairpin-fast (~55km away in Sunnyvale)
    const options = dropdown.locator('option');
    await expect(options).toHaveCount(3); // placeholder + 2 tracks

    // track2 (Jan 16) should appear before hairpin-fast (Jan 01) because it's closer
    await expect(options.nth(1)).toContainText('Tue Jan 16 2024'); // track2
    await expect(options.nth(2)).toContainText('Mon Jan 01 2024'); // hairpin-fast
  });
});
