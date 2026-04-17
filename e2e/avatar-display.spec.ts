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

  test('does not show avatar on map marker for solo own track', async ({ page }) => {
    const mock = await setupApiMock(page);
    mock.seedAvatar(TINY_PNG, 'image/png');
    await page.reload();

    // Upload a track owned by the current user.
    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // No other user's track is present, so no avatar should appear.
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

  test('does not show avatar in legend for solo own track', async ({ page }) => {
    const mock = await setupApiMock(page);
    mock.seedAvatar(TINY_PNG, 'image/png');
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // No other user's track is present, so the legend icon should not contain an img.
    await expect(page.locator('#legend-icon img')).toHaveCount(0);
    // The icon element should still exist with a background color.
    const bgColor = await page.locator('#legend-icon').evaluate(
      (el) => (el as HTMLElement).style.backgroundColor,
    );
    expect(bgColor).not.toBe('transparent');
    expect(bgColor).not.toBe('');
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

  test('does not show avatar on elevation graph dot for solo own track', async ({ page }) => {
    const mock = await setupApiMock(page);
    mock.seedAvatar(TINY_PNG, 'image/png');
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // No other user's track is present, so no avatar image should appear in the graph.
    await expect(page.locator('#graph svg image')).toHaveCount(0, { timeout: 5000 });
  });

  test('shows avatars for both users on shared track via hash', async ({ page }) => {
    const mock = await setupApiMock(page);
    // Seed track1 as owned by testuser, track2 as owned by alice.
    await mock.seedTracks([track1Data], 'testuser');
    await mock.seedTracks([track2Data], 'alice');

    // Both users have avatars.
    mock.seedAvatar(TINY_PNG, 'image/png');
    mock.seedAvatarFor('alice', TINY_PNG, 'image/png');

    await page.reload();

    // Navigate to hash URL with both tracks.
    const id1 = mock.getTrackId(track1Data);
    const id2 = mock.getTrackId(track2Data);
    await page.evaluate((hash) => { window.location.hash = hash; }, `${id1}/${id2}`);

    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    // Both map markers should have avatar images.
    const markerImgs = page.locator('.my-div-icon img');
    await expect(markerImgs).toHaveCount(2, { timeout: 5000 });

    // Both legend entries should have avatar images.
    const legendImgs = page.locator('#legend-icon img');
    await expect(legendImgs).toHaveCount(2, { timeout: 5000 });
  });

  test('shows avatar for one user and plain dot for another', async ({ page }) => {
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

    // One marker should have an avatar, one should not.
    const markerImgs = page.locator('.my-div-icon img');
    await expect(markerImgs).toHaveCount(1, { timeout: 5000 });

    // Two markers total.
    await expect(page.locator(selectors.mapMarker)).toHaveCount(2);
  });

  test('shows avatars on all tracks (including own) when one shared track is present', async ({ page }) => {
    const mock = await setupApiMock(page);
    // testuser owns track1, alice owns track2.
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

    // Gate is on: both map markers and both legend entries should show avatars.
    await expect(page.locator('.my-div-icon img')).toHaveCount(2, { timeout: 5000 });
    await expect(page.locator('#legend-icon img')).toHaveCount(2, { timeout: 5000 });
  });

  test('does not show avatar when uploading own track after logging in', async ({ page }) => {
    const mock = await setupApiMock(page);
    mock.seedAvatar(TINY_PNG, 'image/png');
    await page.reload();

    // Upload own track via file input.
    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // Only own track visible — gate is off, no avatars should appear.
    await expect(page.locator('.my-div-icon img')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('#legend-icon img')).toHaveCount(0);
  });
});
