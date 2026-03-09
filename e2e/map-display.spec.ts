import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow } from './helpers/localStorage';

test.describe('Map Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await page.reload();
  });

  test('should display map container on page load', async ({ page }) => {
    await expect(page.locator(selectors.mapContainer)).toBeVisible();
  });
});
