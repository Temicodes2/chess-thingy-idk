from queue import Empty, Queue
from pathlib import Path
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

import chess
import chess.engine
import chess.pgn
from tkinterdnd2 import DND_FILES, TkinterDnD

ENGINE_PATH = Path(__file__).with_name("sf.exe")
PIECE_GLYPHS = {
    chess.PAWN: ("♙", "♟"),
    chess.KNIGHT: ("♘", "♞"),
    chess.BISHOP: ("♗", "♝"),
    chess.ROOK: ("♖", "♜"),
    chess.QUEEN: ("♕", "♛"),
    chess.KING: ("♔", "♚"),
}
BOARD_COLORS = ("#f0d9b5", "#b58863")
HIGHLIGHT_COLOR = "#f6f669"


class ChessGameViewer:
    def __init__(self, root, games):
        self.root = root
        self.games = games
        self.game_index = 0
        self.ply = 0
        self.moves = []
        self.san_moves = []
        self.engine_requests = Queue(maxsize=1)
        self.engine_results = Queue()
        self.evaluation_generation = 0
        self.closed = False
        self.move_loss_scale = 2.0

        root.title("Chess Game Viewer")
        root.minsize(820, 620)

        content = ttk.Frame(root, padding=16)
        content.pack(fill=tk.BOTH, expand=True)

        game_bar = ttk.Frame(content)
        game_bar.pack(fill=tk.X, pady=(0, 12))

        ttk.Label(game_bar, text="Game:").pack(side=tk.LEFT, padx=(0, 8))
        self.game_selector = ttk.Combobox(
            game_bar,
            state="readonly",
            values=[self.game_label(game, index) for index, game in enumerate(games)],
        )
        self.game_selector.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self.game_selector.bind("<<ComboboxSelected>>", self.on_game_selected)
        ttk.Button(game_bar, text="Open PGN...", command=self.open_pgn).pack(
            side=tk.LEFT, padx=(8, 0)
        )
        ttk.Label(
            content,
            text="Drag and drop a .pgn file anywhere in this window to open it.",
        ).pack(anchor=tk.W, pady=(0, 8))

        board_area = ttk.Frame(content)
        board_area.pack(fill=tk.BOTH, expand=True)

        self.board_canvas = tk.Canvas(
            board_area,
            width=560,
            height=560,
            background=BOARD_COLORS[0],
            highlightthickness=0,
        )
        self.board_canvas.pack(side=tk.LEFT, padx=(0, 16))

        move_area = ttk.Frame(board_area)
        move_area.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self.position_label = ttk.Label(move_area, text="")
        self.position_label.pack(anchor=tk.W, pady=(0, 8))

        self.evaluation_label = ttk.Label(move_area, text="Stockfish: waiting")
        self.evaluation_label.pack(anchor=tk.W, pady=(0, 8))
        self.evaluation_bar = tk.Canvas(
            move_area, width=220, height=28, highlightthickness=0
        )
        self.evaluation_bar.pack(anchor=tk.W, pady=(0, 8))

        self.move_quality_label = ttk.Label(move_area, text="Move quality: —")
        self.move_quality_label.pack(anchor=tk.W)
        self.heat_bar = tk.Canvas(
            move_area, width=220, height=28, highlightthickness=0
        )
        self.heat_bar.pack(anchor=tk.W, pady=(2, 8))

        move_list_frame = ttk.Frame(move_area)
        move_list_frame.pack(fill=tk.BOTH, expand=True)
        self.move_list = tk.Listbox(move_list_frame, exportselection=False)
        self.move_list.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.move_list.bind("<<ListboxSelect>>", self.on_move_selected)

        scrollbar = ttk.Scrollbar(
            move_list_frame, orient=tk.VERTICAL, command=self.move_list.yview
        )
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.move_list.configure(yscrollcommand=scrollbar.set)

        controls = ttk.Frame(move_area)
        controls.pack(fill=tk.X, pady=(12, 0))
        self.first_button = ttk.Button(controls, text="|<", command=self.go_to_start)
        self.first_button.pack(side=tk.LEFT, padx=(0, 4))
        self.previous_button = ttk.Button(
            controls, text="< Previous", command=self.go_back
        )
        self.previous_button.pack(side=tk.LEFT, padx=4)
        self.next_button = ttk.Button(controls, text="Next >", command=self.go_forward)
        self.next_button.pack(side=tk.LEFT, padx=4)
        self.last_button = ttk.Button(controls, text=">|", command=self.go_to_end)
        self.last_button.pack(side=tk.LEFT, padx=4)

        root.bind("<Left>", lambda _event: self.go_back())
        root.bind("<Right>", lambda _event: self.go_forward())
        root.protocol("WM_DELETE_WINDOW", self.close)
        self.register_drop_targets(root)

        self.game_selector.current(0)
        self.engine_thread = threading.Thread(target=self.engine_worker, daemon=True)
        self.engine_thread.start()
        root.after(100, self.poll_engine_results)
        self.load_game(0)

    @staticmethod
    def game_label(game, index):
        white = game.headers.get("White", "White")
        black = game.headers.get("Black", "Black")
        return f"{index + 1}. {white} vs {black}"

    def on_game_selected(self, _event):
        self.load_game(self.game_selector.current())

    def register_drop_targets(self, widget):
        widget.drop_target_register(DND_FILES)
        widget.dnd_bind("<<Drop>>", self.on_file_drop)
        for child in widget.winfo_children():
            self.register_drop_targets(child)

    def on_file_drop(self, event):
        paths = self.root.tk.splitlist(event.data)
        if len(paths) != 1:
            messagebox.showerror(
                "Open PGN",
                "Please drop one PGN file at a time.",
                parent=self.root,
            )
            return
        self.load_pgn(Path(paths[0]))

    def open_pgn(self):
        path = filedialog.askopenfilename(
            parent=self.root,
            title="Open PGN game",
            filetypes=(("PGN files", "*.pgn"), ("All files", "*.*")),
        )
        if path:
            self.load_pgn(Path(path))

    def load_pgn(self, path):
        if path.suffix.casefold() != ".pgn":
            messagebox.showerror(
                "Open PGN",
                "Please choose a file with the .pgn extension.",
                parent=self.root,
            )
            return
        try:
            games = read_games(path)
        except (OSError, ValueError) as error:
            messagebox.showerror("Could not open PGN", str(error), parent=self.root)
            return

        self.games = games
        self.game_selector.configure(
            values=[
                self.game_label(game, index) for index, game in enumerate(games)
            ]
        )
        self.game_selector.current(0)
        self.root.title(f"Chess Game Viewer — {path.name}")
        self.load_game(0)

    def load_game(self, index):
        self.game_index = index
        game = self.games[index]
        self.moves = list(game.mainline_moves())

        board = game.board()
        self.san_moves = []
        for move in self.moves:
            self.san_moves.append(board.san(move))
            board.push(move)

        self.move_list.delete(0, tk.END)
        for ply, san in enumerate(self.san_moves):
            move_number = ply // 2 + 1
            prefix = f"{move_number}. " if ply % 2 == 0 else f"{move_number}... "
            self.move_list.insert(tk.END, prefix + san)

        self.show_position(0)

    def on_move_selected(self, _event):
        selection = self.move_list.curselection()
        if selection:
            self.show_position(selection[0] + 1)

    def show_position(self, ply):
        self.ply = max(0, min(ply, len(self.moves)))
        game = self.games[self.game_index]
        board = game.board()
        for move in self.moves[: self.ply]:
            board.push(move)

        last_move = self.moves[self.ply - 1] if self.ply else None
        self.draw_board(board, last_move)
        previous_board = None
        mover_color = None
        if self.ply:
            previous_board = board.copy()
            previous_board.pop()
            mover_color = not board.turn
        self.request_evaluation(board, previous_board, mover_color)

        if self.ply == 0:
            position = "Starting position"
        else:
            move_number = (self.ply + 1) // 2
            side = "White" if self.ply % 2 else "Black"
            move_prefix = "." if self.ply % 2 else "..."
            position = (
                f"After {move_number}{move_prefix} "
                f"{self.san_moves[self.ply - 1]} — {side} to move"
            )
        if board.is_checkmate():
            position += " — Checkmate"
        elif board.is_check():
            position += " — Check"
        self.position_label.configure(text=position)

        self.move_list.selection_clear(0, tk.END)
        if self.ply:
            self.move_list.selection_set(self.ply - 1)
            self.move_list.see(self.ply - 1)

        self.first_button.configure(state=tk.NORMAL if self.ply else tk.DISABLED)
        self.previous_button.configure(state=tk.NORMAL if self.ply else tk.DISABLED)
        at_end = self.ply >= len(self.moves)
        self.next_button.configure(state=tk.DISABLED if at_end else tk.NORMAL)
        self.last_button.configure(state=tk.DISABLED if at_end else tk.NORMAL)

    def request_evaluation(self, board, previous_board, mover_color):
        self.evaluation_generation += 1
        generation = self.evaluation_generation
        self.evaluation_label.configure(text="Evaluating position...")
        self.draw_evaluation_bar(None)
        self.move_quality_label.configure(text="Move quality: evaluating...")
        self.draw_heat_bar(None)

        while True:
            try:
                self.engine_requests.get_nowait()
            except Empty:
                break
        self.engine_requests.put_nowait(
            (
                generation,
                board.copy(),
                previous_board,
                mover_color,
            )
        )

    @staticmethod
    def format_score(score):
        if score.is_mate():
            mate = score.mate()
            if mate is None:
                return "mate"
            if mate == 0:
                return "M0"
            return f"{'+' if mate > 0 else '-'}M{abs(mate)}"

        centipawns = score.score()
        if centipawns is None:
            return "unavailable"
        return f"{centipawns / 100:+.2f}"

    @staticmethod
    def move_quality(loss):
        if loss < 0.2:
            return "Best / excellent"
        if loss < 0.5:
            return "Good"
        if loss < 1.0:
            return "Inaccuracy"
        if loss < 2.0:
            return "Mistake"
        return "Blunder"

    def draw_heat_bar(self, loss):
        canvas = self.heat_bar
        canvas.delete("all")
        left, top, right, bottom = 2, 2, 218, 16
        segments = 44
        for index in range(segments):
            ratio = index / (segments - 1)
            if ratio < 0.5:
                blend = ratio * 2
                red = round(46 + (242 - 46) * blend)
                green = round(160 + (204 - 160) * blend)
                blue = round(67 + (61 - 67) * blend)
            else:
                blend = (ratio - 0.5) * 2
                red = round(242 + (205 - 242) * blend)
                green = round(204 + (52 - 204) * blend)
                blue = round(61 + (45 - 61) * blend)
            color = f"#{red:02x}{green:02x}{blue:02x}"
            x1 = left + (right - left) * index / segments
            x2 = left + (right - left) * (index + 1) / segments
            canvas.create_rectangle(
                x1, top, x2 + 1, bottom, fill=color, outline=color
            )

        canvas.create_text(left, 23, text="Best", anchor=tk.W, font=("Segoe UI", 8))
        canvas.create_text(right, 23, text="2+ pawns lost", anchor=tk.E, font=("Segoe UI", 8))

        if loss is not None:
            position = min(max(loss / self.move_loss_scale, 0), 1)
            marker_x = left + position * (right - left)
            canvas.create_line(
                marker_x, top - 1, marker_x, bottom + 1, fill="#202020", width=3
            )

    def draw_evaluation_bar(self, white_score):
        canvas = self.evaluation_bar
        canvas.delete("all")
        left, top, right, bottom = 2, 2, 218, 18
        midpoint = (left + right) / 2
        canvas.create_rectangle(
            left, top, midpoint, bottom, fill="#292929", outline="#292929"
        )
        canvas.create_rectangle(
            midpoint, top, right, bottom, fill="#f3f0e8", outline="#f3f0e8"
        )
        if white_score is not None:
            bounded_score = max(-500, min(500, white_score))
            white_fraction = 0.5 + bounded_score / 1000
            boundary = right - (right - left) * white_fraction
            canvas.create_rectangle(
                left, top, boundary, bottom, fill="#292929", outline="#292929"
            )
            canvas.create_rectangle(
                boundary, top, right, bottom, fill="#f3f0e8", outline="#f3f0e8"
            )

        canvas.create_text(left, 24, text="Black", anchor=tk.W, font=("Segoe UI", 8))
        canvas.create_text(right, 24, text="White", anchor=tk.E, font=("Segoe UI", 8))

    @classmethod
    def format_evaluation(cls, score):
        white_score = score.pov(chess.WHITE)
        black_score = score.pov(chess.BLACK)
        return (
            f"White: {cls.format_score(white_score)}  |  "
            f"Black: {cls.format_score(black_score)}"
        )

    def engine_worker(self):
        if not ENGINE_PATH.is_file():
            self.engine_results.put(
                (None, f"Stockfish executable not found: {ENGINE_PATH}")
            )
            return

        try:
            with chess.engine.SimpleEngine.popen_uci(
                str(ENGINE_PATH), timeout=10
            ) as engine:
                while True:
                    request = self.engine_requests.get()
                    if request is None:
                        return

                    generation, board, previous_board, mover_color = request
                    try:
                        limit = chess.engine.Limit(time=0.25)
                        current_info = engine.analyse(board, limit)
                        move_loss = None
                        if previous_board is not None:
                            best_info = engine.analyse(previous_board, limit)
                            best_score = best_info["score"].pov(mover_color).score(
                                mate_score=100000
                            )
                            played_score = current_info["score"].pov(
                                mover_color
                            ).score(mate_score=100000)
                            move_loss = max(0, (best_score - played_score) / 100)
                    except (OSError, TimeoutError, chess.engine.EngineError) as error:
                        self.engine_results.put(
                            (generation, None, None, None, f"Stockfish error: {error}")
                        )
                        return

                    evaluation = self.format_evaluation(current_info["score"])
                    white_score = current_info["score"].pov(chess.WHITE).score(
                        mate_score=100000
                    )
                    self.engine_results.put(
                        (generation, evaluation, white_score, move_loss, None)
                    )
        except (OSError, TimeoutError, chess.engine.EngineError) as error:
            self.engine_results.put(
                (None, None, None, None, f"Could not start Stockfish: {error}")
            )

    def poll_engine_results(self):
        while True:
            try:
                generation, evaluation, white_score, move_loss, error = (
                    self.engine_results.get_nowait()
                )
            except Empty:
                break
            if generation is None or generation == self.evaluation_generation:
                if error is not None:
                    self.evaluation_label.configure(text=error)
                    self.draw_evaluation_bar(None)
                    self.move_quality_label.configure(text="Move quality unavailable")
                    self.draw_heat_bar(None)
                else:
                    self.evaluation_label.configure(text=evaluation)
                    self.draw_evaluation_bar(white_score)
                    if move_loss is None:
                        self.move_quality_label.configure(
                            text="Move quality: make or select a move"
                        )
                    else:
                        self.move_quality_label.configure(
                            text=(
                                f"Move quality: {self.move_quality(move_loss)} "
                                f"({move_loss:.2f} pawn loss)"
                            )
                        )
                    self.draw_heat_bar(move_loss)

        if not self.closed:
            self.root.after(100, self.poll_engine_results)

    def close(self):
        self.closed = True
        while True:
            try:
                self.engine_requests.get_nowait()
            except Empty:
                break
        self.engine_requests.put_nowait(None)
        self.root.destroy()

    def draw_board(self, board, last_move):
        square_size = 70
        canvas = self.board_canvas
        canvas.delete("all")

        highlighted_squares = set()
        if last_move is not None:
            highlighted_squares.update((last_move.from_square, last_move.to_square))
        if board.is_check():
            king_square = board.king(board.turn)
            if king_square is not None:
                highlighted_squares.add(king_square)

        for rank in range(7, -1, -1):
            for file_index in range(8):
                square = chess.square(file_index, rank)
                x1 = file_index * square_size
                y1 = (7 - rank) * square_size
                color = (
                    HIGHLIGHT_COLOR
                    if square in highlighted_squares
                    else BOARD_COLORS[(file_index + rank) % 2]
                )
                canvas.create_rectangle(
                    x1,
                    y1,
                    x1 + square_size,
                    y1 + square_size,
                    fill=color,
                    outline=color,
                )

                piece = board.piece_at(square)
                if piece is not None:
                    glyph = PIECE_GLYPHS[piece.piece_type][0 if piece.color else 1]
                    x = x1 + square_size / 2
                    y = y1 + square_size / 2
                    fill = "#fffdf5" if piece.color else "#202020"
                    shadow = "#544b3d" if piece.color else "#fffdf5"
                    canvas.create_text(
                        x + 1,
                        y + 2,
                        text=glyph,
                        font=("Segoe UI Symbol", 46),
                        fill=shadow,
                    )
                    canvas.create_text(
                        x,
                        y,
                        text=glyph,
                        font=("Segoe UI Symbol", 46),
                        fill=fill,
                    )

    def go_to_start(self):
        self.show_position(0)

    def go_back(self):
        self.show_position(self.ply - 1)

    def go_forward(self):
        self.show_position(self.ply + 1)

    def go_to_end(self):
        self.show_position(len(self.moves))


def read_games(pgn_path):
    games = []
    with pgn_path.open(encoding="utf-8") as pgn_file:
        while True:
            game = chess.pgn.read_game(pgn_file)
            if game is None:
                break
            games.append(game)
    if not games:
        raise ValueError(f"No chess games found in {pgn_path}")
    return games


def main():
    pgn_path = Path(__file__).with_name("dk.pgn")
    games = read_games(pgn_path)
    root = TkinterDnD.Tk()
    ChessGameViewer(root, games)
    root.mainloop()


if __name__ == "__main__":
    main()
