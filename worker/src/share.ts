import type { Env } from './index';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleShareRoutes(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // Strip /share/ prefix and split remaining path segments.
  const segments = path.slice('/share/'.length).split('/').filter(Boolean);

  if (segments.length === 1) {
    // GET /share/{trackId} — single track.
    const trackId = segments[0];
    const obj = await env.GPX_BUCKET.get(`gpx/${trackId}`);
    if (!obj) {
      return jsonResponse({ error: 'Not found' }, 404);
    }
    const data = await obj.text();
    return jsonResponse({ id: trackId, data }, 200);
  }

  if (segments.length === 2) {
    // GET /share/{trackId1}/{trackId2} — two tracks for comparison.
    const [id1, id2] = segments;
    const [obj1, obj2] = await Promise.all([
      env.GPX_BUCKET.get(`gpx/${id1}`),
      env.GPX_BUCKET.get(`gpx/${id2}`),
    ]);

    if (!obj1 || !obj2) {
      return jsonResponse({ error: 'One or more tracks not found' }, 404);
    }

    const [data1, data2] = await Promise.all([obj1.text(), obj2.text()]);
    return jsonResponse({
      tracks: [
        { id: id1, data: data1 },
        { id: id2, data: data2 },
      ],
    }, 200);
  }

  return jsonResponse({ error: 'Invalid share URL' }, 400);
}
