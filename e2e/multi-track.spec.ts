import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { setupApiMock } from './helpers/apiMock';
import { clearLocalStorageNow } from './helpers/localStorage';
import * as fs from 'fs';
import * as path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');

// Five distinct fixture files (MAX_TRACKS = 5).
const FIVE_FIXTURES = [
  'track1.gpx',
  'track2.gpx',
  'out-and-back-short.gpx',
  'out-and-back-long.gpx',
  'main-route-no-loop.gpx',
];

test.describe('Multi-track (N > 2)', () => {
  let mockApi: Awaited<ReturnType<typeof setupApiMock>>;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    mockApi = await setupApiMock(page);
    await page.reload();
  });

  test('three tracks: 3 legend rows and 3 markers on map', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    await fileInput.setInputFiles([]);
    await fileInput.setInputFiles(path.join(fixturesDir, 'track2.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    await fileInput.setInputFiles([]);
    await fileInput.setInputFiles(path.join(fixturesDir, 'out-and-back-short.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(3, { timeout: 5000 });

    // Add-track should still be visible (max is 5, not 3)
    await expect(page.locator(selectors.addTrackContainer)).toBeVisible();

    // 3 markers on map
    await expect(page.locator(selectors.mapMarker)).toHaveCount(3, { timeout: 5000 });
  });

  test('add-track hidden at MAX_TRACKS (5), reappears after removing one', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    for (let i = 0; i < FIVE_FIXTURES.length; i++) {
      await fileInput.setInputFiles([]);
      await fileInput.setInputFiles(path.join(fixturesDir, FIVE_FIXTURES[i]));
      await expect(page.locator(selectors.legendEntry)).toHaveCount(i + 1, { timeout: 10000 });
    }

    // At 5 tracks, add-track should be hidden.
    await expect(page.locator(selectors.addTrackContainer)).toBeHidden();

    // Remove one track.
    await page.locator(selectors.deleteButton).first().click();
    await expect(page.locator(selectors.legendEntry)).toHaveCount(4, { timeout: 5000 });

    // Add-track should reappear.
    await expect(page.locator(selectors.addTrackContainer)).toBeVisible();
  });

  test('loads 3 tracks from URL hash', async ({ page }) => {
    const track1Data = fs.readFileSync(path.join(fixturesDir, 'track1.gpx'), 'utf-8');
    const track2Data = fs.readFileSync(path.join(fixturesDir, 'track2.gpx'), 'utf-8');
    const track3Data = fs.readFileSync(path.join(fixturesDir, 'out-and-back-short.gpx'), 'utf-8');

    await mockApi.seedTracks([track1Data, track2Data, track3Data]);
    const id1 = mockApi.getTrackId(track1Data);
    const id2 = mockApi.getTrackId(track2Data);
    const id3 = mockApi.getTrackId(track3Data);

    // Navigate directly to a URL with a 3-track hash.
    await page.goto(`/#${id1}/${id2}/${id3}`);

    await expect(page.locator(selectors.legendEntry)).toHaveCount(3, { timeout: 10000 });
    await expect(page.locator(selectors.mapMarker)).toHaveCount(3, { timeout: 5000 });
  });

  test('hash with more than MAX_TRACKS IDs truncates to 5', async ({ page }) => {
    // Seed 6 tracks; the app should only load the first 5.
    const trackDatas = FIVE_FIXTURES.map(f =>
      fs.readFileSync(path.join(fixturesDir, f), 'utf-8')
    );
    const extraData = fs.readFileSync(path.join(fixturesDir, 'main-route-with-loop.gpx'), 'utf-8');
    await mockApi.seedTracks([...trackDatas, extraData]);

    const ids = trackDatas.map(d => mockApi.getTrackId(d));
    const extraId = mockApi.getTrackId(extraData);
    const hash = [...ids, extraId].join('/');

    await page.goto(`/#${hash}`);

    // Only the first 5 should load.
    await expect(page.locator(selectors.legendEntry)).toHaveCount(5, { timeout: 10000 });
  });
});
