import { env, exports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';

const SELF = exports.default;
const INVITE_CODE = 'test-invite';

async function clearBucket(): Promise<void> {
  const listed = await env.GPX_BUCKET.list();
  if (listed.objects.length > 0) {
    await Promise.all(listed.objects.map((obj) => env.GPX_BUCKET.delete(obj.key)));
  }
}

async function register(username: string, password: string): Promise<{ token: string; username: string }> {
  const res = await SELF.fetch('https://api.runnerup.win/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, inviteCode: INVITE_CODE }),
  });
  expect(res.status).toBe(201);
  return res.json() as Promise<{ token: string; username: string }>;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const SAMPLE_GPX = `<?xml version="1.0"?>
<gpx><trk><trkseg>
<trkpt lat="37.7749" lon="-122.4194"><time>2024-01-15T10:00:00Z</time></trkpt>
<trkpt lat="37.7750" lon="-122.4195"><time>2024-01-15T10:01:00Z</time></trkpt>
</trkseg></trk></gpx>`;

async function uploadTrack(token: string, gpxText: string = SAMPLE_GPX): Promise<string> {
  const res = await SELF.fetch('https://api.runnerup.win/tracks', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/xml' },
    body: gpxText,
  });
  expect(res.status === 200 || res.status === 201).toBe(true);
  const body = await res.json() as { id: string };
  return body.id;
}

async function addSharedTrack(token: string, trackId: string): Promise<Response> {
  return SELF.fetch('https://api.runnerup.win/shared-tracks', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ trackId }),
  });
}

async function getSharedTracks(token: string): Promise<Response> {
  return SELF.fetch('https://api.runnerup.win/shared-tracks', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function removeSharedTrack(token: string, trackId: string): Promise<Response> {
  return SELF.fetch(`https://api.runnerup.win/shared-tracks/${trackId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('Track Sharing', () => {
  beforeEach(async () => {
    await clearBucket();
  });

  it('auto-saves a viewed track to shared list with owner info', async () => {
    const alice = await register('alice', 'password123');
    const bob = await register('bob-user', 'password123');

    const trackId = await uploadTrack(alice.token);

    // Bob views the track and saves it to shared list.
    const res = await addSharedTrack(bob.token, trackId);
    expect(res.status).toBe(201);

    // Bob's shared tracks list should include the track with alice as owner.
    const listRes = await getSharedTracks(bob.token);
    expect(listRes.status).toBe(200);
    const shares = await listRes.json() as Array<{ trackId: string; sharedBy: string; date: string | null }>;
    expect(shares).toHaveLength(1);
    expect(shares[0].trackId).toBe(trackId);
    expect(shares[0].sharedBy).toBe('alice');
    expect(shares[0].date).toBe('2024-01-15T10:00:00Z');
  });

  it('returns empty list when no tracks shared', async () => {
    const alice = await register('alice', 'password123');
    const res = await getSharedTracks(alice.token);
    expect(res.status).toBe(200);
    const shares = await res.json();
    expect(shares).toEqual([]);
  });

  it('skips silently if user already owns the track', async () => {
    const alice = await register('alice', 'password123');
    const trackId = await uploadTrack(alice.token);

    // Alice tries to add her own track to shared list — should be a no-op.
    const res = await addSharedTrack(alice.token, trackId);
    expect(res.status).toBe(200);

    const listRes = await getSharedTracks(alice.token);
    const shares = await listRes.json();
    expect(shares).toEqual([]);
  });

  it('skips silently if track already in shared list', async () => {
    const alice = await register('alice', 'password123');
    const bob = await register('bob-user', 'password123');
    const trackId = await uploadTrack(alice.token);

    const res1 = await addSharedTrack(bob.token, trackId);
    expect(res1.status).toBe(201);

    // Adding again should be a no-op.
    const res2 = await addSharedTrack(bob.token, trackId);
    expect(res2.status).toBe(200);

    const listRes = await getSharedTracks(bob.token);
    const shares = await listRes.json() as Array<{ trackId: string }>;
    expect(shares).toHaveLength(1);
  });

  it('returns 404 for non-existent track', async () => {
    const alice = await register('alice', 'password123');
    const res = await addSharedTrack(alice.token, 'a'.repeat(32));
    expect(res.status).toBe(404);
  });

  it('removes a shared track from your list', async () => {
    const alice = await register('alice', 'password123');
    const bob = await register('bob-user', 'password123');
    const trackId = await uploadTrack(alice.token);

    await addSharedTrack(bob.token, trackId);

    const delRes = await removeSharedTrack(bob.token, trackId);
    expect(delRes.status).toBe(204);

    const listRes = await getSharedTracks(bob.token);
    const shares = await listRes.json();
    expect(shares).toEqual([]);
  });

  it('returns 404 when removing a non-existent shared track', async () => {
    const alice = await register('alice', 'password123');
    const res = await removeSharedTrack(alice.token, 'a'.repeat(32));
    expect(res.status).toBe(404);
  });

  it('GET /tracks/{id} includes owner', async () => {
    const alice = await register('alice', 'password123');
    const trackId = await uploadTrack(alice.token);

    // Public fetch (no auth needed).
    const res = await SELF.fetch(`https://api.runnerup.win/tracks/${trackId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; data: string; owner: string };
    expect(body.owner).toBe('alice');
  });

  it('requires authentication for all share endpoints', async () => {
    const res1 = await SELF.fetch('https://api.runnerup.win/shared-tracks');
    expect(res1.status).toBe(401);

    const res2 = await SELF.fetch(`https://api.runnerup.win/shared-tracks/${'a'.repeat(32)}`, {
      method: 'DELETE',
    });
    expect(res2.status).toBe(401);

    const res3 = await SELF.fetch('https://api.runnerup.win/shared-tracks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId: 'a'.repeat(32) }),
    });
    expect(res3.status).toBe(401);
  });

  it('deleting account removes shares list', async () => {
    const alice = await register('alice', 'password123');
    const bob = await register('bob-user', 'password123');
    const trackId = await uploadTrack(alice.token);
    await addSharedTrack(bob.token, trackId);

    // Delete bob's account.
    const delRes = await SELF.fetch('https://api.runnerup.win/auth/account', {
      method: 'DELETE',
      headers: authHeaders(bob.token),
      body: JSON.stringify({ password: 'password123' }),
    });
    expect(delRes.status).toBe(204);

    // Re-register bob (new userId, old shares orphaned).
    const bob2 = await register('bob-user', 'password123');
    const listRes = await getSharedTracks(bob2.token);
    const shares = await listRes.json();
    expect(shares).toEqual([]);
  });

  it('deleting a track also removes its track-meta', async () => {
    const alice = await register('alice', 'password123');
    const trackId = await uploadTrack(alice.token);

    // Verify track-meta exists.
    const metaBefore = await env.GPX_BUCKET.get(`track-meta/${trackId}`);
    expect(metaBefore).not.toBeNull();

    // Delete the track.
    const res = await SELF.fetch(`https://api.runnerup.win/tracks/${trackId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    expect(res.status).toBe(204);

    // track-meta should be gone.
    const metaAfter = await env.GPX_BUCKET.get(`track-meta/${trackId}`);
    expect(metaAfter).toBeNull();
  });
});
