import { Chess } from "chess.js";

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_NAMES = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

function opposite(color) {
  return color === "w" ? "b" : "w";
}

function moveFromUci(board, uci) {
  if (!uci || uci.length < 4) return null;
  return board.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4],
  });
}

function listPieces(board) {
  return board.board().flatMap((rank, row) =>
    rank.flatMap((piece, file) =>
      piece
        ? [{
            square: `${"abcdefgh"[file]}${8 - row}`,
            ...piece,
          }]
        : [],
    ),
  );
}

function pieceValue(type) {
  return PIECE_VALUES[type] ?? 0;
}

function pieceName(type) {
  return PIECE_NAMES[type] || "piece";
}

function vulnerability(board, piece) {
  const attackers = board.attackers(piece.square, opposite(piece.color));
  const defenders = board.attackers(piece.square, piece.color);
  return {
    attackers,
    defenders,
    exposed: attackers.length > defenders.length,
  };
}

function formatPiece(piece) {
  return `${piece.color === "w" ? "White" : "Black"} ${pieceName(piece.type)} on ${piece.square}`;
}

function findFork(board, from, color) {
  const attacker = board.get(from);
  if (!attacker || attacker.color !== color) return null;

  const targets = listPieces(board)
    .filter((piece) => piece.color !== color)
    .filter((piece) => (
      (piece.type === "k" || pieceValue(piece.type) >= 3) &&
      board.attackers(piece.square, color).includes(from)
    ))
    .sort((a, b) => (
      (b.type === "k" ? 100 : pieceValue(b.type)) -
      (a.type === "k" ? 100 : pieceValue(a.type))
    ));

  if (targets.length < 2) return null;

  const [first, second] = targets;
  return {
    targets: [first, second],
    text: `${formatPiece({ ...attacker, square: from })} attacks the ${pieceName(first.type)} on ${first.square} and ${pieceName(second.type)} on ${second.square} at once. This is a fork; check whether the opponent can save both targets or capture the attacker.`,
  };
}

function findNewlyExposedPieces(before, after, color) {
  return listPieces(after)
    .filter((piece) => piece.color === color)
    .flatMap((piece) => {
      const current = vulnerability(after, piece);
      if (!current.exposed) return [];

      const previousPiece = before.get(piece.square);
      const wasAlreadyExposed = previousPiece?.color === color &&
        previousPiece.type === piece.type &&
        vulnerability(before, { square: piece.square, ...previousPiece }).exposed;
      if (wasAlreadyExposed) return [];

      return [{ piece, ...current }];
    })
    .sort((a, b) => pieceValue(b.piece.type) - pieceValue(a.piece.type));
}

function describeNewExposure(board, exposure, moverColor) {
  const { piece, attackers, defenders } = exposure;
  const attackerNames = attackers
    .map((square) => {
      const attacker = board.get(square);
      return `a ${pieceName(attacker?.type)} on ${square}`;
    });
  const attackerText = attackers.length === 1
    ? `by ${attackerNames[0]}`
    : `by ${attackers.length} pieces (${attackerNames.join(" and ")})`;
  const target = piece.color === moverColor ? "Your" : "The opponent's";
  if (defenders.length === 0) {
    return `${target} ${pieceName(piece.type)} on ${piece.square} is newly hanging: attacked ${attackerText} and has no defenders.`;
  }
  return `${target} ${pieceName(piece.type)} on ${piece.square} is newly under-defended: ${attackers.length} attackers outnumber ${defenders.length} defenders.`;
}

function describeCapture(move) {
  const value = pieceValue(move.captured);
  return `The move captures a ${pieceName(move.captured)}${value ? ` worth ${value} ${value === 1 ? "point" : "points"}` : ""}.`;
}

function describeBestReplyCapture(afterMove, replyUci) {
  const replyBoard = new Chess(afterMove.fen());
  const reply = moveFromUci(replyBoard, replyUci);
  if (!reply?.captured) return null;

  const victim = pieceName(reply.captured);
  const value = pieceValue(reply.captured);
  return `Stockfish's strongest reply, ${reply.san}, captures your ${victim}${value ? ` worth ${value} ${value === 1 ? "point" : "points"}` : ""}.`;
}

function describeMaterialLoss(afterMove, pv, moverColor) {
  if (!Array.isArray(pv) || !pv.length) return null;

  const line = new Chess(afterMove.fen());
  let materialLost = 0;
  let materialWon = 0;
  let plies = 0;
  for (const uci of pv.slice(0, 8)) {
    const move = moveFromUci(line, uci);
    if (!move) break;
    plies += 1;
    if (move.captured) {
      if (move.color === moverColor) {
        materialWon += pieceValue(move.captured);
      } else {
        materialLost += pieceValue(move.captured);
      }
    }
  }

  const netLoss = materialLost - materialWon;
  if (netLoss < 1) return null;
  return `Over Stockfish's next ${plies} plies, the captures leave you down about ${netLoss} material ${netLoss === 1 ? "point" : "points"} after recaptures.`;
}

