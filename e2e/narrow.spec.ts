import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow } from './helpers/localStorage';
import { setupApiMock } from './helpers/apiMock';
import * as path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');

async function loadTwoHairpinTracks(page: any) {
  const fileInput = page.locator(selectors.fileInput);
  await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-fast.gpx'));
  await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });
  await fileInput.setInputFiles(path.join(fixturesDir, 'hairpin-slow.gpx'));
  await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });
  await page.waitForTimeout(300);
}

async function brushOnElevationGraph(page: any, fracLo: number, fracHi: number) {
  const svg = page.locator('#graph svg').first();
  await expect(svg).toBeVisible({ timeout: 5000 });
  // Scroll the graph into the viewport so mouse events reach it.
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  if (!box) throw new Error('elevation graph SVG has no bounding box');
  const xLo = box.x + box.width * fracLo;
  const xHi = box.x + box.width * fracHi;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(xLo, y);
  await page.mouse.down();
  await page.mouse.move(xHi, y, { steps: 10 });
  await page.mouse.up();
  // Give the brush handler time to fire and displayTracks() to complete.
  await page.waitForTimeout(300);
}

test.describe('Narrow track view', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await setupApiMock(page);
    await page.reload();
  });

  test('brush narrows tracks and shows banner', async ({ page }) => {
    await loadTwoHairpinTracks(page);

    // Capture baseline slider max before narrowing.
    const originalMax = await page.evaluate(() => {
      const slider = document.getElementById('time-slider') as HTMLInputElement;
      return parseFloat(slider.max);
    });

    // Record full track lengths.
    const fullLengths = await page.evaluate(() => {
      return (window as any).fullTracks.map((t: any[]) => t.length);
    });

    // Brush the middle 30–70% of the elevation graph.
    await brushOnElevationGraph(page, 0.3, 0.7);

    // Banner should be visible with a distance range.
    await expect(page.locator('#narrow-banner')).toBeVisible();
    const rangeText = await page.locator('#narrow-range').textContent();
    expect(rangeText).toMatch(/[\d.]+–[\d.]+\s*(mi|km)/);

    // Narrowed tracks should be shorter than full tracks.
    const narrowedLengths = await page.evaluate(() => {
      return (window as any).tracks.map((t: any[]) => t.length);
    });
    for (let i = 0; i < fullLengths.length; i++) {
      expect(narrowedLengths[i]).toBeLessThan(fullLengths[i]);
    }

    // Slider max should now be smaller (window is mid-section of the run).
    const newMax = await page.evaluate(() => {
      const slider = document.getElementById('time-slider') as HTMLInputElement;
      return parseFloat(slider.max);
    });
    expect(newMax).toBeLessThan(originalMax);
  });

  test('widen button restores full tracks', async ({ page }) => {
    await loadTwoHairpinTracks(page);

    const fullLengths = await page.evaluate(() =>
      (window as any).fullTracks.map((t: any[]) => t.length)
    );

    await brushOnElevationGraph(page, 0.3, 0.7);
    await expect(page.locator('#narrow-banner')).toBeVisible();

    await page.locator('#widen-btn').click();
    await page.waitForTimeout(200);

    // Banner should be hidden after widening.
    await expect(page.locator('#narrow-banner')).toBeHidden();

    // Track lengths should be back to full.
    const restoredLengths = await page.evaluate(() =>
      (window as any).tracks.map((t: any[]) => t.length)
    );
    for (let i = 0; i < fullLengths.length; i++) {
      expect(restoredLengths[i]).toBe(fullLengths[i]);
    }

    // narrowWindow should be null.
    const nw = await page.evaluate(() => (window as any).narrowWindow);
    expect(nw).toBeNull();
  });

  test('second brush replaces the active window (no stacking)', async ({ page }) => {
    await loadTwoHairpinTracks(page);

    // First brush: 20–80% of the graph.
    await brushOnElevationGraph(page, 0.2, 0.8);
    await expect(page.locator('#narrow-banner')).toBeVisible();
    const firstWindow = await page.evaluate(() => (window as any).narrowWindow);
    const firstLengths = await page.evaluate(() =>
      (window as any).tracks.map((t: any[]) => t.length)
    );

    // Second brush: 40–60% of the graph (a tighter sub-region within the narrowed view).
    await brushOnElevationGraph(page, 0.4, 0.6);
    await expect(page.locator('#narrow-banner')).toBeVisible();
    const secondWindow = await page.evaluate(() => (window as any).narrowWindow);

    // The second window should be different (narrower sub-range) from the first.
    // It replaces the first window, not stacks on top of it.
    expect(secondWindow.d1).not.toBe(firstWindow.d1);

    // Tracks should be shorter still (tighter window).
    const secondLengths = await page.evaluate(() =>
      (window as any).tracks.map((t: any[]) => t.length)
    );
    // At least one track must get shorter (or stay same if already minimal).
    const anyGotShorter = secondLengths.some((len: number, i: number) => len < firstLengths[i]);
    expect(anyGotShorter).toBe(true);
  });

  test('mode switch auto-widens', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-no-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });
    await fileInput.setInputFiles(path.join(fixturesDir, 'main-route-with-loop.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });
    await page.waitForTimeout(500);

    // Ensure display mode toggle is visible so we can switch modes.
    await expect(page.locator('#display-mode')).toBeVisible({ timeout: 5000 });

    const fullLengths = await page.evaluate(() =>
      (window as any).fullTracks.map((t: any[]) => t.length)
    );

    await brushOnElevationGraph(page, 0.3, 0.7);
    await expect(page.locator('#narrow-banner')).toBeVisible();

    // Switch display mode.
    await page.selectOption('#display-mode-select', 'overlapping');
    await page.waitForTimeout(300);

    // Banner should be gone — mode switch auto-widens.
    await expect(page.locator('#narrow-banner')).toBeHidden();

    // narrowWindow should be null.
    const nw = await page.evaluate(() => (window as any).narrowWindow);
    expect(nw).toBeNull();

    // tracks should reflect the full (harmonized) dataset length.
    const restoredLengths = await page.evaluate(() =>
      (window as any).tracks.map((t: any[]) => t.length)
    );
    // Each restored track should be at least as long as before the narrow
    // (in overlapping mode the length may differ from the original full-mode length).
    for (const len of restoredLengths) {
      expect(len).toBeGreaterThanOrEqual(2);
    }

    // Confirm full-mode lengths also restored by switching back.
    await page.selectOption('#display-mode-select', 'full');
    await page.waitForTimeout(200);
    const fullModeRestoredLengths = await page.evaluate(() =>
      (window as any).tracks.map((t: any[]) => t.length)
    );
    for (let i = 0; i < fullLengths.length; i++) {
      expect(fullModeRestoredLengths[i]).toBe(fullLengths[i]);
    }
  });

  test('reload clears narrow window', async ({ page }) => {
    await loadTwoHairpinTracks(page);

    // Wait for the URL hash to be written (tracks saved to server).
    await expect.poll(() => page.evaluate(() => window.location.hash.length))
      .toBeGreaterThan(1);

    await brushOnElevationGraph(page, 0.3, 0.7);
    await expect(page.locator('#narrow-banner')).toBeVisible();

    // Reload — narrowWindow is ephemeral (not persisted).
    await page.reload();

    // Wait for tracks to be restored from hash.
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });
    await page.waitForTimeout(300);

    // Banner must be hidden after reload.
    await expect(page.locator('#narrow-banner')).toBeHidden();

    // narrowWindow must be null.
    const nw = await page.evaluate(() => (window as any).narrowWindow);
    expect(nw).toBeNull();

    // tracks and fullTracks must match in length (no narrow applied).
    const info = await page.evaluate(() => {
      const tracks = (window as any).tracks as any[][];
      const fullTracks = (window as any).fullTracks as any[][];
      return tracks.map((t, i) => ({ trackLen: t.length, fullLen: fullTracks[i].length }));
    });
    for (const { trackLen, fullLen } of info) {
      expect(trackLen).toBe(fullLen);
    }
  });
});
