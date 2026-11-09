import { Chess } from "chess.js";

const PIECES = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

const state = {
  games: [],
  gameIndex: 0,
  ply: 0,
  analysisRequest: 0,
  engine: null,
  bestMove: null,
  showBestMove: false,
  selectedSquare: null,
  pendingPromotion: null,
  pointerSource: null,
  pointerId: null,
  suppressBoardClick: false,
  exploration: null,
  fileDragDepth: 0,
};

const elements = {
  board: document.querySelector("#board"),
  blackPlayer: document.querySelector("#black-player"),
  whitePlayer: document.querySelector("#white-player"),
  gameSelect: document.querySelector("#game-select"),
  moveIndicator: document.querySelector("#move-indicator"),
  moveList: document.querySelector("#move-list"),
  moveCount: document.querySelector("#move-count"),
  toggleMovesButton: document.querySelector("#toggle-moves-button"),
  moveContent: document.querySelector("#move-content"),
  whiteScore: document.querySelector("#white-score"),
  blackScore: document.querySelector("#black-score"),
  evaluationBar: document.querySelector("#evaluation-bar"),
  evaluationMarker: document.querySelector("#evaluation-marker"),
  analysisStatus: document.querySelector("#analysis-status"),
  bestMoveButton: document.querySelector("#best-move-button"),
  bestMoveText: document.querySelector("#best-move-text"),
  qualityBadge: document.querySelector("#quality-badge"),
  qualityMarker: document.querySelector("#quality-marker"),
  moveLoss: document.querySelector("#move-loss"),
  explanationTitle: document.querySelector("#explanation-title"),
  explanationText: document.querySelector("#explanation-text"),
  explanationDetail: document.querySelector("#explanation-detail"),
  appMessage: document.querySelector("#app-message"),
  fileInput: document.querySelector("#pgn-input"),
  promotionDialog: document.querySelector("#promotion-dialog"),
  promotionOptions: document.querySelector("#promotion-options"),
};

function showMessage(message = "") {
  elements.appMessage.textContent = message;
}

function currentGame() {
  return state.games[state.gameIndex];
}

function currentFen(game = currentGame(), ply = state.ply) {
  return game.positions[ply];
}

function displayedFen(game = currentGame(), ply = state.ply) {
  return state.exploration?.fen || currentFen(game, ply);
}

class BrowserStockfish {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.worker = new Worker("/vendor/stockfish-19-lite-single.js");
    this.active = null;
    this.pending = null;
    this.ready = false;
    this.cache = new Map();
    this.onStatus("Loading Stockfish WASM…");
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.worker.addEventListener("message", (event) => {
      this.handleMessage(String(event.data));
    });
    this.worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "Stockfish worker failed to load.");
      this.rejectReady(error);
      this.active?.reject(error);
      this.pending?.reject(error);
      this.active = null;
      this.pending = null;
      this.onStatus(error.message);
    });
    this.worker.postMessage("uci");
  }

  handleMessage(line) {
    if (line === "uciok") {
      this.worker.postMessage("setoption name Threads value 1");
      this.worker.postMessage("setoption name Hash value 32");
      this.worker.postMessage("isready");
      return;
    }

    if (line === "readyok") {
      this.ready = true;
      this.resolveReady();
      this.onStatus("Stockfish ready in your browser");
      this.startNext();
      return;
    }

    if (line.startsWith("info ") && this.active) {
      const match = line.match(/\bscore (cp|mate) (-?\d+)/);
      if (match) {
        const value = Number(match[2]);
        this.active.score = match[1] === "cp"
          ? { cp: value, mate: null }
          : {
              cp: value === 0 ? -100000 : Math.sign(value) * (100000 - Math.abs(value)),
              mate: value,
            };
      }
      return;
    }

    if (line.startsWith("bestmove ") && this.active) {
      const job = this.active;
      this.active = null;
      const turnSign = job.fen.split(" ")[1] === "w" ? 1 : -1;
      const score = {
        cp: job.score.cp * turnSign,
        mate: job.score.mate === null ? null : job.score.mate * turnSign,
      };
      const result = { ...score, bestMove: line.split(/\s+/)[1] };
      this.cache.set(job.fen, result);
      if (this.cache.size > 256) {
        this.cache.delete(this.cache.keys().next().value);
      }
      job.resolve(result);
      this.startNext();
    }
  }

  analyze(fen, depth = 11) {
    return new Promise((resolve, reject) => {
      if (this.cache.has(fen)) {
        resolve(this.cache.get(fen));
        return;
      }
      if (this.pending) {
        this.pending.reject(new DOMException("Analysis superseded.", "AbortError"));
      }
      this.pending = { fen, depth, resolve, reject };
      if (this.active) {
        this.worker.postMessage("stop");
      } else {
        this.startNext();
      }
    });
  }

  async startNext() {
    if (this.active || !this.pending) return;
    try {
      await this.readyPromise;
    } catch {
      return;
    }
    if (this.active || !this.pending) return;

    this.active = { ...this.pending, score: { cp: 0, mate: null } };
    this.pending = null;
    this.worker.postMessage(`position fen ${this.active.fen}`);
    this.worker.postMessage(`go depth ${this.active.depth}`);
  }
}

