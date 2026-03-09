import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow } from './helpers/localStorage';
import * as path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');

test.describe('Alignment with Different Sampling Rates (DTW)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await page.reload();
  });

  test('same course with different sampling rates should produce single segment with valid DTW alignment', async ({ page }) => {
    const fileInput = page.locator(selectors.fileInput);

    // Load dense track (100 points)
    await fileInput.setInputFiles(path.join(fixturesDir, 'same-course-dense.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(1, { timeout: 10000 });

    // Load sparse track (60 points over same route)
    await fileInput.setInputFiles(path.join(fixturesDir, 'same-course-sparse.gpx'));
    await expect(page.locator(selectors.legendEntry)).toHaveCount(2, { timeout: 10000 });

    // Wait for alignment to complete (DTW can take a moment)
    await page.waitForTimeout(500);

    // Get the alignment result from the page
    const alignment = await page.evaluate(() => {
      return (window as any).alignment;
    });

    // The key assertion: tracks with different sampling rates on the same course
    // should be recognized as having a SINGLE overlapping region (DTW handles this)
    expect(alignment).not.toBeNull();
    expect(alignment.overlappingRegions.length).toBe(1);
    expect(alignment.hasMultipleSegments).toBe(false);

    // DTW should produce an alignment path
    expect(alignment.alignment).toBeDefined();
    expect(alignment.alignment.length).toBeGreaterThan(0);

    // Display mode selector should be hidden (only shows for multiple segments)
    await expect(page.locator('#display-mode')).toBeHidden();

    // Trim tracks should also be hidden
    await expect(page.locator('#trim-tracks')).toBeHidden();

    // Check that both map markers are visible
    await expect(page.locator(selectors.mapMarker)).toHaveCount(2, { timeout: 5000 });
  });
});
