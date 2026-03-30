import type { Env } from './index';

interface TrackMeta {
  id: string;
  date: string | null;
  startLat: number | null;
  startLon: number | null;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Compute track ID: truncate128(HMAC-SHA256(secret, userId + gpxText)).
async function computeTrackId(secret: string, userId: string, gpxText: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const data = new TextEncoder().encode(userId + gpxText);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  // Truncate to 128 bits (16 bytes) and hex-encode.
  const bytes = new Uint8Array(sig).slice(0, 16);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Extract metadata from GPX XML: first trkpt's lat, lon, and time.
function extractGPXMetadata(gpxText: string): { date: string | null; startLat: number | null; startLon: number | null } {
  const trkptMatch = gpxText.match(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/);
  const startLat = trkptMatch ? parseFloat(trkptMatch[1]) : null;
  const startLon = trkptMatch ? parseFloat(trkptMatch[2]) : null;

  // Find the <time> element inside (or near) the first trkpt.
  let date: string | null = null;
  if (trkptMatch) {
    // Look for <time> after this trkpt match, within the next chunk of text.
    const afterTrkpt = gpxText.substring(trkptMatch.index!);
    const timeMatch = afterTrkpt.match(/<time>([^<]+)<\/time>/);
    if (timeMatch) {
      date = timeMatch[1];
    }
  }

  return { date, startLat, startLon };
}

// Read the per-user index from R2.
async function readIndex(bucket: R2Bucket, userId: string): Promise<TrackMeta[]> {
  const obj = await bucket.get(`index/${userId}`);
  if (!obj) return [];
  const text = await obj.text();
  return JSON.parse(text);
}

// Write the per-user index to R2.
async function writeIndex(bucket: R2Bucket, userId: string, index: TrackMeta[]): Promise<void> {
  await bucket.put(`index/${userId}`, JSON.stringify(index));
}

export async function handleTrackRoutes(
  request: Request,
  env: Env,
  userId: string,
  path: string,
): Promise<Response> {
  // PUT /tracks — upload a new GPX track.
  if (request.method === 'PUT' && path === '/tracks') {
    const gpxText = await request.text();
    if (!gpxText.trim()) {
      return jsonResponse({ error: 'Empty body' }, 400);
    }

    const trackId = await computeTrackId(env.SHARE_SECRET, userId, gpxText);

    // Check if this track already exists in the user's index.
    const index = await readIndex(env.GPX_BUCKET, userId);
    if (index.some((entry) => entry.id === trackId)) {
      return jsonResponse({ id: trackId }, 200);
    }

    // Store the GPX data.
    await env.GPX_BUCKET.put(`gpx/${trackId}`, gpxText);

    // Extract metadata and update index.
    const meta = extractGPXMetadata(gpxText);
    index.push({ id: trackId, ...meta });
    await writeIndex(env.GPX_BUCKET, userId, index);

    return jsonResponse({ id: trackId }, 201);
  }

  // GET /tracks — list all tracks (metadata only).
  if (request.method === 'GET' && path === '/tracks') {
    const index = await readIndex(env.GPX_BUCKET, userId);
    return jsonResponse(index, 200);
  }

  // GET /tracks/{id} — fetch a single track's GPX data.
  if (request.method === 'GET' && path.startsWith('/tracks/')) {
    const trackId = path.slice('/tracks/'.length);
    if (!trackId) {
      return jsonResponse({ error: 'Missing track ID' }, 400);
    }

    // Verify ownership.
    const index = await readIndex(env.GPX_BUCKET, userId);
    if (!index.some((entry) => entry.id === trackId)) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    const obj = await env.GPX_BUCKET.get(`gpx/${trackId}`);
    if (!obj) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    const data = await obj.text();
    return jsonResponse({ id: trackId, data }, 200);
  }

  // DELETE /tracks/{id} — delete a single track.
  if (request.method === 'DELETE' && path.startsWith('/tracks/') && path !== '/tracks/') {
    const trackId = path.slice('/tracks/'.length);

    const index = await readIndex(env.GPX_BUCKET, userId);
    const newIndex = index.filter((entry) => entry.id !== trackId);

    if (newIndex.length === index.length) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    await env.GPX_BUCKET.delete(`gpx/${trackId}`);
    await writeIndex(env.GPX_BUCKET, userId, newIndex);

    return new Response(null, { status: 204 });
  }

  // DELETE /tracks — delete all tracks for this user.
  if (request.method === 'DELETE' && path === '/tracks') {
    const index = await readIndex(env.GPX_BUCKET, userId);

    // Delete all GPX objects.
    await Promise.all(index.map((entry) => env.GPX_BUCKET.delete(`gpx/${entry.id}`)));

    // Delete the index.
    await env.GPX_BUCKET.delete(`index/${userId}`);

    return new Response(null, { status: 204 });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}
