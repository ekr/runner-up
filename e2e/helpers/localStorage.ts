import { Page } from '@playwright/test';
import * as crypto from 'crypto';

export interface StoredTrack {
  data: string;
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
 * IDs are computed from content hash (SHA-256) to match app behavior.
 */
export async function seedLocalStorageNow(page: Page, tracks: StoredTrack[]): Promise<void> {
  // Compute SHA-256 hash as ID for each track (inline the hash function)
  const tracksWithIds = tracks.map((track) => ({
    id: crypto.createHash('sha256').update(track.data).digest('hex'),
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
