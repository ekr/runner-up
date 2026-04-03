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

describe('Avatar', () => {
  beforeEach(async () => {
    await clearBucket();
  });

  it('uploads and retrieves an avatar', async () => {
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
    expect(body.length).toBe(TINY_PNG.length);
  });

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

  it('returns 404 for nonexistent user avatar', async () => {
    const res = await SELF.fetch('https://api.runnerup.win/avatar/nobody');
    expect(res.status).toBe(404);
  });

  it('returns 404 for user with no avatar', async () => {
    await register('alice', 'password123');
    const res = await SELF.fetch('https://api.runnerup.win/avatar/alice');
    expect(res.status).toBe(404);
  });

  it('deletes an avatar', async () => {
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

  it('account deletion removes avatar', async () => {
    const token = await register('alice', 'password123');

    await SELF.fetch('https://api.runnerup.win/avatar', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'image/png',
      },
      body: TINY_PNG,
    });

    // Verify avatar exists.
    const before = await SELF.fetch('https://api.runnerup.win/avatar/alice');
    expect(before.status).toBe(200);

    // Delete account.
    await SELF.fetch('https://api.runnerup.win/auth/account', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: 'password123' }),
    });

    // Avatar should be gone.
    const after = await SELF.fetch('https://api.runnerup.win/avatar/alice');
    expect(after.status).toBe(404);
  });
});
