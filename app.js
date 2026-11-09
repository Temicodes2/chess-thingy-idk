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
  analysisController: null,
};

const elements = {
  board: document.querySelector("#board"),
  blackPlayer: document.querySelector("#black-player"),
  whitePlayer: document.querySelector("#white-player"),
  gameSelect: document.querySelector("#game-select"),
  moveIndicator: document.querySelector("#move-indicator"),
  moveList: document.querySelector("#move-list"),
  moveCount: document.querySelector("#move-count"),
  whiteScore: document.querySelector("#white-score"),
  blackScore: document.querySelector("#black-score"),
  evaluationBar: document.querySelector("#evaluation-bar"),
  evaluationMarker: document.querySelector("#evaluation-marker"),
  analysisStatus: document.querySelector("#analysis-status"),
  qualityBadge: document.querySelector("#quality-badge"),
  qualityMarker: document.querySelector("#quality-marker"),
  moveLoss: document.querySelector("#move-loss"),
  appMessage: document.querySelector("#app-message"),
  dropzone: document.querySelector("#dropzone"),
  fileInput: document.querySelector("#pgn-input"),
};

function showMessage(message = "") {
  elements.appMessage.textContent = message;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}

function currentGame() {
  return state.games[state.gameIndex];
}

function currentFen(game = currentGame(), ply = state.ply) {
  return ply === 0 ? game.initialFen : game.moves[ply - 1].fen;
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
  if (state.analysisController) state.analysisController.abort();

  const controller = new AbortController();
  state.analysisController = controller;
  resetAnalysis("Analyzing with Stockfish…");

  const payload = { fen: currentFen(game, ply) };
  if (ply > 0) {
    const previousFen = currentFen(game, ply - 1);
    payload.beforeFen = previousFen;
    payload.mover = previousFen.split(" ")[1] === "w" ? "white" : "black";
  }

  try {
    const result = await requestJson("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (requestId !== state.analysisRequest) return;

    elements.whiteScore.textContent = formatScore(
      result.evaluation,
      true,
      result.evaluation.mate === 0,
    );
    elements.blackScore.textContent = formatScore(
      result.evaluation,
      false,
      result.evaluation.mate === 0,
    );
    paintEvaluation(result.evaluation);
    elements.analysisStatus.textContent = "Evaluated by Stockfish";

    if (result.moveLoss === null) {
      setQuality(null);
    } else {
      setQuality(moveQuality(result.moveLoss), result.moveLoss);
    }
  } catch (error) {
    if (error.name === "AbortError" || requestId !== state.analysisRequest) return;
    elements.analysisStatus.textContent = error.message;
    resetQualityOnError();
  }
}

function resetQualityOnError() {
  elements.qualityBadge.className = "quality-badge neutral";
  elements.qualityBadge.textContent = "Unavailable";
  elements.qualityMarker.style.left = "0%";
  elements.moveLoss.textContent = "Stockfish could not evaluate this position.";
}

function renderBoard(game, ply) {
  const fen = currentFen(game, ply);
  const [placement, turn] = fen.split(" ");
  const ranks = placement.split("/");
  const lastMove = ply ? game.moves[ply - 1].uci : null;
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

  if (ply > 0 && game.moves[ply - 1].check) {
    const king = turn === "w" ? "K" : "k";
    const kingPiece = [...elements.board.querySelectorAll(".piece")].find(
      (piece) => piece.textContent === PIECES[king],
    );
    const kingSquare = kingPiece?.parentElement;
    kingSquare?.classList.add("in-check");
  }
}

function appendSquare(row, file, pieceChar, lastMove) {
  const squareName = `${"abcdefgh"[file]}${8 - row}`;
  const square = document.createElement("div");
  square.className = `square ${(row + file) % 2 ? "dark" : "light"}`;
  square.setAttribute("role", "gridcell");
  square.setAttribute(
    "aria-label",
    pieceChar ? `${squareName} ${PIECES[pieceChar]}` : squareName,
  );
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
    square.append(piece);
  }
  elements.board.append(square);
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
  selectedMove?.scrollIntoView({ block: "nearest" });
}

function renderPosition() {
  const game = currentGame();
  if (!game) return;

  state.ply = Math.max(0, Math.min(state.ply, game.moves.length));
  elements.whitePlayer.textContent = game.white;
  elements.blackPlayer.textContent = game.black;
  elements.whitePlayer.title = game.white;
  elements.blackPlayer.title = game.black;
  elements.moveIndicator.textContent = state.ply
    ? `After ${Math.ceil(state.ply / 2)}${state.ply % 2 ? "." : "..."} ${game.moves[state.ply - 1].san}`
    : "Starting position";
  renderBoard(game, state.ply);
  renderMoveList(game);

  document.querySelector("#start-button").disabled = state.ply === 0;
  document.querySelector("#previous-button").disabled = state.ply === 0;
  document.querySelector("#next-button").disabled = state.ply === game.moves.length;
  document.querySelector("#end-button").disabled = state.ply === game.moves.length;
  analyzePosition(game, state.ply);
}

function showPosition(ply) {
  state.ply = ply;
  renderPosition();
}

function selectGame(index) {
  state.gameIndex = index;
  state.ply = 0;
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
    const result = await requestJson("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, pgn: await file.text() }),
    });
    loadGames(result.games, `Loaded ${result.games.length} game${result.games.length === 1 ? "" : "s"} from ${file.name}.`);
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
elements.gameSelect.addEventListener("change", () => selectGame(Number(elements.gameSelect.value)));
elements.fileInput.addEventListener("change", () => {
  if (elements.fileInput.files.length) loadPgnFile(elements.fileInput.files[0]);
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.add("drag-over");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove("drag-over");
  });
}
elements.dropzone.addEventListener("drop", (event) => {
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
    const result = await requestJson("/api/games");
    if (!result.games.length) {
      showMessage("No bundled PGN games found. Drop a PGN file to get started.");
      return;
    }
    loadGames(result.games);
  } catch (error) {
    showMessage(error.message);
    elements.analysisStatus.textContent = "Could not load games.";
  }
}

initialize();
