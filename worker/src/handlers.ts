import type { Env } from './index';

interface TrackMeta {
  id: string;
  date: string | null;
  startLat: number | null;
  startLon: number | null;
  sizeBytes: number;
  label?: string;
}

export interface SharedTrackMeta {
  trackId: string;
  sharedBy: string;
  date: string | null;
  startLat: number | null;
  startLon: number | null;
  sizeBytes: number;
}

// Limits to stay within R2 free tier.
export const MAX_TRACKS_PER_USER = 100;
export const MAX_SHARES_PER_USER = 1000;
export const MAX_TOTAL_STORAGE_BYTES = 9 * 1024 * 1024 * 1024; // 9 GB (buffer below 10 GB)
export const MAX_MONTHLY_WRITES = 9_000_000; // 9M (buffer below 10M)

interface GlobalStats {
  totalBytes: number;
  writeCount: number;
  month: string; // "YYYY-MM" — resets each month
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
  const data = new TextEncoder().encode(userId + '\0' + gpxText);
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
export async function readIndex(bucket: R2Bucket, userId: string): Promise<TrackMeta[]> {
  const obj = await bucket.get(`index/${userId}`);
  if (!obj) return [];
  const text = await obj.text();
  return JSON.parse(text);
}

// Write the per-user index to R2.
async function writeIndex(bucket: R2Bucket, userId: string, index: TrackMeta[]): Promise<void> {
  await bucket.put(`index/${userId}`, JSON.stringify(index));
}

// Read the per-user shared tracks list from R2.
export async function readShares(bucket: R2Bucket, userId: string): Promise<SharedTrackMeta[]> {
  const obj = await bucket.get(`shares/${userId}`);
  if (!obj) return [];
  const text = await obj.text();
  return JSON.parse(text);
}

// Write the per-user shared tracks list to R2.
async function writeShares(bucket: R2Bucket, userId: string, shares: SharedTrackMeta[]): Promise<void> {
  await bucket.put(`shares/${userId}`, JSON.stringify(shares));
}

// Track metadata stored per-track for sharing (owner info + metadata).
interface TrackOwnerMeta {
  owner: string; // username of the uploader
  date: string | null;
  startLat: number | null;
  startLon: number | null;
  sizeBytes: number;
}

// Read track owner metadata from R2.
export async function readTrackMeta(bucket: R2Bucket, trackId: string): Promise<TrackOwnerMeta | null> {
  const obj = await bucket.get(`track-meta/${trackId}`);
  if (!obj) return null;
  return JSON.parse(await obj.text());
}

// Write track owner metadata to R2.
async function writeTrackMeta(bucket: R2Bucket, trackId: string, meta: TrackOwnerMeta): Promise<void> {
  await bucket.put(`track-meta/${trackId}`, JSON.stringify(meta));
}

// Read global usage stats from R2.
export async function readStats(bucket: R2Bucket): Promise<GlobalStats> {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const obj = await bucket.get('_stats');
  if (obj) {
    const stats: GlobalStats = JSON.parse(await obj.text());
    if (stats.month === currentMonth) {
      return stats;
    }
    // Month rolled over: reset writeCount but preserve totalBytes.
    return { totalBytes: stats.totalBytes, writeCount: 0, month: currentMonth };
  }
  return { totalBytes: 0, writeCount: 0, month: currentMonth };
}

// Write global usage stats to R2.
export async function writeStats(bucket: R2Bucket, stats: GlobalStats): Promise<void> {
  await bucket.put('_stats', JSON.stringify(stats));
}

const VALID_TRACK_ID = /^[0-9a-f]{32}$/;

export async function handleTrackRoutes(
  request: Request,
  env: Env,
  userId: string,
  username: string,
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

    // Per-user limit.
    if (index.length >= MAX_TRACKS_PER_USER) {
      return jsonResponse({ error: 'Track limit reached' }, 429);
    }

    // Global limits (storage + monthly writes).
    const stats = await readStats(env.GPX_BUCKET);
    const bodyBytes = new TextEncoder().encode(gpxText).length;
    if (stats.totalBytes + bodyBytes > MAX_TOTAL_STORAGE_BYTES) {
      return jsonResponse({ error: 'Storage limit reached' }, 507);
    }
    if (stats.writeCount >= MAX_MONTHLY_WRITES) {
      return jsonResponse({ error: 'Monthly write limit reached' }, 429);
    }

    // Store the GPX data.
    await env.GPX_BUCKET.put(`gpx/${trackId}`, gpxText);

    // Update global stats.
    stats.totalBytes += bodyBytes;
    stats.writeCount += 1;
    await writeStats(env.GPX_BUCKET, stats);

    // Extract metadata and update index.
    const meta = extractGPXMetadata(gpxText);
    index.push({ id: trackId, ...meta, sizeBytes: bodyBytes });
    await writeIndex(env.GPX_BUCKET, userId, index);

    // Store track owner metadata for sharing.
    await writeTrackMeta(env.GPX_BUCKET, trackId, {
      owner: username,
      ...meta,
      sizeBytes: bodyBytes,
    });

    return jsonResponse({ id: trackId }, 201);
  }

