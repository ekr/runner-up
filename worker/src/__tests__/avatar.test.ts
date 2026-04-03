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

async function register(username: string, password: string): Promise<string> {
  const res = await SELF.fetch('https://api.runnerup.win/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, inviteCode: INVITE_CODE }),
  });
  const body = await res.json() as { token: string };
  return body.token;
}

// Minimal valid 1x1 PNG (67 bytes).
const TINY_PNG = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
), c => c.charCodeAt(0));

// Minimal valid 1x1 JPEG.
const TINY_JPEG = Uint8Array.from(atob(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYI4Q/SFhSRJFiF0VVNnRl4vKzhsp/xAAZAQADAQEBAAAAAAAAAAAAAAAAAQIDBAX/xAAjEQACAgEDBAMBAAAAAAAAAAAAAQIRAxIhMQRBUWHwEyJx/9oADAMBAAIRAxEAPwC1RRRQAf/Z'
), c => c.charCodeAt(0));

describe('Avatar', () => {
  beforeEach(async () => {
    await clearBucket();
  });

  describe('upload and retrieval', () => {
    it('uploads a PNG avatar and retrieves it with correct bytes', async () => {
      const token = await register('alice', 'password123');

      const putRes = await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'image/png',
        },
        body: TINY_PNG,
      });
      expect(putRes.status).toBe(204);

      const getRes = await SELF.fetch('https://api.runnerup.win/avatar/alice');
      expect(getRes.status).toBe(200);
      expect(getRes.headers.get('Content-Type')).toBe('image/png');

      const body = new Uint8Array(await getRes.arrayBuffer());
      expect(body).toEqual(TINY_PNG);
    });

    it('uploads a JPEG avatar and retrieves it with correct content-type', async () => {
      const token = await register('alice', 'password123');

      const putRes = await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'image/jpeg',
        },
        body: TINY_JPEG,
      });
      expect(putRes.status).toBe(204);

      const getRes = await SELF.fetch('https://api.runnerup.win/avatar/alice');
      expect(getRes.status).toBe(200);
      expect(getRes.headers.get('Content-Type')).toBe('image/jpeg');

      const body = new Uint8Array(await getRes.arrayBuffer());
      expect(body).toEqual(TINY_JPEG);
    });

    it('stores avatar keyed by username in R2', async () => {
      const token = await register('alice', 'password123');

      await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'image/png',
        },
        body: TINY_PNG,
      });

      // Verify the avatar is stored at the expected R2 key.
      const obj = await env.GPX_BUCKET.get('avatar/alice');
      expect(obj).not.toBeNull();
      const stored = new Uint8Array(await obj!.arrayBuffer());
      expect(stored).toEqual(TINY_PNG);
      expect(obj!.httpMetadata?.contentType).toBe('image/png');
    });

    it('replaces an existing avatar on re-upload', async () => {
      const token = await register('alice', 'password123');

      // Upload PNG first.
      await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'image/png',
        },
        body: TINY_PNG,
      });

      // Replace with JPEG.
      await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'image/jpeg',
        },
        body: TINY_JPEG,
      });

      const getRes = await SELF.fetch('https://api.runnerup.win/avatar/alice');
      expect(getRes.status).toBe(200);
      expect(getRes.headers.get('Content-Type')).toBe('image/jpeg');
      const body = new Uint8Array(await getRes.arrayBuffer());
      expect(body).toEqual(TINY_JPEG);
    });

    it('returns Cache-Control header on GET', async () => {
      const token = await register('alice', 'password123');

      await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'image/png',
        },
        body: TINY_PNG,
      });

      const getRes = await SELF.fetch('https://api.runnerup.win/avatar/alice');
      expect(getRes.headers.get('Cache-Control')).toBe('public, max-age=3600');
    });
  });

  describe('validation', () => {
    it('rejects upload without auth', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: TINY_PNG,
      });
      expect(res.status).toBe(401);
    });

    it('rejects upload with wrong content type', async () => {
      const token = await register('alice', 'password123');
      const res = await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
        body: 'not an image',
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('Content-Type');
    });

    it('rejects upload with empty body', async () => {
      const token = await register('alice', 'password123');
      const res = await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'image/png',
        },
        body: new Uint8Array(0),
      });
      expect(res.status).toBe(400);
    });

    it('rejects upload over 1MB', async () => {
      const token = await register('alice', 'password123');
      const bigBody = new Uint8Array(1_048_577); // 1 byte over
      const res = await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'image/png',
        },
        body: bigBody,
      });
      expect(res.status).toBe(413);
    });

    it('rejects GET with invalid username format', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/avatar/../../secrets');
      expect(res.status).toBe(404);
    });
  });

  describe('GET not found cases', () => {
    it('returns 404 for user with no avatar', async () => {
      await register('alice', 'password123');
      const res = await SELF.fetch('https://api.runnerup.win/avatar/alice');
      expect(res.status).toBe(404);
    });

    it('returns 404 for nonexistent username', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/avatar/nobody');
      expect(res.status).toBe(404);
    });
  });

  describe('deletion', () => {
    it('deletes an uploaded avatar', async () => {
      const token = await register('alice', 'password123');

      await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'image/png',
        },
        body: TINY_PNG,
      });

      const delRes = await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect(delRes.status).toBe(204);

      // Verify it's gone from R2.
      const obj = await env.GPX_BUCKET.get('avatar/alice');
      expect(obj).toBeNull();

      // Verify GET returns 404.
      const getRes = await SELF.fetch('https://api.runnerup.win/avatar/alice');
      expect(getRes.status).toBe(404);
    });

    it('delete is idempotent when no avatar exists', async () => {
      const token = await register('alice', 'password123');
      const res = await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect(res.status).toBe(204);
    });

    it('rejects delete without auth', async () => {
      const res = await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('account deletion', () => {
    it('removes avatar when account is deleted', async () => {
      const token = await register('alice', 'password123');

      await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'image/png',
        },
        body: TINY_PNG,
      });

      // Verify avatar exists in R2.
      expect(await env.GPX_BUCKET.get('avatar/alice')).not.toBeNull();

      // Delete account.
      await SELF.fetch('https://api.runnerup.win/auth/account', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: 'password123' }),
      });

      // Avatar should be gone from R2.
      expect(await env.GPX_BUCKET.get('avatar/alice')).toBeNull();

      // GET should return 404.
      const after = await SELF.fetch('https://api.runnerup.win/avatar/alice');
      expect(after.status).toBe(404);
    });
  });

  describe('user isolation', () => {
    it('users cannot see each other\'s avatars by uploading', async () => {
      const aliceToken = await register('alice', 'password123');
      const bobToken = await register('bob-user', 'password123');

      // Alice uploads an avatar.
      await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${aliceToken}`,
          'Content-Type': 'image/png',
        },
        body: TINY_PNG,
      });

      // Bob uploads a different avatar.
      await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${bobToken}`,
          'Content-Type': 'image/jpeg',
        },
        body: TINY_JPEG,
      });

      // Each user's avatar is distinct.
      const aliceGet = await SELF.fetch('https://api.runnerup.win/avatar/alice');
      expect(aliceGet.headers.get('Content-Type')).toBe('image/png');
      expect(new Uint8Array(await aliceGet.arrayBuffer())).toEqual(TINY_PNG);

      const bobGet = await SELF.fetch('https://api.runnerup.win/avatar/bob-user');
      expect(bobGet.headers.get('Content-Type')).toBe('image/jpeg');
      expect(new Uint8Array(await bobGet.arrayBuffer())).toEqual(TINY_JPEG);

      // Deleting Alice's avatar doesn't affect Bob's.
      await SELF.fetch('https://api.runnerup.win/avatar', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${aliceToken}` },
      });

      const aliceAfter = await SELF.fetch('https://api.runnerup.win/avatar/alice');
      expect(aliceAfter.status).toBe(404);

      const bobAfter = await SELF.fetch('https://api.runnerup.win/avatar/bob-user');
      expect(bobAfter.status).toBe(200);
    });
  });
});
