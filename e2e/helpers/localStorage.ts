import { Page } from '@playwright/test';
import * as crypto from 'crypto';

export interface StoredTrack {
  id?: string;
  data: string;
}

const DB_NAME = 'runnerUpDB';
const DB_VERSION = 1;
const STORE_NAME = 'gpxTracks';

/**
 * Clear IndexedDB and localStorage settings after page has loaded.
 * Use this when you need to clear storage without affecting subsequent navigations.
 */
export async function clearLocalStorageNow(page: Page): Promise<void> {
  await page.evaluate(async ({ dbName, storeName }) => {
    // Clear localStorage settings
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith('setting:')) {
        localStorage.removeItem(key);
      }
    }
    // Also remove old gpxUploads key if present (migration cleanup)
    localStorage.removeItem('gpxUploads');

    // Clear IndexedDB
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (db.objectStoreNames.contains(storeName)) {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          const clearReq = store.clear();
          clearReq.onsuccess = () => {
            db.close();
            resolve();
          };
          clearReq.onerror = () => {
            db.close();
            reject(clearReq.error);
          };
        } else {
          db.close();
          resolve();
        }
      };
    });
  }, { dbName: DB_NAME, storeName: STORE_NAME });
}

/**
 * Seed IndexedDB with tracks after page has loaded.
 * Call this after page.goto(), then reload for the app to pick up the data.
 * IDs are computed from content hash (SHA-256) to match app behavior.
 */
export async function seedLocalStorageNow(page: Page, tracks: StoredTrack[]): Promise<void> {
  // Compute SHA-256 hash as ID for each track
  const tracksWithIds = tracks.map((track) => ({
    id: crypto.createHash('sha256').update(track.data).digest('hex'),
    data: track.data,
  }));

  await page.evaluate(async ({ tracks, dbName, storeName }) => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);

        let completed = 0;
        for (const track of tracks) {
          const putReq = store.put(track);
          putReq.onsuccess = () => {
            completed++;
            if (completed === tracks.length) {
              db.close();
              resolve();
            }
          };
          putReq.onerror = () => {
            db.close();
            reject(putReq.error);
          };
        }

        if (tracks.length === 0) {
          db.close();
          resolve();
        }
      };
    });
  }, { tracks: tracksWithIds, dbName: DB_NAME, storeName: STORE_NAME });
}

/**
 * Get the stored tracks from IndexedDB.
 */
export async function getStoredTracks(page: Page): Promise<StoredTrack[]> {
  return await page.evaluate(async ({ dbName, storeName }) => {
    return new Promise<StoredTrack[]>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const getAllReq = store.getAll();
        getAllReq.onsuccess = () => {
          db.close();
          resolve(getAllReq.result || []);
        };
        getAllReq.onerror = () => {
          db.close();
          reject(getAllReq.error);
        };
      };
    });
  }, { dbName: DB_NAME, storeName: STORE_NAME });
}

/**
 * Get a setting value from localStorage.
 */
export async function getSetting(page: Page, key: string): Promise<string | null> {
  return await page.evaluate((k) => {
    return localStorage.getItem(`setting:${k}`);
  }, key);
}
