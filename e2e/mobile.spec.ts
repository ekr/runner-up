import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow } from './helpers/localStorage';
import { setupApiMock } from './helpers/apiMock';
import * as path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');

test.describe('Mobile layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await setupApiMock(page);
    await page.reload();
  });

  test('no horizontal overflow and key elements visible after uploading two tracks', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const fileInput = page.locator(selectors.fileInput);

    await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    await fileInput.setInputFiles([]);
    await fileInput.setInputFiles(path.join(fixturesDir, 'track2.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 5000 });

    // No horizontal overflow
    const noOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1
    );
    expect(noOverflow).toBe(true);

    // Legend container is visible
    await expect(page.locator(selectors.legendContainer)).toBeVisible();

    // Map has non-zero height
    const mapHeight = await page.locator(selectors.mapContainer).evaluate((el) => el.clientHeight);
    expect(mapHeight).toBeGreaterThan(0);

    // Move the slider once
    await page.locator(selectors.timeSlider).fill('50');

    // No JS errors
    expect(errors).toHaveLength(0);
  });

  test('slider is pinned to the viewport bottom and stays there while scrolling', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(fixturesDir, 'track1.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 5000 });

    const sliderPosition = await page.locator('#slider-container').evaluate(
      (el) => getComputedStyle(el).position
    );
    expect(sliderPosition).toBe('fixed');

    const viewportHeight = await page.evaluate(() => window.innerHeight);
    const sliderBottom = await page.locator('#slider-container').evaluate(
      (el) => el.getBoundingClientRect().bottom
    );
    expect(Math.abs(sliderBottom - viewportHeight)).toBeLessThan(2);

    // Scroll to end: the slider should still be at the viewport bottom,
    // and the footer should be fully above it (not hidden behind).
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);

    const [sliderBottomEnd, footerBottom, sliderTop] = await page.evaluate(() => {
      const s = document.getElementById('slider-container')!.getBoundingClientRect();
      const f = document.getElementById('footer')!.getBoundingClientRect();
      return [s.bottom, f.bottom, s.top];
    });
    expect(Math.abs(sliderBottomEnd - viewportHeight)).toBeLessThan(2);
    expect(footerBottom).toBeLessThanOrEqual(sliderTop + 1);
  });
});
