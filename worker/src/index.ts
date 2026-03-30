import { handleTrackRoutes } from './handlers';
import { handleShareRoutes } from './share';

export interface Env {
  GPX_BUCKET: R2Bucket;
  SHARE_SECRET: string;
}

const ALLOWED_ORIGIN = 'https://runnerup.win';

function corsHeaders(origin: string | null): Record<string, string> {
  // In development, allow localhost origins too.
  const allowedOrigin =
    origin && (origin === ALLOWED_ORIGIN || origin.startsWith('http://localhost'))
      ? origin
      : ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id',
    'Access-Control-Expose-Headers': 'X-User-Id',
  };
}

function jsonResponse(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
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

    // User ID provisioning: read from header, or generate a new one.
    let userId = request.headers.get('X-User-Id');
    let newUser = false;
    if (!userId) {
      userId = crypto.randomUUID();
      newUser = true;
    }

    // Add userId to cors headers for the response.
    const responseHeaders = { ...cors };
    if (newUser) {
      responseHeaders['X-User-Id'] = userId;
    }

    try {
      // /share/* routes are public (no auth).
      if (path.startsWith('/share/')) {
        const result = await handleShareRoutes(request, env, path);
        return addHeaders(result, responseHeaders);
      }

      // /tracks routes require a userId.
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