  // GET /tracks — list all tracks (metadata only).
  if (request.method === 'GET' && path === '/tracks') {
    const index = await readIndex(env.GPX_BUCKET, userId);
    return jsonResponse(index, 200);
  }

  // Note: GET /tracks/{id} is handled in index.ts as a public route (no auth needed).

  // PATCH /tracks/{id} — update track metadata (e.g., label).
  if (request.method === 'PATCH' && path.startsWith('/tracks/') && path.length > '/tracks/'.length) {
    const trackId = path.slice('/tracks/'.length);
    if (!VALID_TRACK_ID.test(trackId)) {
      return jsonResponse({ error: 'Invalid track ID' }, 400);
    }

    let body: { label?: string };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const index = await readIndex(env.GPX_BUCKET, userId);
    const entry = index.find((e) => e.id === trackId);
    if (!entry) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    if (typeof body.label === 'string') {
      const trimmed = body.label.trim();
      if (trimmed) {
        entry.label = trimmed;
      } else {
        delete entry.label;
      }
    } else if (body.label === null) {
      delete entry.label;
    }

    await writeIndex(env.GPX_BUCKET, userId, index);
    return jsonResponse({ ok: true }, 200);
  }

  // DELETE /tracks/{id} — delete a single track.
  if (request.method === 'DELETE' && path.startsWith('/tracks/') && path.length > '/tracks/'.length) {
    const trackId = path.slice('/tracks/'.length);
    if (!VALID_TRACK_ID.test(trackId)) {
      return jsonResponse({ error: 'Invalid track ID' }, 400);
    }

    const index = await readIndex(env.GPX_BUCKET, userId);
    const deleted = index.find((entry) => entry.id === trackId);

    if (!deleted) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    const newIndex = index.filter((entry) => entry.id !== trackId);
    await env.GPX_BUCKET.delete(`gpx/${trackId}`);
    await env.GPX_BUCKET.delete(`track-meta/${trackId}`);
    await writeIndex(env.GPX_BUCKET, userId, newIndex);

    if (deleted.sizeBytes > 0) {
      const stats = await readStats(env.GPX_BUCKET);
      stats.totalBytes = Math.max(0, stats.totalBytes - deleted.sizeBytes);
      await writeStats(env.GPX_BUCKET, stats);
    }

    return new Response(null, { status: 204 });
  }

  // DELETE /tracks — delete all tracks for this user.
  if (request.method === 'DELETE' && path === '/tracks') {
    const index = await readIndex(env.GPX_BUCKET, userId);

    const totalDeleted = index.reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0);

