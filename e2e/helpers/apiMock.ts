import { Page } from '@playwright/test';
import * as crypto from 'crypto';

const API_BASE = 'http://localhost:8787';

interface TrackMeta {
  id: string;
  date: string | null;
  startLat: number | null;
  startLon: number | null;
}

interface StoredTrackData {
  id: string;
  data: string;
  meta: TrackMeta;
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
  let settings: Record<string, unknown> = {};
  let currentPassword = 'testpassword';

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
          'Access-Control-Allow-Methods': 'GET, PUT, DELETE, POST, OPTIONS',
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
      settings = {};
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

    // GET /tracks/{id} — public, no auth required
    if (method === 'GET' && path.startsWith('/tracks/')) {
      const trackId = path.slice('/tracks/'.length);
      const track = tracks.find((t) => t.id === trackId);
      if (track) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ id: track.id, data: track.data }),
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
    seedTracks: async (gpxDataArray: string[]) => {
      for (const gpxText of gpxDataArray) {
        const trackId = computeTestTrackId(TEST_USER_ID, gpxText);
        const meta = extractGPXMetadata(gpxText);
        if (!tracks.some((t) => t.id === trackId)) {
          tracks.push({
            id: trackId,
            data: gpxText,
            meta: { id: trackId, ...meta },
          });
        }
      }
    },
    getTrackId: (gpxText: string) => computeTestTrackId(TEST_USER_ID, gpxText),
    getSettings: () => ({ ...settings }),
    setPassword: (pw: string) => { currentPassword = pw; },
  };
}
