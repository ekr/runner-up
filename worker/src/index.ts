import { handleTrackRoutes, handleSharedTrackRoutes, handleSettingsRoutes, handleAvatarRoutes, handleAvatarGet, readTrackMeta, readIndex, readShares } from './handlers';
import { handleRegister, handleLogin, handleChangePassword, handleDeleteAccount, extractUserId } from './auth';

export interface Env {
  GPX_BUCKET: R2Bucket;
  SHARE_SECRET: string;
  AUTH_SECRET: string;
  INVITE_CODE: string;
}

const ALLOWED_ORIGINS = [
  'https://runnerup.win',
  'https://www.runnerup.win',
];

function corsHeaders(origin: string | null): Record<string, string> {
  const isLocalhost = origin ? /^http:\/\/localhost(:\d+)?$/.test(origin) : false;
  const isAllowed = origin && (ALLOWED_ORIGINS.includes(origin) || isLocalhost);
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': '',
    'Vary': 'Origin',
  };
}

function jsonResponse(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

const VALID_TRACK_ID = /^[0-9a-f]{32}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin);

    // Handle CORS preflight.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Normalize trailing slash.
    const normalizedPath = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;

    try {
      // Auth routes (no authentication required).
      if (normalizedPath === '/auth/register' && request.method === 'POST') {
        const result = await handleRegister(request, env);
        return addHeaders(result, cors);
      }
      if (normalizedPath === '/auth/login' && request.method === 'POST') {
        const result = await handleLogin(request, env);
        return addHeaders(result, cors);
      }

      // Authenticated auth routes.
      if (normalizedPath === '/auth/change-password' && request.method === 'POST') {
        const auth = await extractUserId(request, env);
        if (!auth) return jsonResponse({ error: 'Authentication required' }, 401, cors);
        const result = await handleChangePassword(request, env, auth.username);
        return addHeaders(result, cors);
      }
      if (normalizedPath === '/auth/account' && request.method === 'DELETE') {
        const auth = await extractUserId(request, env);
        if (!auth) return jsonResponse({ error: 'Authentication required' }, 401, cors);
        const result = await handleDeleteAccount(request, env, auth.userId, auth.username);
        return addHeaders(result, cors);
      }

      // Avatar routes (authenticated PUT/DELETE).
      if ((request.method === 'PUT' || request.method === 'DELETE') && normalizedPath === '/avatar') {
        const auth = await extractUserId(request, env);
        if (!auth) return jsonResponse({ error: 'Authentication required' }, 401, cors);
        const result = await handleAvatarRoutes(request, env, auth.username);
        return addHeaders(result, cors);
      }

      // Public route: GET /avatar/{username}
      if (request.method === 'GET' && normalizedPath.startsWith('/avatar/')) {
        const username = normalizedPath.slice('/avatar/'.length);
        if (!username || !/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(username)) {
          return jsonResponse({ error: 'Not found' }, 404, cors);
        }
        const result = await handleAvatarGet(env, username);
        return addHeaders(result, cors);
      }

      // Settings routes (authenticated).
      if (normalizedPath === '/settings') {
        const auth = await extractUserId(request, env);
        if (!auth) return jsonResponse({ error: 'Authentication required' }, 401, cors);
        const result = await handleSettingsRoutes(request, env, auth.userId);
        return addHeaders(result, cors);
      }

      // Shared tracks routes (authenticated).
      if (normalizedPath === '/shared-tracks' || normalizedPath.startsWith('/shared-tracks/')) {
        const auth = await extractUserId(request, env);
        if (!auth) return jsonResponse({ error: 'Authentication required' }, 401, cors);
        const result = await handleSharedTrackRoutes(request, env, auth.userId, normalizedPath);
        return addHeaders(result, cors);
      }

      // Public route: GET /tracks/{id} (capability URL, no auth needed).
      // But not POST /tracks/{id}/share which requires auth.
      if (request.method === 'GET' && normalizedPath.startsWith('/tracks/') && normalizedPath.length > '/tracks/'.length) {
        const trackId = normalizedPath.slice('/tracks/'.length);
        if (!trackId || !VALID_TRACK_ID.test(trackId)) {
          return jsonResponse({ error: 'Invalid track ID' }, 400, cors);
        }
        const obj = await env.GPX_BUCKET.get(`gpx/${trackId}`);
        if (!obj) {
          return jsonResponse({ error: 'Not found' }, 404, cors);
        }
        const auth = await extractUserId(request, env);
        const [data, trackMeta] = await Promise.all([
          obj.text(),
          readTrackMeta(env.GPX_BUCKET, trackId),
        ]);

        let label: string | null = null;
        if (auth && trackMeta) {
          if (auth.username === trackMeta.owner) {
            // Authenticated user is the owner — look up label from their index.
            const index = await readIndex(env.GPX_BUCKET, auth.userId);
            const entry = index.find((e) => e.id === trackId);
            label = entry?.label ?? null;
          } else {
            // Authenticated user is a viewer — look up label from their shares list.
            const shares = await readShares(env.GPX_BUCKET, auth.userId);
            const entry = shares.find((e) => e.trackId === trackId);
            label = entry?.label ?? null;
          }
        }

        return jsonResponse({ id: trackId, data, owner: trackMeta?.owner ?? null, label }, 200, cors);
      }

      // All other /tracks routes require authentication.
      if (normalizedPath === '/tracks' || normalizedPath.startsWith('/tracks/')) {
        const auth = await extractUserId(request, env);
        if (!auth) {
          return jsonResponse({ error: 'Authentication required' }, 401, cors);
        }

        const result = await handleTrackRoutes(request, env, auth.userId, auth.username, normalizedPath);
        return addHeaders(result, cors);
      }

      return jsonResponse({ error: 'Not found' }, 404, cors);
    } catch (err) {
      console.error('Unhandled error:', err);
      return jsonResponse({ error: 'Internal server error' }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;

function addHeaders(response: Response, headers: Record<string, string>): Response {
  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) {
    newResponse.headers.set(key, value);
  }
  return newResponse;
}
