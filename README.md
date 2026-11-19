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
PGN file into the page to review another game. You can also paste a Lichess
game URL or a direct PGN download URL into **Analyze a game link**. Chess.com
game pages cannot be imported directly by the static app because Chess.com
blocks browser requests to its game data; download the game's PGN and open that
file instead. Stockfish WASM and its license are included in `static/vendor`.
Move reviews combine Stockfish's evaluation with an on-device board scan for
forks, newly hanging or under-defended pieces, captures, and material lost in
the engine's reply line. The move list and analysis sit on either side of the
centered board on wide screens and stack for smaller screens. Analyzed
inaccuracies, mistakes, and blunders also get a **Why?** button in the move list.

Run `npm run build` to create the static site in `dist` for deployment.