function setQuality(name, loss) {
  elements.qualityBadge.className = "quality-badge";
  if (name === null) {
    elements.qualityBadge.textContent = "—";
    elements.qualityBadge.classList.add("neutral");
    elements.qualityMarker.style.left = "0%";
    elements.moveLoss.textContent = "Play or select a move to review it.";
    return;
  }

  const classes = {
    "Best / excellent": "excellent",
    Good: "good",
    Inaccuracy: "inaccuracy",
    Mistake: "mistake",
    Blunder: "blunder",
  };
  elements.qualityBadge.textContent = name;
  elements.qualityBadge.classList.add(classes[name] || "neutral");
  elements.qualityMarker.style.left = `${Math.min(loss / 2, 1) * 100}%`;
  elements.moveLoss.textContent = `${loss.toFixed(2)} pawn loss`;
}

function resetAnalysis(message) {
  elements.whiteScore.textContent = "—";
  elements.blackScore.textContent = "—";
  elements.evaluationBar.style.background = "";
  elements.evaluationMarker.style.left = "50%";
  elements.analysisStatus.textContent = message;
  setQuality(null);
  state.bestMove = null;
  state.showBestMove = false;
  elements.bestMoveButton.disabled = true;
  elements.bestMoveButton.textContent = "Show best move";
  elements.bestMoveText.textContent = message;
}

function formatScore(score, isWhite, gameOver) {
  const sign = isWhite ? 1 : -1;
  if (score.mate !== null) {
    const mate = score.mate * sign;
    if (gameOver && score.mate === 0) {
      return score.cp * sign >= 0 ? "+M0" : "-M0";
    }
    return `${mate > 0 ? "+" : "-"}M${Math.abs(mate)}`;
  }
  const centipawns = score.cp * sign;
  if (Math.abs(centipawns) >= 100000) {
    return centipawns > 0 ? "+M0" : "-M0";
  }
  return `${centipawns >= 0 ? "+" : ""}${(centipawns / 100).toFixed(2)}`;
}

function moveQuality(loss) {
  if (loss < 0.2) return "Best / excellent";
  if (loss < 0.5) return "Good";
  if (loss < 1) return "Inaccuracy";
  if (loss < 2) return "Mistake";
  return "Blunder";
}

function moveExplanation(move, alternative, loss, playedBestMove) {
  const quality = moveQuality(loss);
  const moveName = move.san;
  const alternativeText = alternative
    ? `Stockfish's top continuation was ${alternative}.`
    : "There was no alternative move.";
  let context = "";

  if (move.flags.includes("k") || move.flags.includes("q")) {
    context = " Castling moves the king toward safety and brings a rook into play.";
  } else if (move.san.endsWith("#")) {
    context = " This delivers checkmate and ends the game.";
  } else if (move.san.endsWith("+")) {
    context = " This gives check, forcing the opponent to answer the king threat.";
  } else if (move.captured) {
    const pieceNames = {
      p: "pawn",
      n: "knight",
      b: "bishop",
      r: "rook",
      q: "queen",
    };
    context = ` This captures a ${pieceNames[move.captured] || "piece"}.`;
  } else if (move.promotion) {
    context = ` This promotes a pawn to a ${move.promotion}.`;
  }

  if (playedBestMove) {
    return {
      title: `${moveName}: engine's top choice`,
      text: `${moveName} matches Stockfish's best move, keeping the strongest continuation available.`,
      detail: context.trim() || `The engine found no better move in this position. Evaluation loss: ${loss.toFixed(2)} pawns.`,
    };
  }

  if (loss < 0.2) {
    return {
      title: `${moveName}: ${quality.toLowerCase()}`,
      text: `${moveName} is very close to the engine's top choice, with only ${loss.toFixed(2)} pawns of evaluation difference.`,
      detail: `${alternativeText}${context}`,
    };
  }

  return {
    title: `${moveName}: ${quality.toLowerCase()}`,
    text: `${moveName} gives up ${loss.toFixed(2)} pawns of evaluation compared with the engine's strongest continuation.`,
    detail: `${alternativeText}${context || " The resulting position is what Stockfish evaluates; try the suggested move to compare."}`,
  };
}

