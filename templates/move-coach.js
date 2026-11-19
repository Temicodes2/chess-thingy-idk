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
    text: `${pieceName(attacker.type)} on ${from} forks the ${pieceName(first.type)} on ${first.square} and ${pieceName(second.type)} on ${second.square}.`,
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
    ? attackerNames[0]
    : `by ${attackers.length} pieces (${attackerNames.join(" and ")})`;
  const target = piece.color === moverColor ? "Your" : "The opponent's";
  if (defenders.length === 0) {
    return `${target} ${pieceName(piece.type)} on ${piece.square} is hanging to ${attackerText}.`;
  }
  return `${target} ${pieceName(piece.type)} on ${piece.square} is under-defended (${attackers.length} attackers, ${defenders.length} defenders).`;
}

function describeCapture(move) {
  return `You win a ${pieceName(move.captured)}.`;
}

function describeBestReplyCapture(afterMove, replyUci) {
  const replyBoard = new Chess(afterMove.fen());
  const reply = moveFromUci(replyBoard, replyUci);
  if (!reply?.captured) return null;

  return `The opponent's best reply, ${reply.san}, wins your ${pieceName(reply.captured)}.`;
}

function describeFutureQueenLoss(afterMove, pv, moverColor) {
  if (!Array.isArray(pv) || !pv.length) return null;

  const line = new Chess(afterMove.fen());
  for (const uci of pv.slice(0, 12)) {
    const move = moveFromUci(line, uci);
    if (!move) break;
    if (move.color !== moverColor && move.captured === "q") {
      return `The engine's line shows the opponent winning your queen with ${move.san}.`;
    }
  }
  return null;
}

function describeMaterialLoss(afterMove, pv, moverColor) {
  if (!Array.isArray(pv) || !pv.length) return null;

  const line = new Chess(afterMove.fen());
  let materialLost = 0;
  let materialWon = 0;
  for (const uci of pv.slice(0, 8)) {
    const move = moveFromUci(line, uci);
    if (!move) break;
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
  return `The best line leaves you down ${netLoss} ${netLoss === 1 ? "point" : "points"} of material after the exchange.`;
}

function activityFact(move) {
  const file = (square) => "abcdefgh".indexOf(square[0]);
  const rank = (square) => Number(square[1]);
  const centerDistance = (square) =>
    Math.abs(file(square) - 3.5) + Math.abs(rank(square) - 4.5);
  if (move.piece === "p") {
    const centralFile = ["c", "d", "e", "f"].includes(move.to[0]);
    return centralFile
      ? `Pawn to ${move.to} gains space in the center.`
      : `Pawn to ${move.to} changes your pawn structure.`;
  }
  if (move.flags.includes("k") || move.flags.includes("q")) return null;
  return centerDistance(move.to) < centerDistance(move.from)
    ? `${pieceName(move.piece)} to ${move.to} moves closer to the center.`
    : `${pieceName(move.piece)} to ${move.to} changes which squares it controls.`;
}

export function analyzeMoveTactics({
  positionFen,
  moveUci,
  alternativeUci,
  replyUci,
  replyPv = [],
  forcedMate = false,
  mateIn = null,
  bestLineMateIn = null,
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

  let alternativeFork = null;
  let alternativeSan = null;
  if (alternativeUci && alternativeUci !== moveUci) {
    const alternativeBoard = new Chess(positionFen);
    const alternative = moveFromUci(alternativeBoard, alternativeUci);
    alternativeSan = alternative?.san || null;
    alternativeFork = alternative &&
      findFork(alternativeBoard, alternative.to, moverColor);
  }

  const replyCapture = describeBestReplyCapture(after, replyUci);
  const futureQueenLoss = describeFutureQueenLoss(after, replyPv, moverColor);
  const materialLoss = describeMaterialLoss(after, replyPv, moverColor);
  const activity = activityFact(move);
  const insight = (bestLineMateIn
    ? `Best line forces mate in ${bestLineMateIn}.`
    : null) ||
    (forcedMate
    ? `This move allows ${mateIn ? `mate in ${mateIn}` : "a forced mate"}.`
    : null) ||
    fork?.text ||
    futureQueenLoss ||
    exposed[0] ||
    (alternativeFork ? `Best was ${alternativeSan}: ${alternativeFork.text}` : null) ||
    replyCapture ||
    materialLoss ||
    opponentTargets[0] ||
    (move.san.endsWith("#") ? "Checkmate." : null) ||
    (move.san.endsWith("+") ? "Check: the opponent must answer the king threat." : null) ||
    (move.promotion ? `Pawn promotes to a ${pieceName(move.promotion)}.` : null) ||
    (move.captured ? describeCapture(move) : null) ||
    ((move.flags.includes("k") || move.flags.includes("q")) ? "Castling brings your king to safety and activates a rook." : null) ||
    activity ||
    "No immediate tactic; focus on improving your least active piece.";

  const emphasis = bestLineMateIn
    ? `mate in ${bestLineMateIn}`
    : forcedMate
      ? (mateIn ? `mate in ${mateIn}` : "forced mate")
    : fork?.text
      ? fork.text.slice(fork.text.indexOf(" forks ") + 1)
    : futureQueenLoss
      ? futureQueenLoss.match(/winning your queen with .+?\./)?.[0].replace(/\.$/, "") || "winning your queen"
      : exposed[0]
        ? exposed[0].replace(/^(Your|The opponent's) /, "")
        : alternativeFork
      ? `Best was ${alternativeSan}:`
        : replyCapture
          ? replyCapture.match(/wins your .+?\./)?.[0].replace(/\.$/, "") || "wins your"
          : materialLoss
            ? materialLoss.match(/down \d+ points? of material/)?.[0] || "down"
            : opponentTargets[0]
              ? opponentTargets[0].replace(/^The opponent's /, "")
              : move.san.endsWith("#")
                ? "Checkmate"
                : move.san.endsWith("+")
                  ? "Check"
                  : move.promotion
                    ? "promotes"
                    : move.captured
                      ? "win"
                      : activity?.includes("closer to the center")
                        ? "moves closer to the center"
                        : activity?.includes("Pawn to")
                          ? (activity.includes("gains space") ? "gains space in the center" : "changes your pawn structure")
                          : activity
                            ? "changes which squares it controls"
                            : "";

  let tip = "Compare your move with the engine's alternative, then ask what the opponent's best reply changes.";
  if (forcedMate || mateIn || bestLineMateIn) {
    tip = forcedMate
      ? "Look for a forcing move that prevents the mating threat."
      : "Follow the checks and forced replies to see how the attack reaches mate.";
  } else if (fork || alternativeFork) {
    tip = "Check that the forked piece is safe and cannot be captured.";
  } else if (exposed.length) {
    tip = "Before moving, check which piece loses its defender.";
  } else if (replyCapture) {
    tip = "Look for the opponent's best capture before you move.";
  } else if (materialLoss) {
    tip = "Count the pieces won and lost through the end of the exchange.";
  } else if (move.captured) {
    tip = "Check whether your piece can be recaptured.";
  } else if (opponentTargets.length) {
    tip = "Can you attack that piece again before it escapes?";
  } else if (move.san.endsWith("#")) {
    tip = "Look for forcing moves that leave the king no escape.";
  } else {
    tip = "Keep improving your pieces while watching for your opponent's threats.";
  }

  return { facts, insight, emphasis, tip };
}
