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
