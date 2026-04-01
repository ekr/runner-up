import { Page } from '@playwright/test';

/**
 * Clear localStorage settings after page has loaded.
 */
export async function clearLocalStorageNow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith('setting:') || key.startsWith('runnerup:')) {
        localStorage.removeItem(key);
      }
    }
  });
}

/**
 * Get a setting value from localStorage.
 */
export async function getSetting(page: Page, key: string): Promise<string | null> {
  return await page.evaluate((k) => {
    return localStorage.getItem(`setting:${k}`);
  }, key);
}
