import { test, expect } from '@playwright/test';
import { selectors } from './helpers/selectors';
import { setupApiMock } from './helpers/apiMock';
import { clearLocalStorageNow } from './helpers/localStorage';

// Minimal 1x1 red PNG as a base64 string (valid PNG file).
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

function base64ToBuffer(b64: string): Buffer {
  return Buffer.from(b64, 'base64');
}

test.describe('Avatar', () => {
  test.describe('logged out', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      await page.reload();
    });

    test('should not show avatar section when logged out', async ({ page }) => {
      await expect(page.locator(selectors.avatarPreview)).toBeHidden();
      await expect(page.locator(selectors.avatarFileInput)).toBeHidden();
    });
  });

  test.describe('logged in - no avatar', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      await setupApiMock(page);
      await page.reload();
    });

    test('should show avatar section with placeholder', async ({ page }) => {
      const preview = page.locator(selectors.avatarPreview);
      // The img element exists but is hidden (no .loaded class) when no avatar
      await expect(preview).toBeAttached();
      await expect(preview).not.toHaveClass(/loaded/);
      // The avatar container should be visible though
      await expect(page.locator('.avatar-preview-container')).toBeVisible();
    });

    test('should show file input for uploading', async ({ page }) => {
      // The file input itself may be hidden (styled), but the upload button should be visible
      await expect(page.locator(selectors.avatarUploadBtn)).toBeVisible();
    });

    test('should not show remove button when no avatar exists', async ({ page }) => {
      await expect(page.locator(selectors.avatarRemoveBtn)).toBeHidden();
    });

    test('should upload an avatar via file selection', async ({ page }) => {
      const fileInput = page.locator(selectors.avatarFileInput);

      // Upload a test PNG file
      await fileInput.setInputFiles({
        name: 'avatar.png',
        mimeType: 'image/png',
        buffer: base64ToBuffer(TINY_PNG_BASE64),
      });

      // After upload, the preview should update (src should change)
      const preview = page.locator(selectors.avatarPreview);
      await expect(preview).toHaveAttribute('src', /^(blob:|data:)/);

      // Success message should appear
      await expect(page.locator(selectors.avatarSuccess)).toBeVisible();

      // Remove button should now be visible
      await expect(page.locator(selectors.avatarRemoveBtn)).toBeVisible();
    });

    test('should reject non-image files', async ({ page }) => {
      const fileInput = page.locator(selectors.avatarFileInput);

      // Try uploading a text file
      await fileInput.setInputFiles({
        name: 'not-an-image.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello world'),
      });

      // Should show an error
      await expect(page.locator(selectors.avatarError)).toBeVisible();
      await expect(page.locator(selectors.avatarError)).toHaveText(/image/i);
    });
  });

  test.describe('logged in - with existing avatar', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      const mock = await setupApiMock(page);
      mock.seedAvatar(base64ToBuffer(TINY_PNG_BASE64), 'image/png');
      await page.reload();
    });

    test('should display existing avatar on page load', async ({ page }) => {
      const preview = page.locator(selectors.avatarPreview);
      await expect(preview).toBeVisible();
      // Should have a real image src (the avatar URL)
      await expect(preview).not.toHaveAttribute('src', '');
    });

    test('should show remove button when avatar exists', async ({ page }) => {
      await expect(page.locator(selectors.avatarRemoveBtn)).toBeVisible();
    });

    test('should remove avatar when remove button is clicked', async ({ page }) => {
      const removeBtn = page.locator(selectors.avatarRemoveBtn);
      await removeBtn.click();

      // Preview should revert to placeholder
      const preview = page.locator(selectors.avatarPreview);
      const src = await preview.getAttribute('src');
      expect(src === null || src === '' || src.startsWith('data:')).toBeTruthy();

      // Remove button should be hidden again
      await expect(page.locator(selectors.avatarRemoveBtn)).toBeHidden();
    });

    test('should replace avatar with a new upload', async ({ page }) => {
      const fileInput = page.locator(selectors.avatarFileInput);

      // Upload a different image
      await fileInput.setInputFiles({
        name: 'new-avatar.png',
        mimeType: 'image/png',
        buffer: base64ToBuffer(TINY_PNG_BASE64),
      });

      // Preview should update
      const preview = page.locator(selectors.avatarPreview);
      await expect(preview).toHaveAttribute('src', /^(blob:|data:)/);
      await expect(page.locator(selectors.avatarSuccess)).toBeVisible();
    });
  });

  test.describe('avatar section placement', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/settings.html');
      await clearLocalStorageNow(page);
      await setupApiMock(page);
      await page.reload();
    });

    test('should be the first settings section', async ({ page }) => {
      const sections = page.locator(selectors.settingsSection);
      const firstSection = sections.first();
      // The first section should contain the avatar elements
      await expect(firstSection.locator(selectors.avatarPreview)).toBeAttached();
    });

    test('settings page should now have 5 sections', async ({ page }) => {
      const sections = page.locator(selectors.settingsSection);
      // Profile Picture, Units, Change Password, My Tracks, Delete Account
      await expect(sections).toHaveCount(5);
    });
  });
});
