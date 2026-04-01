import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { setupApiMock } from './helpers/apiMock';
import { clearLocalStorageNow } from './helpers/localStorage';
import * as path from 'path';

test.describe('Add-track visibility', () => {
  test.describe('logged out', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await clearLocalStorageNow(page);
      await page.reload();
    });

    test('should show add-track controls when logged out with no tracks', async ({ page }) => {
      await expect(page.locator(selectors.addTrackContainer)).toBeVisible();
      await expect(page.locator(selectors.fileLabel)).toBeVisible();
    });

    test('should hide saved-tracks dropdown when logged out', async ({ page }) => {
      await expect(page.locator(selectors.savedTracksDropdown)).toBeHidden();
    });

    test('should show logged-out banner when not logged in', async ({ page }) => {
      await expect(page.locator(selectors.loggedOutBanner)).toBeVisible();
      await expect(page.locator(selectors.authLoginForm)).toBeVisible();
      await expect(page.locator(selectors.authStatus)).toBeHidden();
    });

    test('should upload a track and still show add-track for second track', async ({ page }) => {
      const fileInput = page.locator(selectors.fileInput);
      await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
      await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

      // Add-track should still be visible (can add a second track)
      await expect(page.locator(selectors.addTrackContainer)).toBeVisible();
    });

    test('should hide add-track after uploading two tracks', async ({ page }) => {
      const fileInput = page.locator(selectors.fileInput);

      await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
      await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

      // Upload second track
      await fileInput.setInputFiles([]);
      await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track2.gpx'));
      await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

      // Add-track should be hidden (max 2 tracks)
      await expect(page.locator(selectors.addTrackContainer)).toBeHidden();
    });

    test('should show add-track again after removing a track', async ({ page }) => {
      const fileInput = page.locator(selectors.fileInput);

      await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
      await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

      await fileInput.setInputFiles([]);
      await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track2.gpx'));
      await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });
      await expect(page.locator(selectors.addTrackContainer)).toBeHidden();

      // Remove a track
      await page.locator(selectors.deleteButton).first().click();
      await expect(page.locator(selectors.legendEntry)).toHaveCount(1);

      // Add-track should reappear
      await expect(page.locator(selectors.addTrackContainer)).toBeVisible();
    });
  });

  test.describe('logged in', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await clearLocalStorageNow(page);
      await setupApiMock(page);
      await page.reload();
    });

    test('should show add-track controls when logged in with no tracks', async ({ page }) => {
      await expect(page.locator(selectors.addTrackContainer)).toBeVisible();
      await expect(page.locator(selectors.fileLabel)).toBeVisible();
      await expect(page.locator(selectors.savedTracksDropdown)).toBeVisible();
    });

    test('should hide logged-out banner and show auth status when logged in', async ({ page }) => {
      await expect(page.locator(selectors.loggedOutBanner)).toBeHidden();
      await expect(page.locator(selectors.authLoginForm)).toBeHidden();
      await expect(page.locator(selectors.authStatus)).toBeVisible();
    });

    test('should hide add-track after uploading two tracks', async ({ page }) => {
      const fileInput = page.locator(selectors.fileInput);

      await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
      await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

      await fileInput.setInputFiles([]);
      await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track2.gpx'));
      await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

      await expect(page.locator(selectors.addTrackContainer)).toBeHidden();
    });
  });
});
