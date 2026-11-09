# Chess Studio

Chess Studio is a browser-based chess PGN viewer and analyzer. It parses games
with chess.js and runs Stockfish locally in a WebAssembly worker. PGNs and
positions are analyzed on your device; no backend server is needed.

## Run

1. Install Node.js.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open the local URL printed by Vite.
5. Stop the development server with Ctrl+C.

The app loads `.pgn` files in the project folder. Use **Open PGN** or drag a
PGN file into the page to review another game. Stockfish WASM and its license
are included in `static/vendor`.

Run `npm run build` to create the static site in `dist` for deployment.
