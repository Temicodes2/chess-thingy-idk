import argparse
import os
from pathlib import Path
import shutil
import threading
from io import StringIO
import webbrowser

import chess
import chess.engine
import chess.pgn
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import RequestEntityTooLarge


ROOT = Path(__file__).resolve().parent
MAX_UPLOAD_SIZE = 5 * 1024 * 1024
ENGINE_LOCK = threading.Lock()
ENGINE = None
app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_SIZE


@app.errorhandler(RequestEntityTooLarge)
def handle_upload_too_large(_error):
    return jsonify(error="Request body must be smaller than 5 MB."), 413


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


@app.after_request
def add_response_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.get("/app.js")
def javascript():
    return send_from_directory(ROOT, "app.js")


@app.get("/styles.css")
def stylesheet():
    return send_from_directory(ROOT, "styles.css")


@app.get("/api/games")
def get_games():
    try:
        return jsonify(games=bundled_games())
    except (OSError, UnicodeError, ValueError) as error:
        return jsonify(error=str(error)), 500


@app.post("/api/upload")
def upload_pgn():
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify(error="The request body must be a JSON object."), 400

    raw_filename = data.get("filename", "game.pgn")
    pgn_text = data.get("pgn")
    if not isinstance(raw_filename, str) or not isinstance(pgn_text, str):
        return jsonify(error="A PGN filename and text are required."), 400

    filename = Path(raw_filename).name
    if not filename.lower().endswith(".pgn"):
        return jsonify(error="Please choose a file with the .pgn extension."), 400
    try:
        return jsonify(games=parse_games(pgn_text, filename))
    except ValueError as error:
        return jsonify(error=str(error)), 400


@app.post("/api/analyze")
def analyze():
    data = request.get_json()
    try:
        return jsonify(analyze_position(data))
    except ValueError as error:
        return jsonify(error=str(error)), 400
    except (OSError, chess.engine.EngineError) as error:
        return jsonify(error=f"Stockfish analysis failed: {error}"), 503


@app.errorhandler(400)
def handle_bad_request(error):
    if request.path.startswith("/api/"):
        message = getattr(error, "description", "Invalid request.")
        return jsonify(error=message), 400
    return error


def main():
    parser = argparse.ArgumentParser(description="Run the local chess analysis web app.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    url = f"http://{args.host}:{args.port}/"
    print(f"Chess viewer running at {url}")
    print("Press Ctrl+C to stop the server.")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()

    try:
        app.run(
            host=args.host,
            port=args.port,
            threaded=True,
            use_reloader=False,
        )
    except KeyboardInterrupt:
        print("\nStopping chess viewer...")
    finally:
        if ENGINE is not None:
            ENGINE.quit()


if __name__ == "__main__":
    main()
