import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow } from './helpers/localStorage';
import { setupApiMock } from './helpers/apiMock';
import * as path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');

test.describe('Leader Infobox', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await setupApiMock(page);
    await page.reload();
  });

  test('infobox hidden with no tracks', async ({ page }) => {
    await expect(page.locator('#infobox-container')).toBeHidden();
  });

  test('single track shows elapsed and distance, no follower rows', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    const infobox = page.locator('#infobox-container');
    await expect(infobox).toBeVisible({ timeout: 3000 });
    await expect(infobox).toContainText('Elapsed');
    await expect(infobox).toContainText('Distance');
    await expect(infobox).not.toContainText('Leader');
    await expect(infobox).not.toContainText('Behind');
  });

  test('two tracks show leader and behind rows', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    await fileInput.setInputFiles(path.join(fixturesDir, 'track2.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    const infobox = page.locator('#infobox-container');
    await expect(infobox).toBeVisible({ timeout: 3000 });
    await expect(infobox).toContainText('Elapsed');
    await expect(infobox).toContainText('Leader');
    await expect(infobox).toContainText('Behind');
  });

  test('infobox updates when slider moves', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    await fileInput.setInputFiles(path.join(fixturesDir, 'track2.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    const infobox = page.locator('#infobox-container');
    await expect(infobox).toBeVisible({ timeout: 3000 });

    // Move slider to 25%, 50%, 75% and verify infobox still shows expected labels.
    for (const fraction of [0.25, 0.5, 0.75]) {
      await page.evaluate((f) => {
        const slider = document.getElementById('time-slider') as HTMLInputElement;
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        slider.value = String(min + (max - min) * f);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }, fraction);

      await expect(infobox).toContainText('Elapsed');
      await expect(infobox).toContainText('Leader');
      await expect(infobox).toContainText('Behind');
    }
  });

  test('infobox hides when all tracks deleted', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    const infobox = page.locator('#infobox-container');
    await expect(infobox).toBeVisible({ timeout: 3000 });

    // Delete the track.
    await page.locator(selectors.deleteButton).first().click();
    await expect(page.locator(selectors.legendEntry)).toHaveCount(0, { timeout: 3000 });

    await expect(infobox).toBeHidden();
  });

  test('deleting one of two tracks switches to single-track layout', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    await fileInput.setInputFiles(path.join(fixturesDir, 'track2.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    const infobox = page.locator('#infobox-container');
    await expect(infobox).toContainText('Leader');

    // Delete one track.
    await page.locator(selectors.deleteButton).first().click();
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 3000 });

    await expect(infobox).toBeVisible();
    await expect(infobox).toContainText('Elapsed');
    await expect(infobox).not.toContainText('Leader');
    await expect(infobox).not.toContainText('Behind');
  });
});
