import argparse
import json
import os
from pathlib import Path
import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import StringIO
from urllib.parse import urlparse
import webbrowser

import chess
import chess.engine
import chess.pgn


ROOT = Path(__file__).resolve().parent
WEB_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
}
MAX_UPLOAD_SIZE = 5 * 1024 * 1024
ENGINE_LOCK = threading.Lock()
ENGINE = None


def find_engine():
    configured_path = os.environ.get("STOCKFISH_PATH")
    if configured_path:
        path = Path(configured_path).expanduser()
        if path.is_file():
            return path.resolve()
        resolved = shutil.which(configured_path)
        if resolved:
            return Path(resolved)
        raise FileNotFoundError(f"Stockfish was not found at {configured_path}")

    candidates = (
        ROOT / "sf.exe",
        ROOT / "stockfish.exe",
        ROOT
        / "stockfish-windows-x86-64-universal"
        / "stockfish"
        / "stockfish-windows-x86-64-universal.exe",
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate

    system_engine = shutil.which("stockfish")
    if system_engine:
        return Path(system_engine)
    raise FileNotFoundError(
        "Stockfish was not found. Set STOCKFISH_PATH to your Stockfish executable."
    )


def serialize_game(game, index, filename):
    board = game.board()
    initial_fen = board.fen()
    moves = []
    for move in game.mainline_moves():
        san = board.san(move)
        uci = move.uci()
        board.push(move)
        moves.append(
            {
                "san": san,
                "uci": uci,
                "fen": board.fen(),
                "check": board.is_check(),
                "checkmate": board.is_checkmate(),
            }
        )

    return {
        "id": f"{filename}:{index}",
        "filename": filename,
        "white": game.headers.get("White", "White"),
        "black": game.headers.get("Black", "Black"),
        "result": game.headers.get("Result", "*"),
        "date": game.headers.get("Date", ""),
        "initialFen": initial_fen,
        "moves": moves,
    }


def parse_games(pgn_text, filename):
    games = []
    pgn_file = StringIO(pgn_text)
    while True:
        game = chess.pgn.read_game(pgn_file)
        if game is None:
            break
        if game.errors:
            details = "; ".join(str(error) for error in game.errors)
            raise ValueError(f"Invalid PGN: {details}")
        games.append(serialize_game(game, len(games), filename))
    if not games:
        raise ValueError("No chess games were found in this PGN.")
    return games


def bundled_games():
    games = []
    for path in sorted(ROOT.glob("*.pgn")):
        games.extend(parse_games(path.read_text(encoding="utf-8-sig"), path.name))
    return games


def engine():
    global ENGINE
    if ENGINE is None:
        ENGINE = chess.engine.SimpleEngine.popen_uci(str(find_engine()), timeout=15)
    return ENGINE


def position_score(board):
    if board.is_checkmate():
        return {"cp": -100000 if board.turn == chess.WHITE else 100000, "mate": None}
    if board.is_game_over(claim_draw=True):
        return {"cp": 0, "mate": None}
    info = engine().analyse(board, chess.engine.Limit(depth=13, time=0.25))
    score = info["score"].pov(chess.WHITE)
    return {"cp": score.score(mate_score=100000), "mate": score.mate()}


def analyze_position(data):
    if not isinstance(data, dict) or not isinstance(data.get("fen"), str):
        raise ValueError("A valid board FEN is required.")
    board = chess.Board(data["fen"])
    if not board.is_valid():
        raise ValueError("The current board position is invalid.")

    before_fen = data.get("beforeFen")
    mover = data.get("mover")
    move_loss = None
    if before_fen:
        if not isinstance(before_fen, str):
            raise ValueError("The previous board position must be a valid FEN.")
        if mover not in ("white", "black"):
            raise ValueError("The moving side must be white or black.")
        before_board = chess.Board(before_fen)
        if not before_board.is_valid() or before_board.is_game_over():
            raise ValueError("The position before the move is invalid.")

        with ENGINE_LOCK:
            best_score = position_score(before_board)
            current_score = position_score(board)
        mover_score_before = best_score["cp"] * (1 if mover == "white" else -1)
        mover_score_after = current_score["cp"] * (1 if mover == "white" else -1)
        move_loss = max(0, (mover_score_before - mover_score_after) / 100)
    else:
        with ENGINE_LOCK:
            current_score = position_score(board)

    return {"evaluation": current_score, "moveLoss": move_loss}


class ChessRequestHandler(BaseHTTPRequestHandler):
    server_version = "ChessViewer/1.0"

    def log_message(self, format_string, *args):
        print(f"[{self.log_date_time_string()}] {format_string % args}")

    def send_json(self, status, data):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid request length.") from error
        if length <= 0 or length > MAX_UPLOAD_SIZE:
            raise ValueError("Request body must be between 1 byte and 5 MB.")
        try:
            return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("Request body must contain valid JSON.") from error

    def do_GET(self):
        route = urlparse(self.path).path
        if route == "/api/games":
            try:
                self.send_json(200, {"games": bundled_games()})
            except (OSError, UnicodeError, ValueError) as error:
                self.send_json(500, {"error": str(error)})
            return

        web_file = WEB_FILES.get(route)
        if web_file is None:
            self.send_error(404, "Not found")
            return
        filename, content_type = web_file
        try:
            payload = (ROOT / filename).read_bytes()
        except OSError:
            self.send_error(404, "Web app files not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        route = urlparse(self.path).path
        try:
            data = self.read_json()
            if not isinstance(data, dict):
                raise ValueError("The request body must be a JSON object.")
            if route == "/api/upload":
                raw_filename = data.get("filename", "game.pgn")
                pgn_text = data.get("pgn")
                if not isinstance(raw_filename, str) or not isinstance(pgn_text, str):
                    raise ValueError("A PGN filename and text are required.")
                filename = Path(raw_filename).name
                if not filename.lower().endswith(".pgn"):
                    raise ValueError("Please choose a file with the .pgn extension.")
                games = parse_games(pgn_text, filename)
                self.send_json(200, {"games": games})
            elif route == "/api/analyze":
                self.send_json(200, analyze_position(data))
            else:
                self.send_error(404, "Not found")
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except (OSError, chess.engine.EngineError, chess.engine.EngineTerminatedError) as error:
            self.send_json(503, {"error": f"Stockfish analysis failed: {error}"})


class ChessHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    parser = argparse.ArgumentParser(description="Run the local chess analysis web app.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    server = ChessHTTPServer((args.host, args.port), ChessRequestHandler)
    url = f"http://{args.host}:{server.server_address[1]}/"
    print(f"Chess viewer running at {url}")
    print("Press Ctrl+C to stop the server.")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping chess viewer...")
    finally:
        server.server_close()
        if ENGINE is not None:
            ENGINE.quit()


if __name__ == "__main__":
    main()
