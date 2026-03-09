import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow } from './helpers/localStorage';

test.describe('Graphs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearLocalStorageNow(page);
    await page.reload();
  });

  test('should show compare-by menu', async ({ page }) => {
    await expect(page.locator(selectors.compareByMenu)).toBeVisible();
  });
});
