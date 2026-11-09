# Chess Studio

Chess Studio is a local Flask web app for browsing PGN games and reviewing
positions with Stockfish. PGNs and analysis stay on your computer.

## Run

1. Install Python dependencies with `python -m pip install -r requirements.txt`.
2. Run `python main.py`.
3. Open `http://127.0.0.1:8000` if it does not open automatically.
4. Stop the server with Ctrl+C in the terminal.

The app loads `.pgn` files in the project folder. Use **Open PGN** or drag a
PGN file into the page to review another game. Stockfish is detected from the
included executable locations or from `PATH`; set `STOCKFISH_PATH` to use a
different engine executable.

To use a different local address or port, run
`python main.py --host 127.0.0.1 --port 8000`. Add `--no-browser` to start the
server without opening a browser.
