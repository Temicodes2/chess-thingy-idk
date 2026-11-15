import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = resolve(projectRoot, "dist");
const port = Number(process.env.PORT) || 3000;
const maxBodyBytes = 16 * 1024;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".pgn": "application/x-chess-pgn; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function stripeConfiguration() {
  const { STRIPE_SECRET_KEY, STRIPE_PRICE_ID, APP_URL } = process.env;
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID || !APP_URL) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY, STRIPE_PRICE_ID, and APP_URL.");
  }
  if (!/^(sk_test_|sk_live_)/.test(STRIPE_SECRET_KEY) || !/^price_/.test(STRIPE_PRICE_ID)) {
    throw new Error("Stripe configuration is invalid.");
  }

  let appUrl;
  try {
    appUrl = new URL(APP_URL);
  } catch {
    throw new Error("APP_URL must be a valid absolute URL.");
  }
  if (appUrl.protocol !== "https:" || appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
    throw new Error("APP_URL must be the canonical HTTPS origin without a path or query.");
  }
  return { secretKey: STRIPE_SECRET_KEY, priceId: STRIPE_PRICE_ID, appUrl: appUrl.origin };
}

async function stripeRequest(secretKey, path, { method = "GET", params } = {}) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(params ? { body: params.toString() } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result.error?.message || "Stripe request failed.";
    throw new Error(message);
  }
  return result;
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) {
      throw Object.assign(new Error("Request body is too large."), { status: 413 });
    }
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  }
}

function isCheckoutSessionId(value) {
  return typeof value === "string" && /^cs_(?:test|live)_[A-Za-z0-9_]+$/.test(value);
}

async function getCheckoutSession(secretKey, sessionId) {
  const query = new URLSearchParams({ "expand[]": "subscription" });
  return stripeRequest(secretKey, `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?${query}`);
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/create-checkout-session") {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return sendJson(response, 405, { error: "Method not allowed." });
    }
    let config;
    try {
      config = stripeConfiguration();
    } catch (error) {
      return sendJson(response, 503, { error: error.message });
    }

    try {
      const params = new URLSearchParams({
        mode: "subscription",
        "line_items[0][price]": config.priceId,
        "line_items[0][quantity]": "1",
        success_url: `${config.appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.appUrl}/?checkout=cancel",
      });
      const session = await stripeRequest(config.secretKey, "/v1/checkout/sessions", {
        method: "POST",
        params,
      });
      return sendJson(response, 200, { url: session.url });
    } catch (error) {
      console.error("Stripe Checkout session creation failed:", error.message);
      return sendJson(response, 502, { error: "Could not start Stripe Checkout. Please try again later." });
    }
  }

  if (url.pathname === "/api/subscription-status") {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      return sendJson(response, 405, { error: "Method not allowed." });
    }
    const sessionId = url.searchParams.get("session_id");
    if (!isCheckoutSessionId(sessionId)) {
      return sendJson(response, 400, { error: "A valid Checkout session ID is required." });
    }
    let config;
    try {
      config = stripeConfiguration();
    } catch (error) {
      return sendJson(response, 503, { error: error.message });
    }
    try {
      const session = await getCheckoutSession(config.secretKey, sessionId);
      const subscription = session.subscription;
      const active = session.mode === "subscription" && session.status === "complete" &&
        (subscription?.status === "active" || subscription?.status === "trialing");
      return sendJson(response, 200, {
        active,
        status: active ? subscription.status : (subscription?.status || "inactive"),
      });
    } catch (error) {
      console.error("Stripe subscription status lookup failed:", error.message);
      return sendJson(response, 502, { error: "Could not verify the subscription right now." });
    }
  }

  if (url.pathname === "/api/create-portal-session") {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return sendJson(response, 405, { error: "Method not allowed." });
    }
    const body = await readJsonBody(request).catch((error) => {
      sendJson(response, error.status || 400, { error: error.message });
      return null;
    });
    if (!body) return;
    if (!isCheckoutSessionId(body.sessionId)) {
      return sendJson(response, 400, { error: "A valid Checkout session ID is required." });
    }
    let config;
    try {
      config = stripeConfiguration();
    } catch (error) {
      return sendJson(response, 503, { error: error.message });
    }
    try {
      const checkout = await getCheckoutSession(config.secretKey, body.sessionId);
      if (checkout.mode !== "subscription" || !checkout.customer) {
        return sendJson(response, 403, { error: "No subscription was found for this Checkout session." });
      }
      const params = new URLSearchParams({
        customer: typeof checkout.customer === "string" ? checkout.customer : checkout.customer.id,
        return_url: config.appUrl,
      });
      const portal = await stripeRequest(config.secretKey, "/v1/billing_portal/sessions", {
        method: "POST",
        params,
      });
      return sendJson(response, 200, { url: portal.url });
    } catch (error) {
      console.error("Stripe Billing Portal session creation failed:", error.message);
      return sendJson(response, 502, { error: "Could not open subscription management. Please try again later." });
    }
  }

  return sendJson(response, 404, { error: "API route not found." });
}

async function serveStatic(request, response, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  const filePath = resolve(publicRoot, `.${pathname}`);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Cache-Control": pathname === "/index.html" ? "no-cache" : "public, max-age=3600",
      "Content-Length": fileStat.size,
      "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    if (extname(pathname)) {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      const indexPath = resolve(publicRoot, "index.html");
      await access(indexPath);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      createReadStream(indexPath).pipe(response);
    } catch {
      response.writeHead(503).end("App is not built. Run npm run build before starting the server.");
    }
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  await serveStatic(request, response, url);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Chess Studio listening on port ${port}`);
});
