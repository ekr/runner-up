import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { setupApiMock } from './helpers/apiMock';
import { clearLocalStorageNow } from './helpers/localStorage';
import * as fs from 'fs';
import * as path from 'path';

const track1Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track1.gpx'), 'utf-8');
const track2Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track2.gpx'), 'utf-8');

test.describe('Track Labels', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
  });

  test('should show date as default legend text with tooltip', async ({ page }) => {
    const mock = await setupApiMock(page);
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    const legendText = page.locator('#legend-container #legend-text');
    // Should show the date by default
    await expect(legendText).toContainText('Mon Jan 15 2024');
    // Should have a title tooltip with the date
    await expect(legendText).toHaveAttribute('title', /Mon Jan 15 2024/);
  });

  test('should rename track via legend click', async ({ page }) => {
    const mock = await setupApiMock(page);
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    const legendText = page.locator('#legend-container #legend-text');

    // Click to edit
    await legendText.click();

    // An input should appear
    const input = page.locator('#legend-container input[type="text"]');
    await expect(input).toBeVisible();

    // Type a new name and press Enter
    await input.fill('Morning Run');
    await input.press('Enter');

    // Legend should now show the new name
    await expect(legendText).toHaveText('Morning Run (testuser)');
    // Tooltip should still show the date
    await expect(legendText).toHaveAttribute('title', /Mon Jan 15 2024/);
  });

  test('should rename track via legend pencil button', async ({ page }) => {
    const mock = await setupApiMock(page);
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    const pencil = page.locator('#legend-container .rename-button');
    await expect(pencil).toBeVisible();
    await pencil.click();

    const input = page.locator('#legend-container input[type="text"]');
    await expect(input).toBeVisible();
    // Pencil should be hidden during edit
    await expect(pencil).toBeHidden();

    await input.fill('Evening Run');
    await input.press('Enter');

    const legendText = page.locator('#legend-container #legend-text');
    await expect(legendText).toHaveText('Evening Run (testuser)');
    // Pencil should be visible again
    await expect(pencil).toBeVisible();
  });

  test('should clear label when renaming to empty string', async ({ page }) => {
    const mock = await setupApiMock(page);
    await mock.seedTracks([track1Data]);
    mock.setTrackLabel(track1Data, 'Old Name');
    await page.reload();

    // Load the labeled track from the dropdown
    const dropdown = page.locator(selectors.savedTracksDropdown);
    // The dropdown should show the custom label
    await expect(dropdown.locator('option').nth(1)).toHaveText('Old Name');

    await dropdown.selectOption({ index: 1 });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    const legendText = page.locator('#legend-container #legend-text');
    await expect(legendText).toHaveText('Old Name (testuser)');

    // Click to edit, clear the name, press Enter
    await legendText.click();
    const input = page.locator('#legend-container input[type="text"]');
    await input.fill('');
    await input.press('Enter');

    // Should revert to date display
    await expect(legendText).toContainText('Mon Jan 15 2024');
  });

  test('should cancel rename on Escape', async ({ page }) => {
    const mock = await setupApiMock(page);
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    const legendText = page.locator('#legend-container #legend-text');
    const originalText = await legendText.textContent();

    // Click to edit
    await legendText.click();
    const input = page.locator('#legend-container input[type="text"]');
    await input.fill('Should Not Save');
    await input.press('Escape');

    // Legend should be unchanged
    await expect(legendText).toHaveText(originalText!);
  });

  test('should show labeled track in saved tracks dropdown', async ({ page }) => {
    const mock = await setupApiMock(page);
    await mock.seedTracks([track1Data]);
    mock.setTrackLabel(track1Data, 'My Favorite Run');
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);
    const options = dropdown.locator('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(1)).toHaveText('My Favorite Run');
  });

  test('should rename track on settings page', async ({ page }) => {
    const mock = await setupApiMock(page);
    await mock.seedTracks([track1Data]);
    await page.goto('/settings.html');
    await page.reload();

    // Track list should show the date
    const trackItem = page.locator(selectors.trackItem).first();
    await expect(trackItem).toBeVisible();
    const nameSpan = trackItem.locator('.track-item-date');
    await expect(nameSpan).toContainText('Jan 15, 2024');

    // Click rename button
    const renameBtn = trackItem.locator('.rename-button');
    await renameBtn.click();

    // Input should appear
    const input = trackItem.locator('.track-rename-input');
    await expect(input).toBeVisible();

    // Type and confirm
    await input.fill('Hill Repeats');
    await input.press('Enter');

    // Name should be updated
    await expect(nameSpan).toHaveText('Hill Repeats');

    // Details should now include the date since track has a custom label
    const details = trackItem.locator('.track-item-details');
    await expect(details).toContainText('Jan 15, 2024');
  });
});
