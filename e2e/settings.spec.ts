import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { setupApiMock } from './helpers/apiMock';
import { clearLocalStorageNow } from './helpers/localStorage';
import * as fs from 'fs';
import * as path from 'path';

const track1Data = fs.readFileSync(path.join(__dirname, 'fixtures', 'track1.gpx'), 'utf-8');

test.describe('Settings', () => {
  test.describe('logged out', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      await page.reload();
    });

    test('should show login prompt when not logged in', async ({ page }) => {
      await expect(page.locator(selectors.settingsLoginPrompt)).toBeVisible();
      await expect(page.locator(selectors.settingsContent)).toBeHidden();
    });

    test('should navigate to settings from main page', async ({ page }) => {
      await page.goto('/');
      await page.click('a[href="/settings.html"]');
      await expect(page).toHaveURL(/settings\.html/);
      await expect(page.locator('h2')).toHaveText('Settings');
    });

    test('should show back link that navigates to main page', async ({ page }) => {
      const backLink = page.locator(selectors.settingsBack + ' a');
      await expect(backLink).toBeVisible();
      await expect(backLink).toHaveAttribute('href', '/');
      await backLink.click();
      await expect(page).toHaveURL(/\/$/);
    });
  });

  test.describe('layout', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      await setupApiMock(page);
      await page.reload();
    });

    test('should have a centered container with max-width', async ({ page }) => {
      const container = page.locator(selectors.settingsContainer);
      await expect(container).toBeVisible();
      const maxWidth = await container.evaluate(el => getComputedStyle(el).maxWidth);
      expect(maxWidth).toBe('600px');
    });

    test('should render settings in card-style sections', async ({ page }) => {
      const sections = page.locator(selectors.settingsSection);
      // Profile Picture, Units, Change Password, My Tracks, Delete Account
      await expect(sections).toHaveCount(5);

      // Verify card styling on first section
      const border = await sections.first().evaluate(el => getComputedStyle(el).borderRadius);
      expect(border).toBe('6px');
    });

    test('should display units controls inline', async ({ page }) => {
      const inline = page.locator('.settings-inline');
      await expect(inline).toBeVisible();
      const display = await inline.evaluate(el => getComputedStyle(el).display);
      expect(display).toBe('flex');
    });
  });

  test.describe('logged in', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      const mock = await setupApiMock(page);
      await page.reload();
    });

    test('should show settings content when logged in', async ({ page }) => {
      await expect(page.locator(selectors.settingsContent)).toBeVisible();
      await expect(page.locator(selectors.settingsLoginPrompt)).toBeHidden();
    });

    test('should display units dropdown with default value', async ({ page }) => {
      await expect(page.locator(selectors.unitsDropdown)).toBeVisible();
      await expect(page.locator(selectors.unitsDropdown)).toHaveValue('imperial');
    });

    test('should save units preference', async ({ page }) => {
      const unitsDropdown = page.locator(selectors.unitsDropdown);
      const saveButton = page.locator(selectors.saveButton);

      await unitsDropdown.selectOption('metric');
      await saveButton.click();

      await expect(page.locator(selectors.unitsSuccess)).toHaveText('Saved');
    });

    test('should persist units preference across page loads', async ({ page }) => {
      // The mock is already set up, change units and save
      const unitsDropdown = page.locator(selectors.unitsDropdown);
      const saveButton = page.locator(selectors.saveButton);

      await unitsDropdown.selectOption('metric');
      await saveButton.click();
      await expect(page.locator(selectors.unitsSuccess)).toHaveText('Saved');

      // Reload page (mock state persists via route handler)
      await page.reload();

      await expect(unitsDropdown).toHaveValue('metric');
    });
  });

  test.describe('change password', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      await setupApiMock(page);
      await page.reload();
    });

    test('should show error for mismatched passwords', async ({ page }) => {
      await page.fill(selectors.currentPassword, 'testpassword');
      await page.fill(selectors.newPassword, 'newpassword1');
      await page.fill(selectors.confirmPassword, 'differentpassword');
      await page.click(selectors.changePasswordBtn);

      await expect(page.locator(selectors.passwordError)).toHaveText('New passwords do not match.');
    });

    test('should show error for short password', async ({ page }) => {
      await page.fill(selectors.currentPassword, 'testpassword');
      await page.fill(selectors.newPassword, 'short');
      await page.fill(selectors.confirmPassword, 'short');
      await page.click(selectors.changePasswordBtn);

      await expect(page.locator(selectors.passwordError)).toHaveText('New password must be at least 8 characters.');
    });

    test('should show error for wrong current password', async ({ page }) => {
      await page.fill(selectors.currentPassword, 'wrongpassword');
      await page.fill(selectors.newPassword, 'newpassword1');
      await page.fill(selectors.confirmPassword, 'newpassword1');
      await page.click(selectors.changePasswordBtn);

      await expect(page.locator(selectors.passwordError)).toHaveText('Current password is incorrect');
    });

    test('should change password successfully', async ({ page }) => {
      await page.fill(selectors.currentPassword, 'testpassword');
      await page.fill(selectors.newPassword, 'newpassword1');
      await page.fill(selectors.confirmPassword, 'newpassword1');
      await page.click(selectors.changePasswordBtn);

      await expect(page.locator(selectors.passwordSuccess)).toHaveText('Password changed successfully.');
      // Inputs should be cleared
      await expect(page.locator(selectors.currentPassword)).toHaveValue('');
    });
  });

  test.describe('track management', () => {
    test('should show empty state when no tracks', async ({ page }) => {
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      await setupApiMock(page);
      await page.reload();

      await expect(page.locator('.track-empty')).toHaveText('No tracks saved.');
    });

    test('should list tracks', async ({ page }) => {
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      const mock = await setupApiMock(page);
      await mock.seedTracks([track1Data]);
      await page.reload();

      await expect(page.locator(selectors.trackItem)).toHaveCount(1);
    });

    test('should delete a track', async ({ page }) => {
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      const mock = await setupApiMock(page);
      await mock.seedTracks([track1Data]);
      await page.reload();

      await expect(page.locator(selectors.trackItem)).toHaveCount(1);

      // Accept the confirm dialog
      page.on('dialog', (dialog) => dialog.accept());
      await page.locator(`${selectors.trackItem} .delete-button`).click();

      await expect(page.locator(selectors.trackItem)).toHaveCount(0);
      await expect(page.locator('.track-empty')).toHaveText('No tracks saved.');
      expect(mock.getTrackCount()).toBe(0);
    });

    test('should show shared tracks with divider', async ({ page }) => {
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      const mock = await setupApiMock(page);
      await mock.seedTracks([track1Data]);
      mock.seedSharedTracks([{
        trackId: 'a'.repeat(32),
        sharedBy: 'alice',
        date: '2024-02-20T10:00:00Z',
        startLat: 37.77,
        startLon: -122.42,
        sizeBytes: 5000,
      }]);
      await page.reload();

      // Should show own track + divider + shared track
      await expect(page.locator(selectors.trackItem)).toHaveCount(2);
      await expect(page.locator('.track-list-divider')).toHaveText('Shared with me');
      // Shared track should show (alice)
      const sharedItem = page.locator(selectors.trackItem).nth(1);
      await expect(sharedItem.locator('.track-item-date')).toContainText('(alice)');
      // Shared track should have rename button
      await expect(sharedItem.locator('.rename-button')).toHaveCount(1);
    });

    test('should rename shared track on settings page', async ({ page }) => {
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      const mock = await setupApiMock(page);
      mock.seedSharedTracks([{
        trackId: 'b'.repeat(32),
        sharedBy: 'bob',
        date: '2024-03-10T08:00:00Z',
        startLat: 37.77,
        startLon: -122.42,
        sizeBytes: 3000,
      }]);
      await page.reload();

      const sharedItem = page.locator(selectors.trackItem).first();
      const nameSpan = sharedItem.locator('.track-item-date');
      await expect(nameSpan).toContainText('(bob)');

      // Click rename
      await sharedItem.locator('.rename-button').click();
      const input = sharedItem.locator('.track-rename-input');
      await expect(input).toBeVisible();

      await input.fill('Bob Morning Run');
      await input.press('Enter');

      // Should show new label with (bob) suffix
      await expect(nameSpan).toHaveText('Bob Morning Run (bob)');
    });
  });

  test.describe('delete account', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      await setupApiMock(page);
      await page.reload();
    });

    test('should show confirmation form on delete button click', async ({ page }) => {
      await expect(page.locator(selectors.deleteConfirm)).toBeHidden();
      await page.click(selectors.deleteAccountBtn);
      await expect(page.locator(selectors.deleteConfirm)).toBeVisible();
      await expect(page.locator(selectors.deleteAccountBtn)).toBeHidden();
    });

    test('should cancel deletion', async ({ page }) => {
      await page.click(selectors.deleteAccountBtn);
      await page.click(selectors.deleteCancelBtn);
      await expect(page.locator(selectors.deleteConfirm)).toBeHidden();
      await expect(page.locator(selectors.deleteAccountBtn)).toBeVisible();
    });

    test('should show error for wrong password', async ({ page }) => {
      await page.click(selectors.deleteAccountBtn);
      await page.fill(selectors.deletePassword, 'wrongpassword');
      await page.click(selectors.deleteConfirmBtn);

      await expect(page.locator(selectors.deleteError)).toHaveText('Password is incorrect');
    });

    test('should delete account and redirect', async ({ page }) => {
      await page.click(selectors.deleteAccountBtn);
      await page.fill(selectors.deletePassword, 'testpassword');
      await page.click(selectors.deleteConfirmBtn);

      // Should redirect to main page
      await expect(page).toHaveURL(/\/$/);
    });
  });
});
