import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { setupApiMock } from './helpers/apiMock';
import { clearLocalStorageNow } from './helpers/localStorage';
import * as path from 'path';
import { fixturesDir, FIVE_FIXTURE_NAMES } from './helpers/fixtures';

const FIVE_FIXTURES = FIVE_FIXTURE_NAMES;

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

    test('should hide saved-tracks method group when logged out', async ({ page }) => {
      await expect(page.locator('.js-needs-login')).toBeHidden();
    });

    test('should show logged-out banner when not logged in', async ({ page }) => {
      await expect(page.locator(selectors.loggedOutBanner)).toBeVisible();
      await expect(page.locator(selectors.authLoginForm)).toBeVisible();
      await expect(page.locator(selectors.authStatus)).toBeHidden();
    });

    test('should upload a track and still show add-track for second track', async ({ page }) => {
      const fileInput = page.locator(selectors.fileInput);
      await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
      await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

      // Add-track should still be visible (can add more tracks up to MAX_TRACKS=5)
      await expect(page.locator(selectors.addTrackContainer)).toBeVisible();
    });

    test('should still show add-track after uploading two tracks (max is 5)', async ({ page }) => {
      const fileInput = page.locator(selectors.fileInput);

      await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
      await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

      await fileInput.setInputFiles([]);
      await fileInput.setInputFiles(path.join(fixturesDir, 'track2.gpx'));
      await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

      // Add-track should remain visible — max is 5, not 2.
      await expect(page.locator(selectors.addTrackContainer)).toBeVisible();
    });

    test('should hide add-track after uploading five tracks (MAX_TRACKS)', async ({ page }) => {
      const fileInput = page.locator(selectors.fileInput);

      for (let i = 0; i < FIVE_FIXTURES.length; i++) {
        await fileInput.setInputFiles([]);
        await fileInput.setInputFiles(path.join(fixturesDir, FIVE_FIXTURES[i]));
        await expect(page.locator(selectors.legendEntry)).toHaveCount(i + 1, { timeout: 10000 });
      }

      // After 5 tracks, add-track should be hidden.
      await expect(page.locator(selectors.addTrackContainer)).toBeHidden();
    });

    test('should show add-track again after removing a track from five', async ({ page }) => {
      const fileInput = page.locator(selectors.fileInput);

      for (let i = 0; i < FIVE_FIXTURES.length; i++) {
        await fileInput.setInputFiles([]);
        await fileInput.setInputFiles(path.join(fixturesDir, FIVE_FIXTURES[i]));
        await expect(page.locator(selectors.legendEntry)).toHaveCount(i + 1, { timeout: 10000 });
      }
      await expect(page.locator(selectors.addTrackContainer)).toBeHidden();

      // Remove one track
      await page.locator(selectors.deleteButton).first().click();
      await expect(page.locator(selectors.legendEntry)).toHaveCount(4);

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

    test('should still show add-track after uploading two tracks (max is 5)', async ({ page }) => {
      const fileInput = page.locator(selectors.fileInput);

      await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
      await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

      await fileInput.setInputFiles([]);
      await fileInput.setInputFiles(path.join(fixturesDir, 'track2.gpx'));
      await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

      // Add-track should remain visible — max is 5, not 2.
      await expect(page.locator(selectors.addTrackContainer)).toBeVisible();
    });

    test('should show all three method groups on the same row when expanded', async ({ page }) => {
      const groups = page.locator('.add-track-content .method-group');
      await expect(groups).toHaveCount(3);

      const tops = await groups.evaluateAll(els =>
        els.map(el => el.getBoundingClientRect().top)
      );
      // All three groups should share the same top edge (same row).
      expect(tops[1]).toBeCloseTo(tops[0], 0);
      expect(tops[2]).toBeCloseTo(tops[0], 0);
    });
  });

  test.describe('layout', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await clearLocalStorageNow(page);
      await page.reload();
    });

    test('should be positioned above the map', async ({ page }) => {
      const addTrackBottom = await page.locator(selectors.addTrackContainer).evaluate(
        el => el.getBoundingClientRect().bottom
      );
      const mapTop = await page.locator(selectors.mapContainer).evaluate(
        el => el.getBoundingClientRect().top
      );
      expect(addTrackBottom).toBeLessThanOrEqual(mapTop);
    });
  });
});
