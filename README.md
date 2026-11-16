# Chess Studio

Chess Studio is a browser-based chess PGN viewer and analyzer. It parses games
with chess.js and runs Stockfish locally in a WebAssembly worker. PGNs and
positions are analyzed on your device.

## Run locally

1. Install Node.js.
2. Run `npm install`.
3. Run `npm run dev` and open the local URL printed by Vite.

The app loads `.pgn` files in the project folder. Use **Open PGN** or drag a
PGN file into the page to review another game. You can also paste a Lichess
game URL or a direct PGN download URL into **Analyze a game link**. Chess.com
game pages cannot be imported directly by the static app because Chess.com
blocks browser requests to its game data; download the game's PGN and open that
file instead. Stockfish WASM and its license are included in `static/vendor`.

Run `npm run build` to create the static site in `dist`.

## Stripe subscriptions

The app includes Stripe Checkout for recurring subscriptions and a Stripe
Billing Portal link for subscription management. Create a recurring Price in
the Stripe Dashboard, then configure the following environment variables on
your server:

- `STRIPE_SECRET_KEY`: a Stripe secret key (`sk_test_...` for testing, or
  `sk_live_...` when ready to accept real payments). Keep this secret on the
  server; never add it to frontend code or commit it.
- `STRIPE_PRICE_ID`: the recurring Stripe Price ID (`price_...`). The price and
  billing interval are controlled in Stripe, not hardcoded in the app.
- `APP_URL`: the canonical public URL of your site, including `https://` and
  without a trailing path, for example `https://your-app.onrender.com`.

Use Stripe test mode first. Enable the customer portal in Stripe Dashboard so
subscribers can update payment methods or cancel.

### Render deployment requirement

A Render **Static Site** cannot run this repository's Stripe API endpoints.
Stripe secret keys must stay server-side, so deploy it as a Render **Web
Service** using the included `render.yaml` (or create a Node Web Service with
Build Command `npm install && npm run build` and Start Command `npm start`).
Set the three environment variables above in Render. For `APP_URL`, use the
Web Service's actual HTTPS URL. If your current Render deployment is a Static
Site, create a new Web Service for this branch and point your domain to it;
Render does not run `server.js` as part of a static-site deployment. The
included `server.js` serves the built Vite app and provides the Stripe API
routes on the same origin.

### Subscription status and access

After Checkout, this browser saves the Stripe Checkout session ID and checks
its subscription status with Stripe on subsequent visits. That lets the app
show active status and provide a Billing Portal link without storing card data.
This is a minimal billing integration, not account-based entitlement: the
existing app has no user accounts, and browser-side state can be cleared or
shared. Do not use this status check alone to protect paid features or sensitive
content. For robust access control, add authentication and a database-backed
subscription record updated by verified Stripe webhooks before gating premium
features. The current integration does not include webhook processing.
