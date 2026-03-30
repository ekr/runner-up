// Server-side storage for GPX files via Cloudflare Workers + R2.
// Track IDs are HMAC-based capability URLs (computed server-side).

const API_BASE = 'https://api.runnerup.win';

// Get or provision a user ID.
function getUserId() {
  return localStorage.getItem('runnerup:userId');
}

function setUserId(id) {
  localStorage.setItem('runnerup:userId', id);
}

// Make an API request with the user ID header.
async function apiFetch(path, options = {}) {
  const headers = { ...options.headers };
  const userId = getUserId();
  if (userId) {
    headers['X-User-Id'] = userId;
  }

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // If the server provisioned a new user ID, persist it.
  const newUserId = response.headers.get('X-User-Id');
  if (newUserId) {
    setUserId(newUserId);
  }

  return response;
}

// Save a GPX file to server storage. Returns the storage ID (HMAC-based).
async function saveGPXToStorage(gpxText) {
  try {
    const response = await apiFetch('/tracks', {
      method: 'PUT',
      headers: { 'Content-Type': 'text/xml' },
      body: gpxText,
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const result = await response.json();
    return result.id;
  } catch (e) {
    console.error('Failed to save GPX to server:', e);
    alert('Failed to save track to storage: ' + e.message);
    return null;
  }
}

// Delete a GPX track from server storage by its storage ID.
async function deleteGPXFromStorage(storageId) {
  if (!storageId) return;

  try {
    const response = await apiFetch(`/tracks/${storageId}`, {
      method: 'DELETE',
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Server error: ${response.status}`);
    }
  } catch (e) {
    console.error('Failed to delete GPX from server:', e);
  }
}

// Get all stored GPX track metadata for the current user.
// Returns [{id, date, startLat, startLon}] — no GPX data.
async function getAllStoredGPX() {
  try {
    const response = await apiFetch('/tracks');

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    return await response.json();
  } catch (e) {
    console.error('Failed to read tracks from server:', e);
    return [];
  }
}

// Get a single GPX track by ID.
// Returns {id, data} where data is the GPX XML text.
async function getGPXById(storageId) {
  if (!storageId) return null;

  try {
    const response = await apiFetch(`/tracks/${storageId}`);

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Server error: ${response.status}`);
    }

    return await response.json();
  } catch (e) {
    console.error('Failed to get GPX from server:', e);
    return null;
  }
}

// Clear all stored GPX tracks (for testing).
async function clearAllStoredGPX() {
  try {
    const response = await apiFetch('/tracks', {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
  } catch (e) {
    console.error('Failed to clear tracks on server:', e);
  }
}

// Load shared tracks by calling the share API.
// Returns an array of {id, data} objects (1 or 2 tracks).
async function loadSharedTracks(trackIds) {
  const path = '/share/' + trackIds.join('/');
  try {
    const response = await fetch(`${API_BASE}${path}`);

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const result = await response.json();
    // Single track returns {id, data}, two tracks returns {tracks: [{id, data}, ...]}.
    if (result.tracks) {
      return result.tracks;
    }
    return [result];
  } catch (e) {
    console.error('Failed to load shared tracks:', e);
    return null;
  }
}

// Construct a share URL from track IDs.
function getShareUrl(trackIds) {
  return `${window.location.origin}/#/share/${trackIds.join('/')}`;
}