function resetMoveExplanation() {
  elements.explanationTitle.textContent = "Move explanation";
  elements.explanationText.textContent =
    "Select a move to see why Stockfish considers it strong or weak.";
  elements.explanationDetail.textContent =
    "Explanations use the engine's evaluation and best continuation. No move data leaves your browser.";
}

function paintEvaluation(score) {
  const clampedScore = Math.max(-500, Math.min(500, score.cp));
  const whiteFraction = 0.5 + clampedScore / 1000;
  const blackPercent = (1 - whiteFraction) * 100;
  elements.evaluationBar.style.background =
    `linear-gradient(to right, #292e2a 0%, #292e2a ${blackPercent}%, ` +
    `#eeece4 ${blackPercent}%, #eeece4 100%)`;
  elements.evaluationMarker.style.left = `${blackPercent}%`;
}

async function analyzePosition(game, ply) {
  const requestId = ++state.analysisRequest;
  const analysisFen = displayedFen(game, ply);
  const variation = state.exploration?.moves.at(-1);
  const previousFen = variation?.previousFen ||
    (ply > 0 ? currentFen(game, ply - 1) : null);
  const playedMove = variation?.move || (ply > 0 ? game.moves[ply - 1] : null);
  resetAnalysis("Analyzing in your browser…");

  try {
    let moveLoss = null;
    if (previousFen && playedMove) {
      const bestScore = await state.engine.analyze(previousFen);
      if (requestId !== state.analysisRequest) return;
      const previousPosition = new Chess(previousFen);
      const moverSign = previousPosition.turn() === "w" ? 1 : -1;
      const bestMove = bestScore.bestMove
        ? previousPosition.move({
            from: bestScore.bestMove.slice(0, 2),
            to: bestScore.bestMove.slice(2, 4),
            promotion: bestScore.bestMove[4],
          })
        : null;
      moveLoss = {
        bestScore,
        moverSign,
        bestMoveSan: bestMove?.san || null,
        bestMoveUci: bestScore.bestMove,
        playedMove,
      };
    }

    const position = new Chess(analysisFen);
    let evaluation;
    let bestMoveUci = null;
    if (position.isCheckmate()) {
      evaluation = {
        cp: position.turn() === "w" ? -100000 : 100000,
        mate: 0,
      };
    } else if (position.isDraw()) {
      evaluation = { cp: 0, mate: null };
    } else {
      evaluation = await state.engine.analyze(analysisFen);
      bestMoveUci = evaluation.bestMove;
    }
    if (requestId !== state.analysisRequest) return;

    elements.whiteScore.textContent = formatScore(
      evaluation,
      true,
      position.isGameOver(),
    );
    elements.blackScore.textContent = formatScore(
      evaluation,
      false,
      position.isGameOver(),
    );
    paintEvaluation(evaluation);
    state.bestMove = bestMoveUci
      ? {
          from: bestMoveUci.slice(0, 2),
          to: bestMoveUci.slice(2, 4),
          promotion: bestMoveUci[4],
        }
      : null;
    state.showBestMove = false;
    elements.bestMoveButton.disabled = !state.bestMove;
    elements.bestMoveButton.textContent = "Show best move";
    if (state.bestMove) {
      const bestPosition = new Chess(analysisFen);
      const bestMove = bestPosition.move({
        from: state.bestMove.from,
        to: state.bestMove.to,
        promotion: state.bestMove.promotion,
      });
      state.bestMove.san = bestMove.san;
      elements.bestMoveText.textContent =
        `Stockfish recommends ${bestMove.san} (${state.bestMove.from} → ${state.bestMove.to})`;
    } else {
      elements.bestMoveText.textContent = "No legal moves in this position.";
    }
    renderBoard(game, ply);
    elements.analysisStatus.textContent = position.isGameOver()
      ? "Game over"
      : "Evaluated locally by Stockfish";

    if (moveLoss === null) {
      setQuality(null);
      resetMoveExplanation();
    } else {
      const playedScore = evaluation.cp * moveLoss.moverSign;
      const bestMoveScore = moveLoss.bestScore.cp * moveLoss.moverSign;
      const loss = Math.max(0, (bestMoveScore - playedScore) / 100);
      setQuality(moveQuality(loss), loss);
      const explanation = moveExplanation(
        moveLoss.playedMove,
        moveLoss.bestMoveSan,
        loss,
        moveLoss.playedMove.uci === moveLoss.bestMoveUci,
      );
      elements.explanationTitle.textContent = explanation.title;
      elements.explanationText.textContent = explanation.text;
      elements.explanationDetail.textContent = explanation.detail;
    }
  } catch (error) {
    if (error.name === "AbortError" || requestId !== state.analysisRequest) return;
    elements.analysisStatus.textContent = error.message;
    resetQualityOnError();
    elements.explanationTitle.textContent = "Analysis unavailable";
    elements.explanationText.textContent = error.message;
    elements.explanationDetail.textContent =
      "Check that Stockfish WASM loaded, then select the move again.";
  }
}

