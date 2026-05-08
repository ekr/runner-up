import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow } from './helpers/localStorage';
import { setupApiMock } from './helpers/apiMock';
import { fixturesDir, FIVE_FIXTURE_NAMES } from './helpers/fixtures';
import * as path from 'path';

test.describe('GPX Upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await setupApiMock(page);
    await page.reload();
  });

  test('should upload a GPX file and display track on map', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);
    const fixturesPath = path.join(__dirname, 'fixtures', 'sample-track.gpx');

    await fileInput.setInputFiles(fixturesPath);

    // Wait for track to be processed and displayed
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    // Check legend shows the track date and time (without 'Date:' prefix)
    await expect(page.locator(selectors.legendContainer)).toContainText('Jan 1, 2024');
  });

  test('should display track markers after upload', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));

    // Wait for map polyline and marker
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator(selectors.legendContainer)).toContainText('Jan 15, 2024');
    await expect(page.locator(selectors.mapMarker)).toHaveCount(1);
  });

  test('selects multiple files at once', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles([
      path.join(fixturesDir, 'track1.gpx'),
      path.join(fixturesDir, 'track2.gpx'),
    ]);

    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });
  });

  test('truncates to MAX_TRACKS and shows overflow warning', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Pre-load 4 tracks in one shot, leaving only 1 slot remaining.
    await fileInput.setInputFiles(FIVE_FIXTURE_NAMES.slice(0, 4).map(
      (n) => path.join(fixturesDir, n)
    ));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(4, { timeout: 10000 });

    // Now select 3 files — only 1 should load.
    await fileInput.setInputFiles([
      path.join(fixturesDir, 'track1.gpx'),
      path.join(fixturesDir, 'track2.gpx'),
      path.join(fixturesDir, 'out-and-back-short.gpx'),
    ]);

    await expect(page.locator(selectors.legendEntry)).toHaveCount(5, { timeout: 5000 });
    await expect(page.locator('#track-file-error')).toContainText('track limit is 5');
  });

  test('loads valid file and reports error for invalid file in same batch', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles([
      path.join(fixturesDir, 'track1.gpx'),
      path.join(fixturesDir, 'broken.gpx'),
    ]);

    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('#track-file-error')).toContainText('Failed to parse: broken.gpx');
    expect(errors.some((e) => e.includes('broken.gpx'))).toBe(true);
  });
});
