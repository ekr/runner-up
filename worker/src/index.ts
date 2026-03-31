import { handleTrackRoutes } from './handlers';

export interface Env {
  GPX_BUCKET: R2Bucket;
  SHARE_SECRET: string;
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
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id',
    'Access-Control-Expose-Headers': 'X-User-Id',
    'Vary': 'Origin',
  };
}

function jsonResponse(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

// Hash a userId to avoid storing or exposing the raw UUID in R2 keys.
async function hashUserId(userId: string): Promise<string> {
  const data = new TextEncoder().encode(userId);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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

    const VALID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // User ID provisioning: read from header, or generate a new one.
    let rawUserId = request.headers.get('X-User-Id');
    let newUser = false;
    if (!rawUserId || !VALID_UUID.test(rawUserId)) {
      rawUserId = crypto.randomUUID();
      newUser = true;
    }

    // Hash the userId for internal use (R2 keys, HMAC input).
    const userId = await hashUserId(rawUserId);

    // Return the raw (unhashed) userId to the client.
    const responseHeaders = { ...cors };
    if (newUser) {
      responseHeaders['X-User-Id'] = rawUserId;
    }

    try {
      if (path === '/tracks' || path.startsWith('/tracks/')) {
        const result = await handleTrackRoutes(request, env, userId, path);
        return addHeaders(result, responseHeaders);
      }

      return jsonResponse({ error: 'Not found' }, 404, responseHeaders);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return jsonResponse({ error: message }, 500, responseHeaders);
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