function resetQualityOnError() {
  elements.qualityBadge.className = "quality-badge neutral";
  elements.qualityBadge.textContent = "Unavailable";
  elements.qualityMarker.style.left = "0%";
  elements.moveLoss.textContent = "Stockfish could not evaluate this position.";
}

function renderBoard(game, ply) {
  const position = new Chess(displayedFen(game, ply));
  const variationMoves = state.exploration?.moves;
  let lastMove = variationMoves?.length
    ? variationMoves.at(-1).move.uci
    : ply ? game.moves[ply - 1].uci : null;
  if (state.showBestMove && state.bestMove) {
    const previewMove = position.move({
      from: state.bestMove.from,
      to: state.bestMove.to,
      promotion: state.bestMove.promotion,
    });
    if (previewMove) lastMove = `${previewMove.from}${previewMove.to}`;
  }
  const [placement] = position.fen().split(" ");
  const turn = position.turn();
  const ranks = placement.split("/");
  elements.board.replaceChildren();

  ranks.forEach((rankText, row) => {
    let file = 0;
    for (const char of rankText) {
      if (/\d/.test(char)) {
        for (let empty = 0; empty < Number(char); empty += 1) {
          appendSquare(row, file, null, lastMove);
          file += 1;
        }
        continue;
      }

      appendSquare(row, file, char, lastMove);
      file += 1;
    }
  });

  if (position.isCheck()) {
    const king = turn === "w" ? "K" : "k";
    const kingPiece = [...elements.board.querySelectorAll(".piece")].find(
      (piece) => piece.textContent === PIECES[king],
    );
    const kingSquare = kingPiece?.parentElement;
    kingSquare?.classList.add("in-check");
  }
  if (state.showBestMove && state.bestMove) {
    for (const square of elements.board.querySelectorAll(".square")) {
      if (square.dataset.square === state.bestMove.from) {
        square.classList.add("best-move-from");
      } else if (square.dataset.square === state.bestMove.to) {
        square.classList.add("best-move-to");
      }
    }
    return;
  }

  if (state.selectedSquare) {
    elements.board
      .querySelector(`[data-square="${state.selectedSquare}"]`)
      ?.classList.add("selected-square");
    const targets = position.moves({ square: state.selectedSquare, verbose: true });
    for (const move of targets) {
      const target = elements.board.querySelector(`[data-square="${move.to}"]`);
      target?.classList.add("legal-target");
      if (move.captured || move.flags.includes("e")) {
        target?.classList.add("legal-capture");
      }
    }
  }
}

