import type { Env } from './index';

// PBKDF2 parameters.
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

// Token expiry: 30 days in seconds.
const TOKEN_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

// Username: lowercase alphanumeric + hyphens, 3-30 chars.
const VALID_USERNAME = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const MIN_PASSWORD_LENGTH = 8;

interface UserRecord {
  username: string;
  passwordHash: string; // hex
  salt: string; // hex
  userId: string; // hashed UUID (64-char hex), used as R2 key prefix
}

interface TokenPayload {
  sub: string; // userId (hashed)
  username: string;
  exp: number; // Unix timestamp
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Generate a random salt.
function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

// Hash a password with PBKDF2-SHA256.
async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_BYTES * 8,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Base64url encode (no padding).
function base64urlEncode(data: Uint8Array): string {
  const binStr = [...data].map((b) => String.fromCharCode(b)).join('');
  return btoa(binStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Base64url decode.
function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (str.length % 4)) % 4);
  const binStr = atob(padded);
  return new Uint8Array([...binStr].map((c) => c.charCodeAt(0)));
}

// Create an HMAC-signed token.
export async function createToken(userId: string, username: string, secret: string): Promise<string> {
  const payload: TokenPayload = {
    sub: userId,
    username,
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS,
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const payloadB64 = base64urlEncode(payloadBytes);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigB64 = base64urlEncode(new Uint8Array(sig));

  return `${payloadB64}.${sigB64}`;
}

// Verify an HMAC-signed token. Returns payload or null.
export async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const sig = base64urlDecode(sigB64);
  const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(payloadB64));
  if (!valid) return null;

  const payloadBytes = base64urlDecode(payloadB64);
  const payload: TokenPayload = JSON.parse(new TextDecoder().decode(payloadBytes));

  // Check expiry.
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

// Extract userId from Authorization header. Returns null if not authenticated.
export async function extractUserId(request: Request, env: Env): Promise<{ userId: string; username: string } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice('Bearer '.length);
  const payload = await verifyToken(token, env.AUTH_SECRET);
  if (!payload) return null;

  return { userId: payload.sub, username: payload.username };
}

// Hash a userId the same way as index.ts.
async function hashUserId(rawId: string): Promise<string> {
  const data = new TextEncoder().encode(rawId);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Read a user record from R2.
async function readUser(bucket: R2Bucket, username: string): Promise<UserRecord | null> {
  const obj = await bucket.get(`user/${username}`);
  if (!obj) return null;
  return JSON.parse(await obj.text());
}

// Write a user record to R2.
async function writeUser(bucket: R2Bucket, user: UserRecord): Promise<void> {
  await bucket.put(`user/${user.username}`, JSON.stringify(user));
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// POST /auth/register
export async function handleRegister(request: Request, env: Env): Promise<Response> {
  let body: { username?: string; password?: string; inviteCode?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { username, password, inviteCode } = body;

  // Validate invite code.
  if (!inviteCode || inviteCode !== env.INVITE_CODE) {
    return jsonResponse({ error: 'Invalid invite code' }, 403);
  }

  // Validate username.
  if (!username || !VALID_USERNAME.test(username)) {
    return jsonResponse(
      { error: 'Username must be 3-30 characters, lowercase alphanumeric and hyphens' },
      400,
    );
  }

  // Validate password.
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return jsonResponse({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
  }

  // Check if username already exists.
  const existing = await readUser(env.GPX_BUCKET, username);
  if (existing) {
    return jsonResponse({ error: 'Username already taken' }, 409);
  }

  // Create user.
  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);
  const userId = await hashUserId(crypto.randomUUID());

  const user: UserRecord = {
    username,
    passwordHash,
    salt: [...salt].map((b) => b.toString(16).padStart(2, '0')).join(''),
    userId,
  };
  await writeUser(env.GPX_BUCKET, user);

  const token = await createToken(userId, username, env.AUTH_SECRET);
  return jsonResponse({ token, username }, 201);
}

// POST /auth/login
export async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { username, password } = body;

  if (!username || !password) {
    return jsonResponse({ error: 'Username and password required' }, 400);
  }

  const user = await readUser(env.GPX_BUCKET, username.toLowerCase());
  if (!user) {
    return jsonResponse({ error: 'Invalid username or password' }, 401);
  }

  const salt = hexToBytes(user.salt);
  const hash = await hashPassword(password, salt);

  if (hash !== user.passwordHash) {
    return jsonResponse({ error: 'Invalid username or password' }, 401);
  }

  const token = await createToken(user.userId, user.username, env.AUTH_SECRET);
  return jsonResponse({ token, username: user.username }, 200);
}
