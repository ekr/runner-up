// Server-side storage for GPX files via Cloudflare Workers + R2.
// Track IDs are HMAC-based capability URLs (computed server-side).

const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:8787'
  : 'https://api.runnerup.win';

// Auth state management.
function getAuthToken() {
  return localStorage.getItem('runnerup:authToken');
}

function getUsername() {
  return localStorage.getItem('runnerup:username');
}

function setAuth(token, username) {
  localStorage.setItem('runnerup:authToken', token);
  localStorage.setItem('runnerup:username', username);
}

function clearAuth() {
  localStorage.removeItem('runnerup:authToken');
  localStorage.removeItem('runnerup:username');
}

function isLoggedIn() {
  return !!getAuthToken();
}

// Make an API request with the auth token.
async function apiFetch(path, options = {}) {
  const headers = { ...options.headers };
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // If server returns 401, clear stale auth state.
  if (response.status === 401 && token) {
    clearAuth();
    if (typeof updateAuthUI === 'function') {
      updateAuthUI();
    }
  }

  return response;
}

// Register a new account. Returns {token, username} on success, throws on error.
async function apiRegister(username, password, inviteCode) {
  const response = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.toLowerCase(), password, inviteCode }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `Registration failed: ${response.status}`);
  }

  setAuth(result.token, result.username);
  return result;
}

// Login. Returns {token, username} on success, throws on error.
async function apiLogin(username, password) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.toLowerCase(), password }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `Login failed: ${response.status}`);
  }

  setAuth(result.token, result.username);
  return result;
}

// Logout.
function logout() {
  clearAuth();
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
// No auth needed — trackIds are capability URLs, so this works for sharing too.
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

// Get user settings from server.
async function apiGetSettings() {
  const response = await apiFetch('/settings');
  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }
  return await response.json();
}

// Save user settings to server.
async function apiPutSettings(settings) {
  const response = await apiFetch('/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }
}

// Change password. Returns {token, username} on success, throws on error.
async function apiChangePassword(currentPassword, newPassword) {
  const response = await apiFetch('/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `Change password failed: ${response.status}`);
  }

  setAuth(result.token, result.username);
  return result;
}

// Delete account. Clears auth on success, throws on error.
async function apiDeleteAccount(password) {
  const response = await apiFetch('/auth/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || `Delete account failed: ${response.status}`);
  }

  clearAuth();
}

// Save a track to the current user's shared tracks list.
// Called automatically when viewing someone else's track via URL.
async function addSharedTrack(trackId) {
  try {
    await apiFetch('/shared-tracks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId }),
    });
  } catch (e) {
    console.error('Failed to save shared track:', e);
  }
}

// Get all tracks shared with the current user.
// Returns [{trackId, sharedBy, date, startLat, startLon, sizeBytes}].
async function getSharedTracks() {
  try {
    const response = await apiFetch('/shared-tracks');
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
    return await response.json();
  } catch (e) {
    console.error('Failed to read shared tracks from server:', e);
    return [];
  }
}

// Remove a shared track from your list (does not delete the underlying GPX).
async function removeSharedTrack(trackId) {
  if (!trackId) return;
  try {
    const response = await apiFetch(`/shared-tracks/${trackId}`, {
      method: 'DELETE',
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Server error: ${response.status}`);
    }
  } catch (e) {
    console.error('Failed to remove shared track:', e);
  }
}

// Rename a track (set or clear its label).
async function apiRenameTrack(storageId, label) {
  if (!storageId) return;
  try {
    const response = await apiFetch(`/tracks/${storageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label || null }),
    });
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
  } catch (e) {
    console.error('Failed to rename track:', e);
  }
}

// Rename a shared track (set or clear its label).
async function apiRenameSharedTrack(trackId, label) {
  if (!trackId) return;
  try {
    const response = await apiFetch(`/shared-tracks/${trackId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label || null }),
    });
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
  } catch (e) {
    console.error('Failed to rename shared track:', e);
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
