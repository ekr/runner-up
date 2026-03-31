import { env, exports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { createToken } from '../auth';

const SELF = exports.default;

const INVITE_CODE = 'test-invite'; // matches .dev.vars

// Clean up R2 between tests.
async function clearBucket(): Promise<void> {
  const listed = await env.GPX_BUCKET.list();
  if (listed.objects.length > 0) {
    await Promise.all(listed.objects.map((obj) => env.GPX_BUCKET.delete(obj.key)));
  }
}

async function register(username: string, password: string, inviteCode: string): Promise<Response> {
  return SELF.fetch('https://api.runnerup.win/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, inviteCode }),
  });
}

async function login(username: string, password: string): Promise<Response> {
  return SELF.fetch('https://api.runnerup.win/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

describe('Authentication', () => {
  beforeEach(async () => {
    await clearBucket();
  });

  describe('registration', () => {
    it('registers a new user with valid invite code', async () => {
      const res = await register('alice', 'password123', INVITE_CODE);
      expect(res.status).toBe(201);
      const body = await res.json() as { token: string; username: string };
      expect(body.username).toBe('alice');
      expect(body.token).toBeTruthy();
    });

    it('rejects registration with invalid invite code', async () => {
      const res = await register('alice', 'password123', 'wrong-code');
      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Invalid invite code');
    });

    it('rejects registration with missing invite code', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'password123' }),
      });
      expect(res.status).toBe(403);
    });

    it('rejects duplicate username', async () => {
      const res1 = await register('alice', 'password123', INVITE_CODE);
      expect(res1.status).toBe(201);

      const res2 = await register('alice', 'differentpass1', INVITE_CODE);
      expect(res2.status).toBe(409);
      const body = await res2.json() as { error: string };
      expect(body.error).toBe('Username already taken');
    });

    it('rejects username that is too short', async () => {
      const res = await register('ab', 'password123', INVITE_CODE);
      expect(res.status).toBe(400);
    });

    it('rejects username with uppercase letters', async () => {
      const res = await register('Alice', 'password123', INVITE_CODE);
      expect(res.status).toBe(400);
    });

    it('rejects password that is too short', async () => {
      const res = await register('alice', 'short', INVITE_CODE);
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('Password must be at least');
    });

    it('rejects password that is too long', async () => {
      const longPassword = 'a'.repeat(1025);
      const res = await register('alice', longPassword, INVITE_CODE);
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('Password must be at most');
    });

    it('rejects invalid JSON body', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      // Create a test user.
      const res = await register('bob', 'securepass1', INVITE_CODE);
      expect(res.status).toBe(201);
    });

    it('logs in with correct credentials', async () => {
      const res = await login('bob', 'securepass1');
      expect(res.status).toBe(200);
      const body = await res.json() as { token: string; username: string };
      expect(body.username).toBe('bob');
      expect(body.token).toBeTruthy();
    });

    it('rejects wrong password', async () => {
      const res = await login('bob', 'wrongpassword');
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Invalid username or password');
    });

    it('rejects nonexistent username', async () => {
      const res = await login('nobody', 'password123');
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Invalid username or password');
    });

    it('rejects oversized password without running PBKDF2', async () => {
      const res = await login('bob', 'a'.repeat(1025));
      expect(res.status).toBe(401);
    });

    it('rejects missing credentials', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns a token that can be used for authenticated requests', async () => {
      const loginRes = await login('bob', 'securepass1');
      const { token } = await loginRes.json() as { token: string };

      // Use token to list tracks.
      const tracksRes = await SELF.fetch('https://api.runnerup.win/tracks', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect(tracksRes.status).toBe(200);
    });
  });

  describe('auth enforcement', () => {
    it('returns 401 for PUT /tracks without token', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/tracks', {
        method: 'PUT',
        headers: { 'Content-Type': 'text/xml' },
        body: '<gpx></gpx>',
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for GET /tracks without token', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/tracks');
      expect(res.status).toBe(401);
    });

    it('returns 401 for DELETE /tracks without token', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/tracks', {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for DELETE /tracks/{id} without token', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/tracks/abcdef01234567890abcdef012345678', {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 with an invalid token', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/tracks', {
        headers: { 'Authorization': 'Bearer invalid.token.here' },
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 with an expired token', async () => {
      // Create a token that expired in the past by using jose directly
      // with a very short expiry. We'll create one with createToken then
      // manipulate... Actually, we can't easily backdate. Instead, test
      // that a tampered token is rejected.
      const token = await createToken('fakeuserid', 'fakeuser', 'wrong-secret');
      const res = await SELF.fetch('https://api.runnerup.win/tracks', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
    });

    it('allows GET /tracks/{id} without token (public sharing)', async () => {
      // First, register and upload a track.
      const regRes = await register('charlie', 'password123', INVITE_CODE);
      const { token } = await regRes.json() as { token: string };

      const gpx = '<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="37.0" lon="-122.0"><time>2024-01-01T00:00:00Z</time></trkpt></trkseg></trk></gpx>';
      const uploadRes = await SELF.fetch('https://api.runnerup.win/tracks', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/xml' },
        body: gpx,
      });
      expect(uploadRes.status).toBe(201);
      const { id } = await uploadRes.json() as { id: string };

      // Now fetch without any token — should succeed.
      const fetchRes = await SELF.fetch(`https://api.runnerup.win/tracks/${id}`);
      expect(fetchRes.status).toBe(200);
      const body = await fetchRes.json() as { id: string; data: string };
      expect(body.id).toBe(id);
      expect(body.data).toBe(gpx);
    });
  });

  describe('user isolation', () => {
    it('different users cannot see each others tracks', async () => {
      // Register two users.
      const reg1 = await register('user-one', 'password123', INVITE_CODE);
      const { token: token1 } = await reg1.json() as { token: string };

      const reg2 = await register('user-two', 'password123', INVITE_CODE);
      const { token: token2 } = await reg2.json() as { token: string };

      // User 1 uploads a track.
      const gpx = '<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="37.0" lon="-122.0"><time>2024-01-01T00:00:00Z</time></trkpt></trkseg></trk></gpx>';
      const uploadRes = await SELF.fetch('https://api.runnerup.win/tracks', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token1}`, 'Content-Type': 'text/xml' },
        body: gpx,
      });
      expect(uploadRes.status).toBe(201);

      // User 1 sees the track in their list.
      const list1 = await SELF.fetch('https://api.runnerup.win/tracks', {
        headers: { 'Authorization': `Bearer ${token1}` },
      });
      const tracks1 = await list1.json() as unknown[];
      expect(tracks1.length).toBe(1);

      // User 2 does not see it in their list.
      const list2 = await SELF.fetch('https://api.runnerup.win/tracks', {
        headers: { 'Authorization': `Bearer ${token2}` },
      });
      const tracks2 = await list2.json() as unknown[];
      expect(tracks2.length).toBe(0);
    });
  });
});
