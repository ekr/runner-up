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

/**
 * Set up API route mocks for the storage API.
 * Returns an object with methods to inspect/manipulate the mock state.
 */
export async function setupApiMock(page: Page) {
  const TEST_USER_ID = 'test-user-00000000-0000-0000-0000-000000000000';

  // In-memory storage for the mock.
  let tracks: StoredTrackData[] = [];

  // Set the userId in localStorage so the client uses it.
  await page.evaluate((userId) => {
    localStorage.setItem('runnerup:userId', userId);
  }, TEST_USER_ID);

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
          'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-User-Id',
          'Access-Control-Expose-Headers': 'X-User-Id',
        },
      });
      return;
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'X-User-Id',
    };

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

    // GET /tracks/{id}
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
  };
}
