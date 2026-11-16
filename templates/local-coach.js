const title = document.querySelector("#explanation-title");
const text = document.querySelector("#explanation-text");
const detail = document.querySelector("#explanation-detail");
const qualityBadge = document.querySelector("#quality-badge");

if (title && text && detail) {
  const pieceNames = {
    q: "queen",
    r: "rook",
    b: "bishop",
    n: "knight",
    p: "pawn",
  };
  let lastSource = "";
  let lastOutput = null;
  let scheduled = false;

  function coachCopy(rawTitle, rawText, rawDetail) {
    const source = `${rawTitle}\n${rawText}\n${rawDetail}`;
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
    const lineMoves = [...rawText.matchAll(/(?:after|with)\s+([KQRBN]?[a-h][1-8](?:x[a-h][1-8])?[+#]?)/g)]
      .map((match) => match[1]);
    const move = lineMoves.at(-1);
    let lesson;
    let question;

    if (/checkmate|mate in|is mating|can finish the game/i.test(rawText)) {
      lesson = move
        ? `The engine's line reaches mate after ${move}. Before you play it, check the king's escape squares and every possible block or capture; don't stop calculating at the first check.`
        : "The engine sees a mating line. Before you play the move, check every king escape, block, and capture so you know the mate is really forced.";
      question = "What is the defender's most stubborn reply, and what is your answer?";
    } else if (/fork|attacks the king and queen|double attack/i.test(`${rawText} ${rawDetail}`)) {
      lesson = move
        ? `${move} is the key double attack: it hits the king and queen together. Calculate the forced king response first, then confirm the queen cannot escape or be defended.`
        : "The line contains a king-and-queen fork. Work out the forced king reply first, then check whether the queen can escape or be defended.";
      question = "After the king responds, which target is still won—and can the forked piece move with tempo?";
    } else if (/keeps the initiative|keeps the attack alive|gives check|check, so/i.test(rawText)) {
      lesson = move
        ? `${move} is the forcing check in this line. List the opponent's legal king moves, blocks, and captures; then calculate the next move rather than assuming the check wins by itself.`
        : "The line uses a forcing check to keep the initiative. List the opponent's legal king moves, blocks, and captures, then calculate the follow-up.";
      question = "Which reply is strongest for the defender, and what changes after it?";
    } else {
      const captured = rawText.match(/wins? a[n]? (queen|rook|bishop|knight|pawn)|captures? a[n]? (queen|rook|bishop|knight|pawn)/i);
      if (captured) {
        const piece = captured[1].toLowerCase();
        lesson = move
          ? `The line wins the ${piece} with ${move}. Follow the whole capture sequence before taking it: check whether the capturing piece is recaptured and what forcing reply the opponent has.`
          : `The line wins a ${piece}. Follow the whole capture sequence before taking it: check whether the capturing piece is recaptured and what forcing reply the opponent has.`;
        question = "When the forcing sequence ends, who has gained material and whose king is safer?";
      } else if (/promot/i.test(`${rawText} ${rawDetail}`)) {
        lesson = "Promotion is the critical idea. Compare promoting with check against the opponent's forcing replies; a queen is strong, but don't overlook an immediate check, capture, or stalemate resource.";
        question = "Can you promote with check, and what is the opponent's strongest reply?";
      } else if (/castle/i.test(`${rawText} ${rawDetail}`)) {
        lesson = "Castling gets the king toward safety and brings a rook into play. Before moving on, check whether the new king shelter can be opened and whether the rook has a useful file.";
        question = "What line could open against your king, and which rook can you activate next?";
      } else {
        lesson = "No clear forcing tactic appears in the first few moves of the engine line. Keep it simple: improve your least-active piece, preserve your king's cover, and avoid creating a weakness you cannot defend.";
        question = "Which of your pieces is least useful, and where can it improve without allowing a forcing reply?";
      }
    }

    const reason = cleanReason
      .replace(/The engine line contains a tactical idea\.?/i, "")
      .replace(/The engine line stays quiet and positional\.?/i, "")
      .trim();
    const quality = rawTitle.toLowerCase();
    const encouragement = /engine's top choice|excellent|best \/ excellent/i.test(quality)
      ? "Good choice—now make sure you understand the point so you can find the same idea again."
      : /blunder|mistake|inaccuracy/i.test(quality)
        ? "This is a useful pattern to learn; focus on the opponent's forcing reply rather than memorizing the engine move."
        : "Use the line as a candidate, not a command: check the opponent's best reply before deciding.";

    return {
      source,
      text: [reason, lesson, encouragement].filter(Boolean).join(" "),
      detail: [detailFacts, `Coach's question: ${question}`].filter(Boolean).join(" "),
    };
  }

  function refreshCoach() {
    scheduled = false;
    const rawTitle = title.textContent.trim();
    const rawText = text.textContent.trim();
    const rawDetail = detail.textContent.trim();
    const source = `${rawTitle}\n${rawText}\n${rawDetail}`;
    if (source === lastSource || (lastOutput &&
      rawTitle === lastOutput.title && rawText === lastOutput.text && rawDetail === lastOutput.detail)) {
      return;
    }

    const coached = coachCopy(rawTitle, rawText, rawDetail);
    if (!coached) return;

    lastSource = coached.source;
    lastOutput = { title: rawTitle, text: coached.text, detail: coached.detail };
    text.textContent = coached.text;
    detail.textContent = coached.detail;
  }

  function scheduleCoach() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(refreshCoach);
  }

  const observer = new MutationObserver(scheduleCoach);
  for (const element of [title, text, detail, qualityBadge].filter(Boolean)) {
    observer.observe(element, { childList: true, characterData: true, subtree: true });
  }
}