function activityFact(move) {
  const file = (square) => "abcdefgh".indexOf(square[0]);
  const rank = (square) => Number(square[1]);
  const centerDistance = (square) =>
    Math.abs(file(square) - 3.5) + Math.abs(rank(square) - 4.5);
  if (move.piece === "p") {
    const centralFile = ["c", "d", "e", "f"].includes(move.to[0]);
    return `Your pawn advanced from ${move.from} to ${move.to}${centralFile ? " on a central file, gaining space" : ", changing the pawn cover around your position"}.`;
  }
  if (move.flags.includes("k") || move.flags.includes("q")) return null;
  return centerDistance(move.to) < centerDistance(move.from)
    ? `Your ${pieceName(move.piece)} moved from ${move.from} to ${move.to}, closer to the center.`
    : `Your ${pieceName(move.piece)} moved from ${move.from} to ${move.to}; compare which squares it controlled before and after the move.`;
}

export function analyzeMoveTactics({
  positionFen,
  moveUci,
  alternativeUci,
  replyUci,
  replyPv = [],
}) {
  const before = new Chess(positionFen);
  const moverColor = before.turn();
  const after = new Chess(positionFen);
  const move = moveFromUci(after, moveUci);
  if (!move) {
    throw new Error(`Could not replay move ${moveUci} from the analyzed position.`);
  }

  const facts = [];
  const fork = findFork(after, move.to, moverColor);
  if (fork) facts.push(fork.text);

  const exposed = findNewlyExposedPieces(before, after, moverColor)
    .slice(0, 2)
    .map((item) => describeNewExposure(after, item, moverColor));
  facts.push(...exposed);

  const opponentTargets = findNewlyExposedPieces(before, after, opposite(moverColor))
    .slice(0, 2)
    .map((item) => describeNewExposure(after, item, moverColor));
  facts.push(...opponentTargets);

  if (move.captured) facts.push(describeCapture(move));
  if (move.san.endsWith("#")) {
    facts.push("This move checkmates; the game ends immediately.");
  } else if (move.san.endsWith("+")) {
    facts.push("This move gives check, so the opponent must answer the king threat.");
  }
  if (move.promotion) {
    facts.push(`The pawn promotes to a ${pieceName(move.promotion)}.`);
  }
  if (move.flags.includes("k") || move.flags.includes("q")) {
    facts.push("Castling moves your king toward safety and brings a rook into play.");
  }

  if (alternativeUci && alternativeUci !== moveUci) {
    const alternativeBoard = new Chess(positionFen);
    const alternative = moveFromUci(alternativeBoard, alternativeUci);
    const alternativeFork = alternative &&
      findFork(alternativeBoard, alternative.to, moverColor);
    if (alternativeFork) {
      facts.push(`A stronger tactical idea was ${alternative.san}: ${alternativeFork.text}`);
    }
  }

  const replyCapture = describeBestReplyCapture(after, replyUci);
  if (replyCapture) facts.push(replyCapture);
  const materialLoss = describeMaterialLoss(after, replyPv, moverColor);
  if (materialLoss) facts.push(materialLoss);
  if (!facts.length) {
    const activity = activityFact(move);
    facts.push(activity || "No immediate fork, newly exposed piece, or material-winning capture appeared in the board scan.");
  }

  let tip = "Compare your move with the engine's alternative, then ask what the opponent's best reply changes.";
  if (fork || facts.some((fact) => fact.includes("tactical idea was"))) {
    tip = "Before playing a fork, check whether the attacker is safe and calculate the opponent's best king move or counterattack.";
  } else if (exposed.length) {
    tip = "Before moving, scan every piece you stop defending. Count attackers and defenders on the most valuable exposed piece.";
  } else if (replyCapture) {
    tip = "After choosing a move, look for the opponent's strongest capture and check whether you can prevent it or win something greater.";
  } else if (materialLoss) {
    tip = "Trace the whole exchange until the captures stop. Count the value of what each side wins, not just the first piece taken.";
  } else if (move.captured) {
    tip = "After a capture, calculate the likely recapture and compare the value of both pieces before deciding the exchange is favorable.";
  } else if (opponentTargets.length) {
    tip = "Look for a forcing follow-up against the newly exposed piece, but first verify it cannot be saved or used to create a stronger threat.";
  }

  return { facts, tip };
}
