import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { setupApiMock } from './helpers/apiMock';
import { clearLocalStorageNow } from './helpers/localStorage';
import * as fs from 'fs';
import * as path from 'path';

const track1Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track1.gpx'), 'utf-8');

test.describe('Download GPX', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
  });

  test('should show download button for uploaded track', async ({ page }) => {
    const mock = await setupApiMock(page);
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    const downloadButton = page.locator('.download-button');
    await expect(downloadButton).toHaveCount(1);
    await expect(downloadButton).toBeVisible();
  });

  test('should show download button for track loaded from dropdown', async ({ page }) => {
    const mock = await setupApiMock(page);
    await mock.seedTracks([track1Data]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);
    await dropdown.selectOption({ index: 1 });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    const downloadButton = page.locator('.download-button');
    await expect(downloadButton).toHaveCount(1);
    await expect(downloadButton).toBeVisible();
  });

  test('should download GPX file with correct content', async ({ page }) => {
    const mock = await setupApiMock(page);
    await page.reload();

    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('.download-button').click();
    const download = await downloadPromise;

    // Verify filename ends with .gpx
    expect(download.suggestedFilename()).toMatch(/\.gpx$/);

    // Verify downloaded content matches the original GPX
    const downloadPath = await download.path();
    const downloadedContent = fs.readFileSync(downloadPath!, 'utf-8');
    expect(downloadedContent).toBe(track1Data);
  });

  test('should show download button for each track when two are loaded', async ({ page }) => {
    const mock = await setupApiMock(page);
    const track2Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track2.gpx'), 'utf-8');

    await mock.seedTracks([track1Data, track2Data]);
    await page.reload();

    const dropdown = page.locator(selectors.savedTracksDropdown);
    await dropdown.selectOption({ index: 1 });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    await dropdown.selectOption({ index: 1 });
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    const downloadButtons = page.locator('.download-button');
    await expect(downloadButtons).toHaveCount(2);
    await expect(downloadButtons.first()).toBeVisible();
    await expect(downloadButtons.nth(1)).toBeVisible();
  });
});