function parsePgn(pgnText, filename) {
  const starts = [...pgnText.matchAll(/^\[Event\s/mg)].map((match) => match.index);
  const chunks = starts.length > 1
    ? starts.map((start, index) => pgnText.slice(start, starts[index + 1] ?? pgnText.length))
    : [pgnText];
  const games = [];

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const chess = new Chess();
    chess.loadPgn(chunk);
    const history = chess.history({ verbose: true });
    const headers = chess.getHeaders();
    const positions = history.length
      ? [history[0].before, ...history.map((move) => move.after)]
      : [headers.FEN || chess.fen()];

    games.push({
      id: `${filename}:${games.length}`,
      filename,
      white: headers.White || "White",
      black: headers.Black || "Black",
      result: headers.Result || "*",
      initialFen: positions[0],
      positions,
      moves: history.map((move) => ({
        san: move.san,
        uci: `${move.from}${move.to}${move.promotion || ""}`,
        fen: move.after,
        check: /[+#]$/.test(move.san),
        checkmate: move.san.endsWith("#"),
        flags: move.flags,
        captured: move.captured,
        promotion: move.promotion,
      })),
    });
  }

  if (!games.length) {
    throw new Error("No chess games were found in this PGN.");
  }
  return games;
}

function appendSquare(row, file, pieceChar, lastMove) {
  const squareName = `${"abcdefgh"[file]}${8 - row}`;
  const square = document.createElement("button");
  square.type = "button";
  square.className = `square ${(row + file) % 2 ? "dark" : "light"}`;
  square.dataset.square = squareName;
  square.setAttribute(
    "aria-label",
    pieceChar ? `${squareName} ${PIECES[pieceChar]}` : squareName,
  );
  square.setAttribute("aria-pressed", String(state.selectedSquare === squareName));
  square.disabled = state.showBestMove;
  if (
    lastMove &&
    (lastMove.slice(0, 2) === squareName || lastMove.slice(2, 4) === squareName)
  ) {
    square.classList.add("last-move");
  }
  if (file === 0) {
    const label = document.createElement("span");
    label.className = "rank-label";
    label.textContent = String(8 - row);
    square.append(label);
  }

  if (pieceChar) {
    const piece = document.createElement("span");
    piece.className = `piece ${pieceChar === pieceChar.toUpperCase() ? "white" : "black"}`;
    piece.textContent = PIECES[pieceChar];
    piece.draggable = false;
    square.append(piece);
  }
  elements.board.append(square);
}

function attemptMove(from, to) {
  const position = new Chess(displayedFen());
  const move = position.moves({ square: from, verbose: true })
    .find((candidate) => candidate.to === to);
  if (!move) return false;

  if (move.promotion) {
    state.pendingPromotion = { from, to };
    const pieceColor = position.turn();
    const icons = pieceColor === "w"
      ? { q: "♕", r: "♖", b: "♗", n: "♘" }
      : { q: "♛", r: "♜", b: "♝", n: "♞" };
    for (const button of elements.promotionOptions.querySelectorAll("[data-promotion]")) {
      const choice = button.dataset.promotion;
      button.textContent = `${icons[choice]} ${choice.toUpperCase()}`;
    }
    elements.promotionDialog.showModal();
    return true;
  }

  commitMove(from, to);
  return true;
}

function commitMove(from, to, promotion) {
  const game = currentGame();
  const previousFen = displayedFen(game, state.ply);
  const position = new Chess(previousFen);
  const move = position.move({ from, to, promotion });
  if (!move) return;

  const variationMove = {
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion || ""}`,
    fen: move.after,
    check: /[+#]$/.test(move.san),
    checkmate: move.san.endsWith("#"),
    flags: move.flags,
    captured: move.captured,
    promotion: move.promotion,
  };
  state.exploration ||= { basePly: state.ply, moves: [] };
  state.exploration.moves.push({ previousFen, fen: move.after, move: variationMove });
  state.exploration.fen = move.after;
  state.selectedSquare = null;
  state.showBestMove = false;
  showMessage(`${move.san} added to a temporary analysis line. The PGN is unchanged.`);
  renderPosition();
}

function renderMoveList(game) {
  elements.moveList.replaceChildren();
  elements.moveCount.textContent = `${game.moves.length} ${game.moves.length === 1 ? "ply" : "plies"}`;

  for (let index = 0; index < game.moves.length; index += 2) {
    const row = document.createElement("div");
    row.className = "move-row";

    const number = document.createElement("span");
    number.className = "move-number";
    number.textContent = `${Math.floor(index / 2) + 1}.`;
    row.append(number);

    for (let offset = 0; offset < 2; offset += 1) {
      const moveIndex = index + offset;
      const move = game.moves[moveIndex];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "move-button";
      if (move) {
        button.textContent = move.san;
        button.setAttribute(
          "aria-label",
          `${offset === 0 ? "White" : "Black"} move ${Math.floor(index / 2) + 1}: ${move.san}`,
        );
        if (state.ply === moveIndex + 1) button.classList.add("selected");
        button.addEventListener("click", () => showPosition(moveIndex + 1));
      } else {
        button.classList.add("empty");
        button.disabled = true;
      }
      row.append(button);
    }
    elements.moveList.append(row);
  }

  const selectedMove = elements.moveList.querySelector(".move-button.selected");
  if (selectedMove) {
    const listBounds = elements.moveList.getBoundingClientRect();
    const moveBounds = selectedMove.getBoundingClientRect();
    if (moveBounds.top < listBounds.top) {
      elements.moveList.scrollTop -= listBounds.top - moveBounds.top;
    } else if (moveBounds.bottom > listBounds.bottom) {
      elements.moveList.scrollTop += moveBounds.bottom - listBounds.bottom;
    }
  }
}

function renderPosition() {
  const game = currentGame();
  if (!game) return;

  state.ply = Math.max(0, Math.min(state.ply, game.moves.length));
  state.selectedSquare = null;
  state.showBestMove = false;
  elements.whitePlayer.textContent = game.white;
  elements.blackPlayer.textContent = game.black;
  elements.whitePlayer.title = game.white;
  elements.blackPlayer.title = game.black;
  elements.moveIndicator.textContent = state.exploration
    ? `Analysis line: ${state.exploration.moves.map(({ move }) => move.san).join(" ")}`
    : state.ply
      ? `After ${Math.ceil(state.ply / 2)}${state.ply % 2 ? "." : "..."} ${game.moves[state.ply - 1].san}`
      : "Starting position";
  renderBoard(game, state.ply);
  renderMoveList(game);

  document.querySelector("#start-button").disabled = state.ply === 0;
  document.querySelector("#previous-button").disabled = state.ply === 0;
  document.querySelector("#next-button").disabled = state.ply === game.moves.length;
  document.querySelector("#end-button").disabled = state.ply === game.moves.length;
  resetMoveExplanation();
  analyzePosition(game, state.ply);
}

function showPosition(ply) {
  state.exploration = null;
  state.ply = ply;
  renderPosition();
}

function selectGame(index) {
  state.gameIndex = index;
  state.ply = 0;
  state.exploration = null;
  renderPosition();
}

function renderGameSelector() {
  elements.gameSelect.replaceChildren();
  state.games.forEach((game, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${game.filename} · ${game.white} vs ${game.black}`;
    elements.gameSelect.append(option);
  });
  elements.gameSelect.value = String(state.gameIndex);
}

