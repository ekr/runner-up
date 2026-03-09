import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { clearLocalStorageNow, getSetting } from './helpers/localStorage';

test.describe('Settings', () => {
  test.describe('basic functionality', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      await page.reload();
    });

    test('should display settings page', async ({ page }) => {
      await expect(page.locator('h2')).toHaveText('Settings');
      await expect(page.locator(selectors.unitsDropdown)).toBeVisible();
      await expect(page.locator(selectors.saveButton)).toBeVisible();
    });

    test('should have Imperial as default units', async ({ page }) => {
      const unitsDropdown = page.locator(selectors.unitsDropdown);
      await expect(unitsDropdown).toHaveValue('imperial');
    });

    test('should save units preference to localStorage', async ({ page }) => {
      const unitsDropdown = page.locator(selectors.unitsDropdown);
      const saveButton = page.locator(selectors.saveButton);

      // Change to metric
      await unitsDropdown.selectOption('metric');
      await saveButton.click();

      // Check localStorage
      const savedUnits = await getSetting(page, 'units');
      expect(savedUnits).toBe('metric');
    });

    test('should navigate to settings from main page', async ({ page }) => {
      await page.goto('/');

      // Click settings link
      await page.click('a[href="/settings.html"]');

      // Should be on settings page
      await expect(page).toHaveURL(/settings\.html/);
      await expect(page.locator('h2')).toHaveText('Settings');
    });
  });

  test.describe('persistence', () => {
    test('should persist units preference across page loads', async ({ page }) => {
      // Clear manually before first navigation
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      await page.reload();

      const unitsDropdown = page.locator(selectors.unitsDropdown);
      const saveButton = page.locator(selectors.saveButton);

      // Change to metric and save
      await unitsDropdown.selectOption('metric');
      await saveButton.click();

      // Reload page
      await page.reload();

      // Should still show metric
      await expect(unitsDropdown).toHaveValue('metric');
    });
  });
});
