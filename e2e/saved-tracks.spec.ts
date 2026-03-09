import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow, seedLocalStorageNow, getStoredTracks } from './helpers/localStorage';
import * as fs from 'fs';
import * as path from 'path';

const track1Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track1.gpx'), 'utf-8');
const track2Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track2.gpx'), 'utf-8');

test.describe('Saved Tracks Dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await page.reload();
  });

  test('should save uploaded track to localStorage with unique ID', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Check localStorage has the track with an ID
    const stored = await getStoredTracks(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('track1.gpx');
    expect(stored[0].id).toBeDefined();
    expect(stored[0].data).toContain('<gpx');
  });

  test('should populate dropdown with saved tracks', async ({ page }) => {
    // Seed localStorage with tracks
    await seedLocalStorageNow(page, [
      { name: 'track1.gpx', data: track1Data },
      { name: 'track2.gpx', data: track2Data },
    ]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);
    const options = dropdown.locator('option');

    // Should have placeholder + 2 tracks = 3 options
    await expect(options).toHaveCount(3);
    await expect(options.nth(1)).toHaveText('track1.gpx');
    await expect(options.nth(2)).toHaveText('track2.gpx');
  });

  test('should load correct track when selected from dropdown', async ({ page }) => {
    await seedLocalStorageNow(page, [{ name: 'track1.gpx', data: track1Data }]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);

    // Verify dropdown has correct label
    await expect(dropdown.locator('option').nth(1)).toHaveText('track1.gpx');

    // Select by label text since value is now the content hash
    await dropdown.selectOption({ label: 'track1.gpx' });

    // Track should be displayed on map
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    // Verify it's the correct track by checking the date (track1 is Jan 15 2024)
    await expect(page.locator(selectors.legendContainer)).toContainText('Date: Mon Jan 15 2024');
  });

  test('should remove loaded track from dropdown', async ({ page }) => {
    await seedLocalStorageNow(page, [
      { name: 'track1.gpx', data: track1Data },
      { name: 'track2.gpx', data: track2Data },
    ]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);

    // Initially should have placeholder + 2 tracks
    await expect(dropdown.locator('option')).toHaveCount(3);

    // Load track1
    await dropdown.selectOption({ label: 'track1.gpx' });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Dropdown should now only have placeholder + track2 (track1 is being displayed)
    await expect(dropdown.locator('option')).toHaveCount(2);
    await expect(dropdown.locator('option').nth(1)).toHaveText('track2.gpx');
  });

  test('should remove track from display on delete click', async ({ page }) => {
    await seedLocalStorageNow(page, [{ name: 'track1.gpx', data: track1Data }]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);
    await dropdown.selectOption({ label: 'track1.gpx' });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Track should not be in dropdown while displayed
    await expect(dropdown.locator('option')).toHaveCount(1);

    // Click delete button (normal click - removes from view only)
    const deleteButton = page.locator(selectors.deleteButton).first();
    await deleteButton.click();

    // Track should be removed from map
    await expect(page.locator(selectors.legendEntry)).toHaveCount(0);

    // Track should still be in localStorage
    const stored = await getStoredTracks(page);
    expect(stored).toHaveLength(1);

    // Track should reappear in dropdown
    await expect(dropdown.locator('option')).toHaveCount(2);
  });

  test('should delete track permanently on Shift+click', async ({ page }) => {
    await seedLocalStorageNow(page, [{ name: 'track1.gpx', data: track1Data }]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);
    await dropdown.selectOption({ label: 'track1.gpx' });
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

    // Track should be removed from localStorage
    const stored = await getStoredTracks(page);
    expect(stored).toHaveLength(0);

    // Track should not reappear in dropdown
    await expect(dropdown.locator('option')).toHaveCount(1); // Only placeholder
  });

  test('should persist tracks across page reload', async ({ page }) => {
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

    // Can load track from dropdown
    await dropdown.selectOption({ label: 'track1.gpx' });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
  });

  test('should not store bitwise duplicate tracks', async ({ page }) => {
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

    // Should only have one entry in localStorage (not duplicated)
    const stored = await getStoredTracks(page);
    expect(stored).toHaveLength(1);
  });
});
