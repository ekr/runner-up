var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-1v6x8M/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// src/handlers.ts
var MAX_TRACKS_PER_USER = 100;
var MAX_TOTAL_STORAGE_BYTES = 9 * 1024 * 1024 * 1024;
var MAX_MONTHLY_WRITES = 9e6;
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
__name(jsonResponse, "jsonResponse");
async function computeTrackId(secret, userId, gpxText) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = new TextEncoder().encode(userId + "\0" + gpxText);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  const bytes = new Uint8Array(sig).slice(0, 16);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(computeTrackId, "computeTrackId");
function extractGPXMetadata(gpxText) {
  const trkptMatch = gpxText.match(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/);
  const startLat = trkptMatch ? parseFloat(trkptMatch[1]) : null;
  const startLon = trkptMatch ? parseFloat(trkptMatch[2]) : null;
  let date = null;
  if (trkptMatch) {
    const afterTrkpt = gpxText.substring(trkptMatch.index);
    const timeMatch = afterTrkpt.match(/<time>([^<]+)<\/time>/);
    if (timeMatch) {
      date = timeMatch[1];
    }
  }
  return { date, startLat, startLon };
}
__name(extractGPXMetadata, "extractGPXMetadata");
async function readIndex(bucket, userId) {
  const obj = await bucket.get(`index/${userId}`);
  if (!obj)
    return [];
  const text = await obj.text();
  return JSON.parse(text);
}
__name(readIndex, "readIndex");
async function writeIndex(bucket, userId, index) {
  await bucket.put(`index/${userId}`, JSON.stringify(index));
}
__name(writeIndex, "writeIndex");
async function readStats(bucket) {
  const currentMonth = (/* @__PURE__ */ new Date()).toISOString().slice(0, 7);
  const obj = await bucket.get("_stats");
  if (obj) {
    const stats = JSON.parse(await obj.text());
    if (stats.month === currentMonth) {
      return stats;
    }
    return { totalBytes: stats.totalBytes, writeCount: 0, month: currentMonth };
  }
  return { totalBytes: 0, writeCount: 0, month: currentMonth };
}
__name(readStats, "readStats");
async function writeStats(bucket, stats) {
  await bucket.put("_stats", JSON.stringify(stats));
}
__name(writeStats, "writeStats");
var VALID_TRACK_ID = /^[0-9a-f]{32}$/;
async function handleTrackRoutes(request, env, userId, path) {
  if (request.method === "PUT" && path === "/tracks") {
    const gpxText = await request.text();
    if (!gpxText.trim()) {
      return jsonResponse({ error: "Empty body" }, 400);
    }
    const trackId = await computeTrackId(env.SHARE_SECRET, userId, gpxText);
    const index = await readIndex(env.GPX_BUCKET, userId);
    if (index.some((entry) => entry.id === trackId)) {
      return jsonResponse({ id: trackId }, 200);
    }
    if (index.length >= MAX_TRACKS_PER_USER) {
      return jsonResponse({ error: "Track limit reached" }, 429);
    }
    const stats = await readStats(env.GPX_BUCKET);
    const bodyBytes = new TextEncoder().encode(gpxText).length;
    if (stats.totalBytes + bodyBytes > MAX_TOTAL_STORAGE_BYTES) {
      return jsonResponse({ error: "Storage limit reached" }, 507);
    }
    if (stats.writeCount >= MAX_MONTHLY_WRITES) {
      return jsonResponse({ error: "Monthly write limit reached" }, 429);
    }
    await env.GPX_BUCKET.put(`gpx/${trackId}`, gpxText);
    stats.totalBytes += bodyBytes;
    stats.writeCount += 1;
    await writeStats(env.GPX_BUCKET, stats);
    const meta = extractGPXMetadata(gpxText);
    index.push({ id: trackId, ...meta, sizeBytes: bodyBytes });
    await writeIndex(env.GPX_BUCKET, userId, index);
    return jsonResponse({ id: trackId }, 201);
  }
  if (request.method === "GET" && path === "/tracks") {
    const index = await readIndex(env.GPX_BUCKET, userId);
    return jsonResponse(index, 200);
  }
  if (request.method === "GET" && path.startsWith("/tracks/")) {
    const trackId = path.slice("/tracks/".length);
    if (!trackId || !VALID_TRACK_ID.test(trackId)) {
      return jsonResponse({ error: "Invalid track ID" }, 400);
    }
    const obj = await env.GPX_BUCKET.get(`gpx/${trackId}`);
    if (!obj) {
      return jsonResponse({ error: "Not found" }, 404);
    }
    const data = await obj.text();
    return jsonResponse({ id: trackId, data }, 200);
  }
  if (request.method === "DELETE" && path.startsWith("/tracks/") && path.length > "/tracks/".length) {
    const trackId = path.slice("/tracks/".length);
    if (!VALID_TRACK_ID.test(trackId)) {
      return jsonResponse({ error: "Invalid track ID" }, 400);
    }
    const index = await readIndex(env.GPX_BUCKET, userId);
    const deleted = index.find((entry) => entry.id === trackId);
    if (!deleted) {
      return jsonResponse({ error: "Not found" }, 404);
    }
    const newIndex = index.filter((entry) => entry.id !== trackId);
    await env.GPX_BUCKET.delete(`gpx/${trackId}`);
    await writeIndex(env.GPX_BUCKET, userId, newIndex);
    if (deleted.sizeBytes > 0) {
      const stats = await readStats(env.GPX_BUCKET);
      stats.totalBytes = Math.max(0, stats.totalBytes - deleted.sizeBytes);
      await writeStats(env.GPX_BUCKET, stats);
    }
    return new Response(null, { status: 204 });
  }
  if (request.method === "DELETE" && path === "/tracks") {
    const index = await readIndex(env.GPX_BUCKET, userId);
    const totalDeleted = index.reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0);
    await Promise.all(index.map((entry) => env.GPX_BUCKET.delete(`gpx/${entry.id}`)));
    await env.GPX_BUCKET.delete(`index/${userId}`);
    if (totalDeleted > 0) {
      const stats = await readStats(env.GPX_BUCKET);
      stats.totalBytes = Math.max(0, stats.totalBytes - totalDeleted);
      await writeStats(env.GPX_BUCKET, stats);
    }
    return new Response(null, { status: 204 });
  }
  return jsonResponse({ error: "Method not allowed" }, 405);
}
__name(handleTrackRoutes, "handleTrackRoutes");

