import { Page } from '@playwright/test';
import * as crypto from 'crypto';

const API_BASE = 'http://localhost:8787';

interface TrackMeta {
  id: string;
  date: string | null;
  startLat: number | null;
  startLon: number | null;
  label?: string;
}

interface StoredTrackData {
  id: string;
  data: string;
  meta: TrackMeta;
  owner: string;
}

interface SharedTrackMeta {
  trackId: string;
  sharedBy: string;
  date: string | null;
  startLat: number | null;
  startLon: number | null;
  sizeBytes: number;
  label?: string;
}

// Mock auth token for tests. In the real system this is HMAC-signed;
// in tests we just use a fixed string that the mock recognizes.
const TEST_AUTH_TOKEN = 'test-auth-token-for-e2e';
const TEST_USERNAME = 'testuser';

// Simulates HMAC-based track IDs. In tests we just use a hash since we
// don't have the real SHARE_SECRET.
function computeTestTrackId(userId: string, gpxText: string): string {
  const hash = crypto.createHash('sha256').update(userId + '\0' + gpxText).digest('hex');
  return hash.slice(0, 32); // 128 bits
}

function extractGPXMetadata(gpxText: string): { date: string | null; startLat: number | null; startLon: number | null } {
  const trkptMatch = gpxText.match(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/);
  const startLat = trkptMatch ? parseFloat(trkptMatch[1]) : null;
  const startLon = trkptMatch ? parseFloat(trkptMatch[2]) : null;

  let date: string | null = null;
  if (trkptMatch) {
    const afterTrkpt = gpxText.substring(trkptMatch.index!);
    const timeMatch = afterTrkpt.match(/<time>([^<]+)<\/time>/);
    if (timeMatch) {
      date = timeMatch[1];
    }
  }

  return { date, startLat, startLon };
}

// Check if a request has a valid auth token.
function isAuthenticated(request: { headers: () => Record<string, string> }): boolean {
  const headers = request.headers();
  const auth = headers['authorization'] || '';
  return auth === `Bearer ${TEST_AUTH_TOKEN}`;
}

/**
 * Set up API route mocks for the storage API.
 * Returns an object with methods to inspect/manipulate the mock state.
 */
