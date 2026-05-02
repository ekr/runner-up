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

  test('legend hidden with no tracks', async ({ page }) => {
    await expect(page.locator('#legend-container')).toBeHidden();
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

  test('infobox shows leader in full-tracks mode with multi-segment alignment', async ({ page }) => {
    // main-route-with-loop and main-route-no-loop share portions of course but
    // the loop track has a detour, giving a multi-segment alignment. In full
    // mode the global `tracks` has raw GPS distances (different between the
    // two courses), so picking a leader from max displayDistance would be
    // nonsense. The infobox should use shared-course progress instead.
    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-with-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-no-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    const infobox = page.locator('#infobox-container');
    await expect(infobox).toBeVisible();
    await expect(infobox).toContainText('Leader');
    await expect(infobox).toContainText('Behind');

    // Sanity-check shared-course progress: both tracks' displayDistance on
    // the infobox tracks must be within the sum of the regions' harmonized
    // distances (i.e., bounded by total shared-course length), unlike the
    // raw-distance case where a track's detour can push it past that.
    const bounds = await page.evaluate(() => {
      const totalShared = window.alignment.overlappingRegions
        .reduce((s, r) => s + r.harmonizedDistance, 0);
      const maxProgress = Math.max(
        window.infoboxTracks[0][window.infoboxTracks[0].length - 1].displayDistance,
        window.infoboxTracks[1][window.infoboxTracks[1].length - 1].displayDistance
      );
      return { totalShared, maxProgress };
    });
    expect(bounds.maxProgress).toBeLessThanOrEqual(bounds.totalShared + 1);
  });

  test('infobox label and value have visible separation', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    await fileInput.setInputFiles(path.join(fixturesDir, 'track2.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    const infobox = page.locator('#infobox-container');
    await expect(infobox).toBeVisible({ timeout: 3000 });

    const result = await page.evaluate(() => {
      const row = document.querySelector('.infobox-row') as HTMLElement;
      if (!row) return { error: 'no .infobox-row found' };
      const label = row.querySelector('.infobox-label') as HTMLElement;
      const value = row.querySelector('.infobox-value') as HTMLElement;
      if (!label || !value) return { error: 'missing label or value' };
      const labelRect = label.getBoundingClientRect();
      const valueRect = value.getBoundingClientRect();
      const rowStyle = getComputedStyle(row);
      return {
        display: rowStyle.display,
        labelRight: labelRect.right,
        valueLeft: valueRect.left,
        separated: labelRect.right + 4 <= valueRect.left,
      };
    });

    expect(result).not.toHaveProperty('error');
    expect((result as any).display).toBe('flex');
    expect((result as any).separated).toBe(true);
  });

  test('infobox remains visible when toggling display mode', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-with-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-no-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    const infobox = page.locator('#infobox-container');
    await expect(infobox).toBeVisible();
    await expect(infobox).toContainText('Leader');

    await page.selectOption(selectors.displayModeSelect, 'overlapping');
    await expect(infobox).toBeVisible();
    await expect(infobox).toContainText('Leader');

    await page.selectOption(selectors.displayModeSelect, 'full');
    await expect(infobox).toBeVisible();
    await expect(infobox).toContainText('Leader');
  });
});
