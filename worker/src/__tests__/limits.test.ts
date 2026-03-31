import { env, exports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { MAX_TRACKS_PER_USER, MAX_TOTAL_STORAGE_BYTES, MAX_MONTHLY_WRITES } from '../handlers';

const SELF = exports.default;

const GPX_TEMPLATE = (i: number) => `<?xml version="1.0"?>
<gpx><trk><trkseg>
<trkpt lat="37.${i}" lon="-122.0"><time>2024-01-01T00:00:00Z</time></trkpt>
</trkseg></trk></gpx>`;

const RAW_USER_ID = '00000000-0000-4000-8000-000000000001';

async function hashUserId(userId: string): Promise<string> {
  const data = new TextEncoder().encode(userId);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function putTrack(gpxText: string, userId = RAW_USER_ID): Promise<Response> {
  return SELF.fetch('https://api.runnerup.win/tracks', {
    method: 'PUT',
    headers: { 'X-User-Id': userId, 'Content-Type': 'text/xml' },
    body: gpxText,
  });
}

async function deleteAllTracks(userId = RAW_USER_ID): Promise<Response> {
  return SELF.fetch('https://api.runnerup.win/tracks', {
    method: 'DELETE',
    headers: { 'X-User-Id': userId },
  });
}

async function getStats(): Promise<{ totalBytes: number; writeCount: number; month: string } | null> {
  const obj = await env.GPX_BUCKET.get('_stats');
  if (!obj) return null;
  return JSON.parse(await obj.text());
}

async function setStats(stats: { totalBytes: number; writeCount: number; month: string }): Promise<void> {
  await env.GPX_BUCKET.put('_stats', JSON.stringify(stats));
}

async function seedIndex(rawUserId: string, count: number): Promise<void> {
  const hashedId = await hashUserId(rawUserId);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const id = i.toString(16).padStart(32, '0');
    entries.push({ id, date: null, startLat: null, startLon: null });
  }
  await env.GPX_BUCKET.put(`index/${hashedId}`, JSON.stringify(entries));
}

// Clean up R2 between tests.
async function clearBucket(): Promise<void> {
  const listed = await env.GPX_BUCKET.list();
  if (listed.objects.length > 0) {
    await Promise.all(listed.objects.map((obj) => env.GPX_BUCKET.delete(obj.key)));
  }
}

describe('Rate limits', () => {
  beforeEach(async () => {
    await clearBucket();
  });

  describe('per-user track limit', () => {
    it('rejects upload when user has MAX_TRACKS_PER_USER tracks', async () => {
      await seedIndex(RAW_USER_ID, MAX_TRACKS_PER_USER);

      const res = await putTrack(GPX_TEMPLATE(9999));
      expect(res.status).toBe(429);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Track limit reached');
    });

    it('allows upload when user has fewer than MAX_TRACKS_PER_USER tracks', async () => {
      await seedIndex(RAW_USER_ID, MAX_TRACKS_PER_USER - 1);

      const res = await putTrack(GPX_TEMPLATE(9999));
      expect(res.status).toBe(201);
    });
  });

  describe('global storage limit', () => {
    it('rejects upload when total storage would exceed limit', async () => {
      const currentMonth = new Date().toISOString().slice(0, 7);
      await setStats({
        totalBytes: MAX_TOTAL_STORAGE_BYTES - 10,
        writeCount: 0,
        month: currentMonth,
      });

      const res = await putTrack(GPX_TEMPLATE(1));
      expect(res.status).toBe(507);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Storage limit reached');
    });

    it('allows upload when total storage is under limit', async () => {
      const currentMonth = new Date().toISOString().slice(0, 7);
      await setStats({
        totalBytes: 0,
        writeCount: 0,
        month: currentMonth,
      });

      const res = await putTrack(GPX_TEMPLATE(1));
      expect(res.status).toBe(201);
    });
  });

  describe('monthly write limit', () => {
    it('rejects upload when monthly writes are exhausted', async () => {
      const currentMonth = new Date().toISOString().slice(0, 7);
      await setStats({
        totalBytes: 0,
        writeCount: MAX_MONTHLY_WRITES,
        month: currentMonth,
      });

      const res = await putTrack(GPX_TEMPLATE(1));
      expect(res.status).toBe(429);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Monthly write limit reached');
    });

    it('resets write count but preserves totalBytes when month rolls over', async () => {
      await setStats({
        totalBytes: 5000,
        writeCount: MAX_MONTHLY_WRITES,
        month: '2020-01',
      });

      const res = await putTrack(GPX_TEMPLATE(1));
      expect(res.status).toBe(201);

      const stats = await getStats();
      expect(stats).not.toBeNull();
      const currentMonth = new Date().toISOString().slice(0, 7);
      expect(stats!.month).toBe(currentMonth);
      expect(stats!.writeCount).toBe(1);
      // totalBytes should be preserved from prior month plus the new upload.
      expect(stats!.totalBytes).toBeGreaterThan(5000);
    });

    it('still enforces storage limit after month rollover', async () => {
      await setStats({
        totalBytes: MAX_TOTAL_STORAGE_BYTES - 10,
        writeCount: MAX_MONTHLY_WRITES,
        month: '2020-01',
      });

      const res = await putTrack(GPX_TEMPLATE(1));
      expect(res.status).toBe(507);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Storage limit reached');
    });
  });

  describe('stats tracking', () => {
    it('increments totalBytes and writeCount on upload', async () => {
      const res = await putTrack(GPX_TEMPLATE(1));
      expect(res.status).toBe(201);

      const stats = await getStats();
      expect(stats).not.toBeNull();
      expect(stats!.writeCount).toBe(1);
      expect(stats!.totalBytes).toBeGreaterThan(0);

      const firstBytes = stats!.totalBytes;

      const res2 = await putTrack(GPX_TEMPLATE(2));
      expect(res2.status).toBe(201);

      const stats2 = await getStats();
      expect(stats2!.writeCount).toBe(2);
      expect(stats2!.totalBytes).toBeGreaterThan(firstBytes);
    });

    it('decrements totalBytes on single track delete', async () => {
      const res = await putTrack(GPX_TEMPLATE(1));
      const { id } = await res.json() as { id: string };

      const statsBefore = await getStats();
      expect(statsBefore!.totalBytes).toBeGreaterThan(0);

      const delRes = await SELF.fetch(`https://api.runnerup.win/tracks/${id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': RAW_USER_ID },
      });
      expect(delRes.status).toBe(204);

      const statsAfter = await getStats();
      expect(statsAfter!.totalBytes).toBe(0);
    });

    it('decrements totalBytes on delete-all', async () => {
      await putTrack(GPX_TEMPLATE(1));
      await putTrack(GPX_TEMPLATE(2));

      const statsBefore = await getStats();
      expect(statsBefore!.totalBytes).toBeGreaterThan(0);

      const delRes = await deleteAllTracks();
      expect(delRes.status).toBe(204);

      const statsAfter = await getStats();
      expect(statsAfter!.totalBytes).toBe(0);
    });

    it('does not increment writeCount for duplicate upload', async () => {
      const gpx = GPX_TEMPLATE(1);
      const res1 = await putTrack(gpx);
      expect(res1.status).toBe(201);

      const res2 = await putTrack(gpx);
      expect(res2.status).toBe(200);

      const stats = await getStats();
      expect(stats!.writeCount).toBe(1);
    });
  });
});