function loadGames(games, message) {
  state.games = games;
  state.gameIndex = 0;
  state.ply = 0;
  state.exploration = null;
  renderGameSelector();
  if (games.length) {
    showMessage(message || "");
    renderPosition();
  }
}

async function loadPgnFile(file) {
  showMessage("");
  if (!file.name.toLowerCase().endsWith(".pgn")) {
    showMessage("Please choose a file with the .pgn extension.");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showMessage("PGN files must be smaller than 5 MB.");
    return;
  }

  try {
    const games = parsePgn(await file.text(), file.name);
    loadGames(games, `Loaded ${games.length} game${games.length === 1 ? "" : "s"} from ${file.name}.`);
  } catch (error) {
    showMessage(error.message);
  } finally {
    elements.fileInput.value = "";
  }
}

document.querySelector("#start-button").addEventListener("click", () => showPosition(0));
document.querySelector("#previous-button").addEventListener("click", () => showPosition(state.ply - 1));
document.querySelector("#next-button").addEventListener("click", () => showPosition(state.ply + 1));
document.querySelector("#end-button").addEventListener("click", () => showPosition(currentGame().moves.length));
elements.bestMoveButton.addEventListener("click", () => {
  state.showBestMove = !state.showBestMove;
  elements.bestMoveButton.textContent = state.showBestMove
    ? "Return to position"
    : "Show best move";
  elements.bestMoveText.textContent = state.showBestMove
    ? `Previewing ${state.bestMove.san} on the board.`
    : `Stockfish recommends ${state.bestMove.san} (${state.bestMove.from} → ${state.bestMove.to})`;
  renderBoard(currentGame(), state.ply);
});
elements.toggleMovesButton.addEventListener("click", () => {
  const expanded = elements.toggleMovesButton.getAttribute("aria-expanded") === "true";
  elements.toggleMovesButton.setAttribute("aria-expanded", String(!expanded));
  elements.toggleMovesButton.textContent = expanded ? "Show moves" : "Hide moves";
  elements.moveContent.hidden = expanded;
});
elements.board.addEventListener("click", (event) => {
  if (state.suppressBoardClick) {
    state.suppressBoardClick = false;
    return;
  }
  const square = event.target.closest(".square");
  if (!square || state.showBestMove) return;

  const squareName = square.dataset.square;
  const position = new Chess(displayedFen());
  if (state.selectedSquare && attemptMove(state.selectedSquare, squareName)) return;

  const piece = position.get(squareName);
  if (piece && piece.color === position.turn()) {
    state.selectedSquare = squareName;
  } else {
    state.selectedSquare = null;
  }
  renderBoard(currentGame(), state.ply);
});
elements.board.addEventListener("pointerdown", (event) => {
  const piece = event.target.closest(".piece");
  const square = piece?.closest(".square");
  if (!square || state.showBestMove) return;
  const chess = new Chess(displayedFen());
  const selectedPiece = chess.get(square.dataset.square);
  if (!selectedPiece || selectedPiece.color !== chess.turn()) return;
  state.pointerSource = square.dataset.square;
  state.pointerId = event.pointerId;
});
elements.board.addEventListener("pointerup", (event) => {
  if (event.pointerId !== state.pointerId || !state.pointerSource) return;
  const from = state.pointerSource;
  state.pointerSource = null;
  state.pointerId = null;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".square");
  if (!target || target.dataset.square === from) return;

  state.suppressBoardClick = true;
  setTimeout(() => {
    state.suppressBoardClick = false;
  }, 0);
  state.selectedSquare = null;
  if (attemptMove(from, target.dataset.square)) {
    return;
  }
  state.selectedSquare = from;
  renderBoard(currentGame(), state.ply);
});
elements.board.addEventListener("pointercancel", () => {
  state.pointerSource = null;
  state.pointerId = null;
});
elements.promotionOptions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-promotion]");
  if (!button || !state.pendingPromotion) return;
  const { from, to } = state.pendingPromotion;
  state.pendingPromotion = null;
  elements.promotionDialog.close();
  commitMove(from, to, button.dataset.promotion);
});
elements.promotionDialog.addEventListener("close", () => {
  state.pendingPromotion = null;
  state.selectedSquare = null;
  renderBoard(currentGame(), state.ply);
});
elements.gameSelect.addEventListener("change", () => selectGame(Number(elements.gameSelect.value)));
elements.fileInput.addEventListener("change", () => {
  if (elements.fileInput.files.length) loadPgnFile(elements.fileInput.files[0]);
});

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

