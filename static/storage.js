// IndexedDB storage for GPX files.
// Uses content hash (SHA-256) as primary key for deduplication.

const DB_NAME = 'runnerUpDB';
const DB_VERSION = 1;
const STORE_NAME = 'gpxTracks';

let dbPromise = null;

// Open (or create) the IndexedDB database.
function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Failed to open IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Store GPX tracks with 'id' as primary key (content hash).
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });

  return dbPromise;
}

// Save a GPX file to IndexedDB. Returns the storage ID (content hash).
async function saveGPXToStorage(gpxText) {
  try {
    const db = await openDB();

    // Use SHA-256 content hash as ID - automatically handles duplicates.
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(gpxText);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const id = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      // Check if this content already exists.
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        if (getRequest.result) {
          // Already exists, return the existing ID.
          resolve(id);
          return;
        }

        // Create new entry.
        const putRequest = store.put({ id, data: gpxText });
        putRequest.onsuccess = () => resolve(id);
        putRequest.onerror = () => reject(putRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);

      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('Failed to save GPX to IndexedDB:', e);
    alert('Failed to save track to storage: ' + e.message);
    return null;
  }
}

// Delete a GPX track from IndexedDB by its storage ID.
async function deleteGPXFromStorage(storageId) {
  if (!storageId) return;

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(storageId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('Failed to delete GPX from IndexedDB:', e);
  }
}

// Get all stored GPX tracks from IndexedDB.
async function getAllStoredGPX() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('Failed to read from IndexedDB:', e);
    return [];
  }
}

// Get a single GPX track by ID.
async function getGPXById(storageId) {
  if (!storageId) return null;

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(storageId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('Failed to get GPX from IndexedDB:', e);
    return null;
  }
}

// Clear all stored GPX tracks (for testing).
async function clearAllStoredGPX() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('Failed to clear IndexedDB:', e);
  }
}
