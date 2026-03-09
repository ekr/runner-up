import { Page } from '@playwright/test';

export interface StoredTrack {
  id?: string;
  name: string;
  data: string;
}

/**
 * Generate a hash of content to use as ID.
 * Matches the hash function in script.js for consistency.
 */
function hashContent(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Clear localStorage after page has loaded (one-time clear).
 * Use this when you need to clear storage without affecting subsequent navigations.
 */
export async function clearLocalStorageNow(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem('gpxUploads');
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith('setting:')) {
        localStorage.removeItem(key);
      }
    }
  });
}

/**
 * Seed localStorage with tracks after page has loaded.
 * Call this after page.goto(), then reload for the app to pick up the data.
 * Uses content hash as ID to match production behavior.
 */
export async function seedLocalStorageNow(page: Page, tracks: StoredTrack[]): Promise<void> {
  // Use content hash as ID to match production behavior
  const tracksWithIds = tracks.map((track) => ({
    id: track.id || hashContent(track.data),
    name: track.name,
    data: track.data,
  }));
  await page.evaluate((tracksJson) => {
    localStorage.setItem('gpxUploads', tracksJson);
  }, JSON.stringify(tracksWithIds));
}

/**
 * Get the stored tracks from localStorage.
 */
export async function getStoredTracks(page: Page): Promise<StoredTrack[]> {
  return await page.evaluate(() => {
    return JSON.parse(localStorage.getItem('gpxUploads') || '[]');
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
