import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { setupApiMock } from './helpers/apiMock';
import { clearLocalStorageNow } from './helpers/localStorage';
import * as fs from 'fs';
import * as path from 'path';

const track1Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track1.gpx'), 'utf-8');
const track2Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track2.gpx'), 'utf-8');

// Minimal 1x1 PNG for seeding avatars.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('Avatar display on map and graph', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
  });

  test('uploaded track does not show avatar in map marker', async ({ page }) => {
    const mock = await setupApiMock(page);
    mock.seedAvatar(TINY_PNG, 'image/png');
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // Own uploaded track should not show avatar on the marker.
    await expect(page.locator(selectors.mapMarker)).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('.my-div-icon img')).toHaveCount(0);
  });

  test('shows plain dot on map marker when no avatar exists', async ({ page }) => {
    await setupApiMock(page);
    // No avatar seeded.
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // Should have a marker but no img inside it.
    await expect(page.locator(selectors.mapMarker)).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('.my-div-icon img')).toHaveCount(0);
  });

  test('uploaded track does not show avatar in legend', async ({ page }) => {
    const mock = await setupApiMock(page);
    mock.seedAvatar(TINY_PNG, 'image/png');
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // Own uploaded track should not show avatar in legend.
    await expect(page.locator('#legend-icon img')).toHaveCount(0);
  });

  test('shows colored square in legend when no avatar exists', async ({ page }) => {
    await setupApiMock(page);
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // Legend icon should NOT contain an img.
    await expect(page.locator('#legend-icon img')).toHaveCount(0);
    // But the icon element should exist with a background color.
    const bgColor = await page.locator('#legend-icon').evaluate(
      (el) => (el as HTMLElement).style.backgroundColor,
    );
    expect(bgColor).not.toBe('transparent');
    expect(bgColor).not.toBe('');
  });

  test('uploaded track does not show avatar in elevation graph', async ({ page }) => {
    const mock = await setupApiMock(page);
    mock.seedAvatar(TINY_PNG, 'image/png');
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // Own uploaded track should not show avatar in the elevation graph.
    await expect(page.locator('#graph svg image')).toHaveCount(0, { timeout: 5000 });
  });

  test("shows avatar via hash only for another user's track, not own", async ({ page }) => {
    const mock = await setupApiMock(page);
    // Seed track1 as owned by testuser (current user), track2 as owned by alice.
    await mock.seedTracks([track1Data], 'testuser');
    await mock.seedTracks([track2Data], 'alice');

    // Both users have avatars.
    mock.seedAvatar(TINY_PNG, 'image/png');
    mock.seedAvatarFor('alice', TINY_PNG, 'image/png');

    await page.reload();

    const id1 = mock.getTrackId(track1Data);
    const id2 = mock.getTrackId(track2Data);
    await page.evaluate((hash) => { window.location.hash = hash; }, `${id1}/${id2}`);

    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    // Only alice's track should show an avatar marker; testuser's own track should not.
    const markerImgs = page.locator('.my-div-icon img');
    await expect(markerImgs).toHaveCount(1, { timeout: 5000 });

    // Only alice's legend entry should have an avatar image.
    const legendImgs = page.locator('#legend-icon img');
    await expect(legendImgs).toHaveCount(1, { timeout: 5000 });
  });

  test('shows no avatar markers when neither track is from another user with an avatar', async ({ page }) => {
    const mock = await setupApiMock(page);
    await mock.seedTracks([track1Data], 'testuser');
    await mock.seedTracks([track2Data], 'alice');

    // Only testuser has an avatar; alice does not.
    mock.seedAvatar(TINY_PNG, 'image/png');

    await page.reload();

    const id1 = mock.getTrackId(track1Data);
    const id2 = mock.getTrackId(track2Data);
    await page.evaluate((hash) => { window.location.hash = hash; }, `${id1}/${id2}`);

    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    // testuser's own track: no avatar. alice's track: alice has no avatar. → 0 marker images.
    await expect(page.locator('.my-div-icon img')).toHaveCount(0, { timeout: 5000 });

    // Two markers total.
    await expect(page.locator(selectors.mapMarker)).toHaveCount(2);
  });
});
