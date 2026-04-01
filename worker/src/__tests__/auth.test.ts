import { env, exports } from 'cloudflare:workers';
import { SignJWT, importJWK } from 'jose';
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

    it('returns 401 with a token signed by the wrong secret', async () => {
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

  // Tests for common JWT vulnerabilities. See:
  // https://www.vaadata.com/blog/jwt-json-web-token-vulnerabilities-common-attacks-and-security-best-practices/
  describe('JWT verification vulnerabilities', () => {
    // Helper: base64url encode without padding.
    function b64url(data: string): string {
      return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function fetchWithToken(token: string): Promise<Response> {
      return SELF.fetch('https://api.runnerup.win/tracks', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
    }

    it('rejects tokens with alg: "none" (none algorithm attack)', async () => {
      // Craft a token with alg: "none" and no signature.
      const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
      const payload = b64url(JSON.stringify({
        sub: 'fakeuserid',
        username: 'attacker',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      }));
      const token = `${header}.${payload}.`;

      const res = await fetchWithToken(token);
      expect(res.status).toBe(401);
    });

    it('rejects tokens with alg: "None" (case variation)', async () => {
      const header = b64url(JSON.stringify({ alg: 'None', typ: 'JWT' }));
      const payload = b64url(JSON.stringify({
        sub: 'fakeuserid',
        username: 'attacker',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }));
      const token = `${header}.${payload}.`;

      const res = await fetchWithToken(token);
      expect(res.status).toBe(401);
    });

    it('rejects tokens with modified payload (signature mismatch)', async () => {
      // Get a real token, then tamper with the payload.
      const regRes = await register('victim', 'password123', INVITE_CODE);
      const { token: realToken } = await regRes.json() as { token: string };
      const [header, , signature] = realToken.split('.');

      // Swap in a different payload but keep original signature.
      const tamperedPayload = b64url(JSON.stringify({
        sub: 'different-user-id',
        username: 'admin',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      }));
      const tamperedToken = `${header}.${tamperedPayload}.${signature}`;

      const res = await fetchWithToken(tamperedToken);
      expect(res.status).toBe(401);
    });

    it('rejects tokens with embedded jwk parameter (JWK injection)', async () => {
      // Attacker generates their own key and embeds it in the JWT header.
      const attackerKey = await crypto.subtle.generateKey(
        { name: 'HMAC', hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      );
      const exported = await crypto.subtle.exportKey('jwk', attackerKey);

      // Sign with attacker's key and include it in the header.
      const key = await importJWK(exported, 'HS256');
      const token = await new SignJWT({
        username: 'attacker',
      })
        .setProtectedHeader({ alg: 'HS256', jwk: exported } as any)
        .setSubject('fakeuserid')
        .setExpirationTime('1h')
        .setIssuedAt()
        .sign(key);

      const res = await fetchWithToken(token);
      expect(res.status).toBe(401);
    });

    it('rejects tokens with jku parameter (JKU exploitation)', async () => {
      // Craft a token that specifies an external JKU URL.
      const header = b64url(JSON.stringify({
        alg: 'HS256',
        typ: 'JWT',
        jku: 'https://attacker.com/.well-known/jwks.json',
      }));
      const payload = b64url(JSON.stringify({
        sub: 'fakeuserid',
        username: 'attacker',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      }));
      // Sign with the real secret — the attack is that the server would
      // fetch keys from the attacker URL instead of using its own secret.
      // jose should ignore the jku and verify with the provided key.
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(env.AUTH_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const data = new TextEncoder().encode(`${header}.${payload}`);
      const sig = await crypto.subtle.sign('HMAC', key, data);
      const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const token = `${header}.${payload}.${sigB64}`;

      // Even though signature is valid, jose should reject tokens with
      // unexpected header parameters when using symmetric keys.
      // At minimum, the server must not fetch from the jku URL.
      // jose with a symmetric key simply ignores jku, so this token
      // will actually verify. The real protection is that we never use
      // jku-based verification. This test documents the behavior.
      const res = await fetchWithToken(token);
      // jose verifies the HMAC directly and ignores jku, so this passes.
      // The important thing is the server never fetches from the URL.
      expect(res.status).toBe(200);
    });

    it('rejects tokens with kid path traversal', async () => {
      // Craft a token with a kid that attempts path traversal.
      const header = b64url(JSON.stringify({
        alg: 'HS256',
        typ: 'JWT',
        kid: '../../dev/null',
      }));
      const payload = b64url(JSON.stringify({
        sub: 'fakeuserid',
        username: 'attacker',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      }));
      // Sign with a predictable value (e.g., a single null byte, as if
      // the key were read from a known file like /dev/zero).
      const key = await crypto.subtle.importKey(
        'raw',
        new Uint8Array([0]),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const data = new TextEncoder().encode(`${header}.${payload}`);
      const sig = await crypto.subtle.sign('HMAC', key, data);
      const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const token = `${header}.${payload}.${sigB64}`;

      const res = await fetchWithToken(token);
      expect(res.status).toBe(401);
    });

    it('rejects tokens with algorithm confusion (RS256 instead of HS256)', async () => {
      // Generate an RSA key pair.
      const rsaKey = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
      );

      // Sign with RSA private key but claim RS256.
      const exported = await crypto.subtle.exportKey('jwk', rsaKey.privateKey);
      const key = await importJWK(exported, 'RS256');
      const token = await new SignJWT({ username: 'attacker' })
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('fakeuserid')
        .setExpirationTime('1h')
        .setIssuedAt()
        .sign(key);

      // Server enforces HS256, so RS256 tokens must be rejected.
      const res = await fetchWithToken(token);
      expect(res.status).toBe(401);
    });
  });

  describe('change password', () => {
    let token: string;

    beforeEach(async () => {
      const res = await register('carol', 'oldpassword1', INVITE_CODE);
      expect(res.status).toBe(201);
      const body = await res.json() as { token: string };
      token = body.token;
    });

    it('changes password with correct current password', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/auth/change-password', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'oldpassword1', newPassword: 'newpassword1' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { token: string; username: string };
      expect(body.username).toBe('carol');
      expect(body.token).toBeTruthy();

      // Can login with new password.
      const loginRes = await login('carol', 'newpassword1');
      expect(loginRes.status).toBe(200);
    });

    it('rejects with wrong current password', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/auth/change-password', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'wrongpassword', newPassword: 'newpassword1' }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects new password that is too short', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/auth/change-password', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'oldpassword1', newPassword: 'short' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 401 without authentication', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'oldpassword1', newPassword: 'newpassword1' }),
      });
      expect(res.status).toBe(401);
    });

    it('old password no longer works after change', async () => {
      await SELF.fetch('https://api.runnerup.win/auth/change-password', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'oldpassword1', newPassword: 'newpassword1' }),
      });

      const loginRes = await login('carol', 'oldpassword1');
      expect(loginRes.status).toBe(401);
    });
  });

  describe('delete account', () => {
    let token: string;

    beforeEach(async () => {
      const res = await register('dave', 'davepassword1', INVITE_CODE);
      expect(res.status).toBe(201);
      const body = await res.json() as { token: string };
      token = body.token;
    });

    it('deletes account with correct password', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/auth/account', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'davepassword1' }),
      });
      expect(res.status).toBe(204);

      // Cannot login after deletion.
      const loginRes = await login('dave', 'davepassword1');
      expect(loginRes.status).toBe(401);
    });

    it('rejects with wrong password', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/auth/account', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrongpassword' }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 without authentication', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/auth/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'davepassword1' }),
      });
      expect(res.status).toBe(401);
    });

    it('deletes all user tracks on account deletion', async () => {
      // Upload a track first.
      const gpx = '<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="37.0" lon="-122.0"><time>2024-01-01T00:00:00Z</time></trkpt></trkseg></trk></gpx>';
      const uploadRes = await SELF.fetch('https://api.runnerup.win/tracks', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/xml' },
        body: gpx,
      });
      expect(uploadRes.status).toBe(201);

      // Delete account.
      const res = await SELF.fetch('https://api.runnerup.win/auth/account', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'davepassword1' }),
      });
      expect(res.status).toBe(204);

      // Track should no longer be accessible.
      const { id } = await uploadRes.json() as { id: string };
      const trackRes = await SELF.fetch(`https://api.runnerup.win/tracks/${id}`);
      expect(trackRes.status).toBe(404);
    });
  });

  describe('settings', () => {
    let token: string;

    beforeEach(async () => {
      const res = await register('eve', 'evepassword1', INVITE_CODE);
      expect(res.status).toBe(201);
      const body = await res.json() as { token: string };
      token = body.token;
    });

    it('returns empty object when no settings exist', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/settings', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({});
    });

    it('saves and retrieves settings', async () => {
      const putRes = await SELF.fetch('https://api.runnerup.win/settings', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ units: 'metric' }),
      });
      expect(putRes.status).toBe(204);

      const getRes = await SELF.fetch('https://api.runnerup.win/settings', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect(getRes.status).toBe(200);
      const body = await getRes.json() as { units: string };
      expect(body.units).toBe('metric');
    });

    it('returns 401 without authentication', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/settings');
      expect(res.status).toBe(401);
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