export async function setupApiMock(page: Page) {
  const TEST_USER_ID = 'test-user-00000000-0000-0000-0000-000000000000';

  // In-memory storage for the mock.
  let tracks: StoredTrackData[] = [];
  let sharedTracks: SharedTrackMeta[] = [];
  let settings: Record<string, unknown> = {};
  let currentPassword = 'testpassword';
  let avatarData: Buffer | null = null;
  let avatarContentType: string | null = null;
  // Avatars for other usernames (for testing avatar display on shared tracks).
  const otherAvatars: Map<string, { data: Buffer; contentType: string }> = new Map();

  // Set auth token and username in localStorage so the client is logged in.
  await page.evaluate(({ token, username }) => {
    localStorage.setItem('runnerup:authToken', token);
    localStorage.setItem('runnerup:username', username);
  }, { token: TEST_AUTH_TOKEN, username: TEST_USERNAME });

  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    // CORS preflight
    if (method === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, PUT, DELETE, POST, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
      return;
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
    };

    // POST /auth/login — mock login
    if (method === 'POST' && path === '/auth/login') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ token: TEST_AUTH_TOKEN, username: TEST_USERNAME }),
      });
      return;
    }

    // POST /auth/register — mock register
    if (method === 'POST' && path === '/auth/register') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ token: TEST_AUTH_TOKEN, username: TEST_USERNAME }),
      });
      return;
    }

    // POST /auth/change-password
    if (method === 'POST' && path === '/auth/change-password') {
      if (!isAuthenticated(request)) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Authentication required' }),
        });
        return;
      }
      const body = JSON.parse(request.postData() || '{}');
      if (body.currentPassword !== currentPassword) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Current password is incorrect' }),
        });
        return;
      }
      if (!body.newPassword || body.newPassword.length < 8) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Password must be at least 8 characters' }),
        });
        return;
      }
      currentPassword = body.newPassword;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ token: TEST_AUTH_TOKEN, username: TEST_USERNAME }),
      });
      return;
    }

    // DELETE /auth/account
    if (method === 'DELETE' && path === '/auth/account') {
      if (!isAuthenticated(request)) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Authentication required' }),
        });
        return;
      }
      const body = JSON.parse(request.postData() || '{}');
      if (body.password !== currentPassword) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Password is incorrect' }),
        });
        return;
      }
      tracks = [];
      sharedTracks = [];
      settings = {};
      avatarData = null;
      avatarContentType = null;
      await route.fulfill({
        status: 204,
        headers: corsHeaders,
      });
      return;
    }

    // GET /settings
    if (method === 'GET' && path === '/settings') {
      if (!isAuthenticated(request)) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Authentication required' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify(settings),
      });
      return;
    }

    // PUT /settings
    if (method === 'PUT' && path === '/settings') {
      if (!isAuthenticated(request)) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Authentication required' }),
        });
        return;
      }
      settings = JSON.parse(request.postData() || '{}');
      await route.fulfill({
        status: 204,
        headers: corsHeaders,
      });
      return;
    }

    // GET /shared-tracks — list shared tracks (authenticated)
    if (method === 'GET' && path === '/shared-tracks') {
      if (!isAuthenticated(request)) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Authentication required' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify(sharedTracks),
      });
      return;
    }

    // PATCH /shared-tracks/{id} — rename shared track (authenticated)
    if (method === 'PATCH' && path.startsWith('/shared-tracks/')) {
      if (!isAuthenticated(request)) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Authentication required' }),
        });
        return;
      }
      const trackId = path.slice('/shared-tracks/'.length);
      const entry = sharedTracks.find((s) => s.trackId === trackId);
      if (!entry) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Not found' }),
        });
        return;
      }
      const body = JSON.parse(request.postData() || '{}');
      if (typeof body.label === 'string' && body.label.trim()) {
        entry.label = body.label.trim();
      } else {
        delete entry.label;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    // DELETE /shared-tracks/{id} — remove shared track (authenticated)
    if (method === 'DELETE' && path.startsWith('/shared-tracks/')) {
      if (!isAuthenticated(request)) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Authentication required' }),
        });
        return;
      }
      const trackId = path.slice('/shared-tracks/'.length);
      const before = sharedTracks.length;
      sharedTracks = sharedTracks.filter((s) => s.trackId !== trackId);
      await route.fulfill({
        status: before !== sharedTracks.length ? 204 : 404,
        headers: corsHeaders,
      });
      return;
    }

    // POST /shared-tracks — save a track to shared list (authenticated)
    if (method === 'POST' && path === '/shared-tracks') {
      if (!isAuthenticated(request)) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Authentication required' }),
        });
        return;
      }
      const body = JSON.parse(request.postData() || '{}');
      const trackId = body.trackId;
      // Skip if already in shared list.
      if (!sharedTracks.some((s) => s.trackId === trackId)) {
        sharedTracks.push({
          trackId,
          sharedBy: 'someone',
          date: null,
          startLat: null,
          startLon: null,
          sizeBytes: 0,
        });
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    // GET /avatar/{username} — public, no auth required
    if (method === 'GET' && path.startsWith('/avatar/')) {
      const username = path.slice('/avatar/'.length);
      if (username === TEST_USERNAME && avatarData) {
        await route.fulfill({
          status: 200,
          contentType: avatarContentType || 'image/png',
          headers: corsHeaders,
          body: avatarData,
        });
      } else if (otherAvatars.has(username)) {
        const other = otherAvatars.get(username)!;
        await route.fulfill({
          status: 200,
          contentType: other.contentType,
          headers: corsHeaders,
          body: other.data,
        });
      } else {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Not found' }),
        });
      }
      return;
    }

    // PUT /avatar — upload avatar (authenticated)
    if (method === 'PUT' && path === '/avatar') {
      if (!isAuthenticated(request)) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Authentication required' }),
        });
        return;
      }
      const contentType = request.headers()['content-type'] || '';
      if (contentType !== 'image/png' && contentType !== 'image/jpeg') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Content-Type must be image/png or image/jpeg' }),
        });
        return;
      }
      const body = request.postDataBuffer();
      if (!body || body.length > 1024 * 1024) {
        await route.fulfill({
          status: 413,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Avatar too large (max 1MB)' }),
        });
        return;
      }
      avatarData = body;
      avatarContentType = contentType;
      await route.fulfill({
        status: 204,
        headers: corsHeaders,
      });
      return;
    }

    // DELETE /avatar — remove avatar (authenticated)
    if (method === 'DELETE' && path === '/avatar') {
      if (!isAuthenticated(request)) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Authentication required' }),
        });
        return;
      }
      avatarData = null;
      avatarContentType = null;
      await route.fulfill({
        status: 204,
        headers: corsHeaders,
      });
      return;
    }

    // GET /tracks/{id} — public, no auth required; returns label if authenticated
    if (method === 'GET' && path.startsWith('/tracks/')) {
      const trackId = path.slice('/tracks/'.length);
      const track = tracks.find((t) => t.id === trackId);
      if (track) {
        // Return label if authenticated user owns the track or has it in shared list.
        let label: string | null = null;
        if (isAuthenticated(request)) {
          if (track.owner === TEST_USERNAME) {
            label = track.meta.label ?? null;
          } else {
            const shared = sharedTracks.find((s) => s.trackId === trackId);
            label = shared?.label ?? null;
          }
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ id: track.id, data: track.data, owner: track.owner, label }),
        });
      } else {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Not found' }),
        });
      }
      return;
    }

    // All remaining routes require auth.
    if (!isAuthenticated(request)) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Authentication required' }),
      });
      return;
    }

    // PUT /tracks
    if (method === 'PUT' && path === '/tracks') {
      const body = request.postData() || '';
      const trackId = computeTestTrackId(TEST_USER_ID, body);

      // Check for duplicate
      if (!tracks.some((t) => t.id === trackId)) {
        const meta = extractGPXMetadata(body);
        tracks.push({
          id: trackId,
          data: body,
          meta: { id: trackId, ...meta },
          owner: TEST_USERNAME,
        });
      }

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ id: trackId }),
      });
      return;
    }

    // GET /tracks (list metadata)
    if (method === 'GET' && path === '/tracks') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify(tracks.map((t) => t.meta)),
      });
      return;
    }

    // PATCH /tracks/{id} — rename track
    if (method === 'PATCH' && path.startsWith('/tracks/') && path !== '/tracks') {
      const trackId = path.slice('/tracks/'.length);
      const track = tracks.find((t) => t.id === trackId);
      if (!track) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Not found' }),
        });
        return;
      }
      const body = JSON.parse(request.postData() || '{}');
      if (typeof body.label === 'string' && body.label.trim()) {
        track.meta.label = body.label.trim();
      } else {
        delete track.meta.label;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    // DELETE /tracks/{id}
    if (method === 'DELETE' && path.startsWith('/tracks/') && path !== '/tracks') {
      const trackId = path.slice('/tracks/'.length);
      const before = tracks.length;
      tracks = tracks.filter((t) => t.id !== trackId);
      await route.fulfill({
        status: before !== tracks.length ? 204 : 404,
        headers: corsHeaders,
      });
      return;
    }

    // DELETE /tracks (clear all)
    if (method === 'DELETE' && path === '/tracks') {
      tracks = [];
      await route.fulfill({
        status: 204,
        headers: corsHeaders,
      });
      return;
    }

    // Fallback
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    });
  });

  return {
    userId: TEST_USER_ID,
    getStoredTracks: () => tracks.map((t) => ({ id: t.id, data: t.data })),
    getTrackCount: () => tracks.length,
    seedTracks: async (gpxDataArray: string[], owner?: string) => {
      for (const gpxText of gpxDataArray) {
        const trackId = computeTestTrackId(TEST_USER_ID, gpxText);
        const meta = extractGPXMetadata(gpxText);
        if (!tracks.some((t) => t.id === trackId)) {
          tracks.push({
            id: trackId,
            data: gpxText,
            meta: { id: trackId, ...meta },
            owner: owner ?? TEST_USERNAME,
          });
        }
      }
    },
    getTrackId: (gpxText: string) => computeTestTrackId(TEST_USER_ID, gpxText),
    setTrackLabel: (gpxText: string, label: string) => {
      const trackId = computeTestTrackId(TEST_USER_ID, gpxText);
      const track = tracks.find((t) => t.id === trackId);
      if (track) {
        if (label) {
          track.meta.label = label;
        } else {
          delete track.meta.label;
        }
      }
    },
    getSettings: () => ({ ...settings }),
    setPassword: (pw: string) => { currentPassword = pw; },
    seedSharedTracks: (entries: SharedTrackMeta[]) => {
      sharedTracks.push(...entries);
    },
    getSharedTrackCount: () => sharedTracks.length,
    hasAvatar: () => avatarData !== null,
    seedAvatar: (data: Buffer, contentType: string) => {
      avatarData = data;
      avatarContentType = contentType;
    },
    seedAvatarFor: (username: string, data: Buffer, contentType: string) => {
      if (username === TEST_USERNAME) {
        avatarData = data;
        avatarContentType = contentType;
      } else {
        otherAvatars.set(username, { data, contentType });
      }
    },
  };
}
