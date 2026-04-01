import { SignJWT, jwtVerify } from 'jose';
import { constantTimeEqual } from '@oslojs/crypto/subtle';
import { encodeHexLowerCase, decodeHex } from '@oslojs/encoding';
import type { Env } from './index';
import { readIndex, readStats, writeStats } from './handlers';

// PBKDF2 parameters. 50k iterations is a reasonable tradeoff for Workers'
// CPU time budget while still providing good security.
const PBKDF2_ITERATIONS = 50_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

// Token expiry: 30 days.
const TOKEN_EXPIRY = '30d';

// Username: lowercase alphanumeric + hyphens, 3-30 chars.
const VALID_USERNAME = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 1024;

interface UserRecord {
  username: string;
  passwordHash: string; // hex
  salt: string; // hex
  userId: string; // hashed UUID (64-char hex), used as R2 key prefix
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

// Hash a password with PBKDF2-SHA256 via Web Crypto API.
async function hashPassword(password: string, salt: Uint8Array): Promise<Uint8Array> {
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
  return new Uint8Array(bits);
}

// Encode a secret string as a CryptoKey for jose.
function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

// Create a signed JWT.
export async function createToken(userId: string, username: string, secret: string): Promise<string> {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setExpirationTime(TOKEN_EXPIRY)
    .setIssuedAt()
    .sign(secretKey(secret));
}

// Verify a JWT. Returns payload or null.
export async function verifyToken(token: string, secret: string): Promise<{ sub: string; username: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      algorithms: ['HS256'],
    });
    if (!payload.sub || typeof payload.username !== 'string') return null;
    return { sub: payload.sub, username: payload.username };
  } catch {
    return null;
  }
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

// Hash a raw ID with SHA-256 (for userId storage keys).
async function hashId(rawId: string): Promise<string> {
  const data = new TextEncoder().encode(rawId);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return encodeHexLowerCase(new Uint8Array(hash));
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

// POST /auth/register
export async function handleRegister(request: Request, env: Env): Promise<Response> {
  let body: { username?: string; password?: string; inviteCode?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { username, password, inviteCode } = body;

  // Validate invite code (constant-time to prevent timing side-channel).
  if (!inviteCode || !constantTimeEqual(
    new TextEncoder().encode(inviteCode),
    new TextEncoder().encode(env.INVITE_CODE),
  )) {
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
  if (password.length > MAX_PASSWORD_LENGTH) {
    return jsonResponse({ error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters` }, 400);
  }

  // Check if username already exists. Note: there is a small TOCTOU
  // race window where two concurrent registrations for the same username
  // could both pass this check. This is acceptable given invite-code
  // gating limits the registration rate.
  const existing = await readUser(env.GPX_BUCKET, username);
  if (existing) {
    return jsonResponse({ error: 'Username already taken' }, 409);
  }

  // Create user.
  const salt = generateSalt();
  const hash = await hashPassword(password, salt);
  const userId = await hashId(crypto.randomUUID());

  const user: UserRecord = {
    username,
    passwordHash: encodeHexLowerCase(hash),
    salt: encodeHexLowerCase(salt),
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

  if (password.length > MAX_PASSWORD_LENGTH) {
    return jsonResponse({ error: 'Invalid username or password' }, 401);
  }

  const user = await readUser(env.GPX_BUCKET, username.toLowerCase());
  if (!user) {
    return jsonResponse({ error: 'Invalid username or password' }, 401);
  }

  const salt = decodeHex(user.salt);
  const hash = await hashPassword(password, salt);
  const storedHash = decodeHex(user.passwordHash);

  if (!constantTimeEqual(hash, storedHash)) {
    return jsonResponse({ error: 'Invalid username or password' }, 401);
  }

  const token = await createToken(user.userId, user.username, env.AUTH_SECRET);
  return jsonResponse({ token, username: user.username }, 200);
}

// POST /auth/change-password
export async function handleChangePassword(request: Request, env: Env, username: string): Promise<Response> {
  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return jsonResponse({ error: 'Current password and new password required' }, 400);
  }

  const user = await readUser(env.GPX_BUCKET, username);
  if (!user) {
    return jsonResponse({ error: 'User not found' }, 404);
  }

  // Verify current password.
  const salt = decodeHex(user.salt);
  const hash = await hashPassword(currentPassword, salt);
  const storedHash = decodeHex(user.passwordHash);

  if (!constantTimeEqual(hash, storedHash)) {
    return jsonResponse({ error: 'Current password is incorrect' }, 401);
  }

  // Validate new password.
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return jsonResponse({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return jsonResponse({ error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters` }, 400);
  }

  // Hash new password and update user record.
  const newSalt = generateSalt();
  const newHash = await hashPassword(newPassword, newSalt);
  user.passwordHash = encodeHexLowerCase(newHash);
  user.salt = encodeHexLowerCase(newSalt);
  await writeUser(env.GPX_BUCKET, user);

  const token = await createToken(user.userId, user.username, env.AUTH_SECRET);
  return jsonResponse({ token, username: user.username }, 200);
}

// DELETE /auth/account
export async function handleDeleteAccount(request: Request, env: Env, userId: string, username: string): Promise<Response> {
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { password } = body;

  if (!password) {
    return jsonResponse({ error: 'Password required' }, 400);
  }

  const user = await readUser(env.GPX_BUCKET, username);
  if (!user) {
    return jsonResponse({ error: 'User not found' }, 404);
  }

  // Verify password.
  const salt = decodeHex(user.salt);
  const hash = await hashPassword(password, salt);
  const storedHash = decodeHex(user.passwordHash);

  if (!constantTimeEqual(hash, storedHash)) {
    return jsonResponse({ error: 'Password is incorrect' }, 401);
  }

  // Delete all tracks.
  const index = await readIndex(env.GPX_BUCKET, userId);
  const totalDeleted = index.reduce((sum, entry) => sum + ((entry as { sizeBytes?: number }).sizeBytes || 0), 0);
  await Promise.all(index.map((entry) => env.GPX_BUCKET.delete(`gpx/${entry.id}`)));
  await env.GPX_BUCKET.delete(`index/${userId}`);

  if (totalDeleted > 0) {
    const stats = await readStats(env.GPX_BUCKET);
    stats.totalBytes = Math.max(0, stats.totalBytes - totalDeleted);
    await writeStats(env.GPX_BUCKET, stats);
  }

  // Delete settings and user record.
  await env.GPX_BUCKET.delete(`settings/${userId}`);
  await env.GPX_BUCKET.delete(`user/${username}`);

  return new Response(null, { status: 204 });
}