// src/index.ts
var ALLOWED_ORIGINS = [
  "https://runnerup.win",
  "https://www.runnerup.win"
];
function corsHeaders(origin) {
  const isLocalhost = origin ? /^http:\/\/localhost(:\d+)?$/.test(origin) : false;
  const isAllowed = origin && (ALLOWED_ORIGINS.includes(origin) || isLocalhost);
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id",
    "Access-Control-Expose-Headers": "X-User-Id",
    "Vary": "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
function jsonResponse2(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra }
  });
}
__name(jsonResponse2, "jsonResponse");
async function hashUserId(userId) {
  const data = new TextEncoder().encode(userId);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashUserId, "hashUserId");
var src_default = {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    const VALID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let rawUserId = request.headers.get("X-User-Id");
    let newUser = false;
    if (!rawUserId || !VALID_UUID.test(rawUserId)) {
      rawUserId = crypto.randomUUID();
      newUser = true;
    }
    const userId = await hashUserId(rawUserId);
    const responseHeaders = { ...cors };
    if (newUser) {
      responseHeaders["X-User-Id"] = rawUserId;
    }
    const normalizedPath = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
    try {
      if (normalizedPath === "/tracks" || normalizedPath.startsWith("/tracks/")) {
        const result = await handleTrackRoutes(request, env, userId, normalizedPath);
        return addHeaders(result, responseHeaders);
      }
      return jsonResponse2({ error: "Not found" }, 404, responseHeaders);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      return jsonResponse2({ error: message }, 500, responseHeaders);
    }
  }
};
function addHeaders(response, headers) {
  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) {
    newResponse.headers.set(key, value);
  }
  return newResponse;
}
__name(addHeaders, "addHeaders");

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-1v6x8M/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-1v6x8M/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
