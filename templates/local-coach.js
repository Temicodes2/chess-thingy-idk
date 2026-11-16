const title = document.querySelector("#explanation-title");
const text = document.querySelector("#explanation-text");
const detail = document.querySelector("#explanation-detail");
const qualityBadge = document.querySelector("#quality-badge");

if (title && text && detail) {
  function friendlyCoach(rawTitle, rawText, rawDetail) {
    if (!rawText || /select a move|analyzing|analysis unavailable/i.test(rawText)) {
      return null;
    }

    const cleanReason = rawText
      .replace(/This is Stockfish's estimate at the current search depth, not a certainty about the game result\.?/i, "")
      .replace(/\s+/g, " ")
      .trim();

    const detailFacts = rawDetail
      .replace(/\s*Coaching tip:.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    const move = [...rawText.matchAll(/(?:after|with)\s+([KQRBN]?[a-h][1-8](?:x[a-h][1-8])?[+#]?)/g)]
      .map((match) => match[1])
      .at(-1);

    let lesson = "A simple idea here: improve the piece that is least active, keep your king safe, and look for the next useful move.";
    let question = "What is the biggest thing your opponent could do right now?";

    if (/checkmate|mate in|is mating|can finish the game|forced mate|allowed mate/i.test(`${rawText} ${rawDetail}`)) {
      lesson = move
        ? `The move ${move} is part of a mating plan. Before you play it, check the king’s escape squares, blocks, and captures so you know the move really finishes the job.`
        : "This is a forcing mate idea. Before you commit, check every escape, block, and capture so you know the position is actually over.";
      question = "What escape square or defender is still left? Can you see the final check?";
    } else if (/fork|double attack|forks the|attacks both|king and queen|forked/i.test(`${rawText} ${rawDetail}`)) {
      lesson = move
        ? `${move} is a strong fork. It attacks two important targets at once, which often forces the opponent to choose one.`
        : "This line creates a fork: the attacker hits two targets at once, which often wins material or forces a better position.";
      question = "If the king is forced to move, what else is now hanging?";
    } else if (/undefended|hanging|leave[s]? .* completely undefended|blunders your|blunders the/i.test(`${rawText} ${rawDetail}`)) {
      lesson = move
        ? `${move} leaves a piece hanging. Check how many defenders are on the square and whether the king safety is already compromised.`
        : "This move leaves a piece undefended. Count attackers and defenders before you move a piece away from its protection.";
      question = "Which defender can your opponent remove, and do you have a way to save the piece?";
    } else if (/keeps the initiative|keeps the attack alive|gives check|check, so|forcing check|forcing move/i.test(`${rawText} ${rawDetail}`)) {
      lesson = move
        ? `${move} is a forcing check. First, list the opponent’s legal replies, then check what your next move will be after they answer.`
        : "This is a forcing check idea. Ask: what can the defender do, and what comes next after that?";
      question = "What reply is strongest for the defender, and what happens after that?";
    } else if (/wins? a[n]? (queen|rook|bishop|knight|pawn)|captures? a[n]? (queen|rook|bishop|knight|pawn)|material loss|allows.*grab|drops a/i.test(`${rawText} ${rawDetail}`)) {
      lesson = move
        ? `The engine likes ${move} because it wins material. Before you celebrate, ask: is the piece safe, and what can your opponent do after the capture?`
        : "This line wins material. Count the value, then ask whether the capture is safe or whether the opponent has a better reply.";
      question = "What is the opponent’s best reply after the material is won?";
    } else if (/promot/i.test(`${rawText} ${rawDetail}`)) {
      lesson = "This is a promotion idea. Look at the timing: can the pawn promote safely, or is there a stronger check or defense first?";
      question = "Can you make the promotion with a check, or do you have a safer plan?";
    } else if (/castle|castling/i.test(`${rawText} ${rawDetail}`)) {
      lesson = "Castling is often a good idea because it makes the king safer and brings the rook into play. Check whether the rook can become active and whether the king is still safe after.";
      question = "What could open against your king, and which rook can help next?";
    }

    const reason = cleanReason
      .replace(/The engine line contains a tactical idea\.?/i, "")
      .replace(/The engine line stays quiet and positional\.?/i, "")
      .replace(/The line is consistent with the engine's tactical plan:\s*/i, "")
      .trim();

    const encouragement = /engine's top choice|excellent|best \/ excellent/i.test(rawTitle.toLowerCase())
      ? "Good move. Now slow down and look for the pattern so you can recognize it again next time."
      : /blunder|mistake|inaccuracy|hanging|undefended|material loss|forced mate/i.test(rawTitle.toLowerCase()) || /blunder|mistake|inaccuracy|hanging|undefended|material loss|forced mate/i.test(`${rawText} ${rawDetail}`)
        ? "This is a useful lesson, not a mistake to fear. Focus on the opponent's reply instead of memorizing the move."
        : "Use this as a clue, not a rule. Check the opponent's best reply before you commit to the line.";

    return {
      source: `${rawTitle}\n${rawText}\n${rawDetail}`,
      text: [reason, lesson, encouragement].filter(Boolean).join(" "),
      detail: [detailFacts, `Coach's question: ${question}`].filter(Boolean).join(" "),
    };
  }

  function refreshCoach() {
    const rawTitle = title.textContent.trim();
    const rawText = text.textContent.trim();
    const rawDetail = detail.textContent.trim();
    const coached = friendlyCoach(rawTitle, rawText, rawDetail);

    if (!coached) return;

    text.textContent = coached.text;
    detail.textContent = coached.detail;
  }

  const observer = new MutationObserver(refreshCoach);
  for (const element of [title, text, detail, qualityBadge].filter(Boolean)) {
    observer.observe(element, { childList: true, characterData: true, subtree: true });
  }
}