document.addEventListener("dragenter", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  state.fileDragDepth += 1;
  document.body.classList.add("pgn-drag-over");
});
document.addEventListener("dragover", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
document.addEventListener("dragleave", (event) => {
  if (!isFileDrag(event)) return;
  state.fileDragDepth = Math.max(0, state.fileDragDepth - 1);
  if (state.fileDragDepth === 0) {
    document.body.classList.remove("pgn-drag-over");
  }
});
document.addEventListener("drop", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  state.fileDragDepth = 0;
  document.body.classList.remove("pgn-drag-over");
  const [file] = event.dataTransfer.files;
  if (file) loadPgnFile(file);
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === "ArrowLeft") showPosition(state.ply - 1);
  if (event.key === "ArrowRight") showPosition(state.ply + 1);
});

async function initialize() {
  try {
    state.engine = new BrowserStockfish((status) => {
      elements.analysisStatus.textContent = status;
      document.querySelector(".engine-indicator").lastChild.textContent = status;
    });

    const manifestResponse = await fetch("/games/manifest.json");
    if (!manifestResponse.ok) {
      throw new Error("Could not load the bundled PGN list.");
    }
    const manifest = await manifestResponse.json();
    const games = [];
    for (const filename of manifest.files) {
      const response = await fetch(`/games/${encodeURIComponent(filename)}`);
      if (!response.ok) {
        throw new Error(`Could not load ${filename}.`);
      }
      games.push(...parsePgn(await response.text(), filename));
    }

    if (!games.length) {
      showMessage("No bundled PGN games found. Drop a PGN file to get started.");
      return;
    }
    loadGames(games);
  } catch (error) {
    showMessage(error.message);
    elements.analysisStatus.textContent = "Could not load games.";
  }
}

initialize();