    // Delete all GPX objects and their metadata.
    await Promise.all(index.map((entry) => Promise.all([
      env.GPX_BUCKET.delete(`gpx/${entry.id}`),
      env.GPX_BUCKET.delete(`track-meta/${entry.id}`),
    ])));

    // Delete the index.
    await env.GPX_BUCKET.delete(`index/${userId}`);

    if (totalDeleted > 0) {
      const stats = await readStats(env.GPX_BUCKET);
      stats.totalBytes = Math.max(0, stats.totalBytes - totalDeleted);
      await writeStats(env.GPX_BUCKET, stats);
    }

    return new Response(null, { status: 204 });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

export async function handleSharedTrackRoutes(
  request: Request,
  env: Env,
  userId: string,
  path: string,
): Promise<Response> {
  // POST /shared-tracks — save a track to your shared list.
  // Called automatically when a logged-in user views someone else's track via URL.
  if (request.method === 'POST' && path === '/shared-tracks') {
    let body: { trackId?: string };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const { trackId } = body;
    if (!trackId || !VALID_TRACK_ID.test(trackId)) {
      return jsonResponse({ error: 'Invalid track ID' }, 400);
    }

    // Read track owner metadata.
    const trackMeta = await readTrackMeta(env.GPX_BUCKET, trackId);
    if (!trackMeta) {
      return jsonResponse({ error: 'Track not found' }, 404);
    }

    // Skip if user already owns this track.
    const index = await readIndex(env.GPX_BUCKET, userId);
    if (index.some((entry) => entry.id === trackId)) {
      return jsonResponse({ ok: true }, 200);
    }

    // Skip if already in shares.
    const shares = await readShares(env.GPX_BUCKET, userId);
    if (shares.some((s) => s.trackId === trackId)) {
      return jsonResponse({ ok: true }, 200);
    }

    if (shares.length >= MAX_SHARES_PER_USER) {
      return jsonResponse({ error: 'Share limit reached' }, 429);
    }

    shares.push({
      trackId,
      sharedBy: trackMeta.owner,
      date: trackMeta.date,
      startLat: trackMeta.startLat,
      startLon: trackMeta.startLon,
      sizeBytes: trackMeta.sizeBytes,
    });
    await writeShares(env.GPX_BUCKET, userId, shares);

    return jsonResponse({ ok: true }, 201);
  }

  // GET /shared-tracks — list tracks shared with the current user.
  if (request.method === 'GET' && path === '/shared-tracks') {
    const shares = await readShares(env.GPX_BUCKET, userId);
    return jsonResponse(shares, 200);
  }

  // DELETE /shared-tracks/{id} — remove a shared track from your list.
  if (request.method === 'DELETE' && path.startsWith('/shared-tracks/') && path.length > '/shared-tracks/'.length) {
    const trackId = path.slice('/shared-tracks/'.length);
    if (!VALID_TRACK_ID.test(trackId)) {
      return jsonResponse({ error: 'Invalid track ID' }, 400);
    }

    const shares = await readShares(env.GPX_BUCKET, userId);
    const newShares = shares.filter((s) => s.trackId !== trackId);
    if (newShares.length === shares.length) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    await writeShares(env.GPX_BUCKET, userId, newShares);
    return new Response(null, { status: 204 });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

export async function handleSettingsRoutes(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  // GET /settings — read user settings.
  if (request.method === 'GET') {
    const obj = await env.GPX_BUCKET.get(`settings/${userId}`);
    if (!obj) return jsonResponse({}, 200);
    return jsonResponse(JSON.parse(await obj.text()), 200);
  }

  // PUT /settings — write user settings.
  if (request.method === 'PUT') {
    const text = await request.text();
    if (text.length > 4096) {
      return jsonResponse({ error: 'Settings too large' }, 400);
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }
    await env.GPX_BUCKET.put(`settings/${userId}`, JSON.stringify(body));
    return new Response(null, { status: 204 });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}
