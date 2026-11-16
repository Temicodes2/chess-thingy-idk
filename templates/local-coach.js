const title = document.querySelector("#explanation-title");
const text = document.querySelector("#explanation-text");
const detail = document.querySelector("#explanation-detail");
const quality = document.querySelector("#quality-badge");
const moveLoss = document.querySelector("#move-loss");

const tacticalTerms = [
  { test: /checkmate|mate in|is mating|mating/i, advice: "First, verify the mating sequence: check every legal king escape and defensive interposition. If the mate is forced, play the cleanest move—not a move that merely looks dramatic." },
  { test: /fork|attacks the king and queen|double attack/i, advice: "Look at the fork square and list every piece it attacks. If the king is one target, calculate the forced king reply first, then see whether the other target is still won." },
  { test: /check|checks|keeps the initiative/i, advice: "Treat the check as a forcing move: identify the opponent's legal king moves, blocks, and captures. Before committing, make sure your follow-up does not leave your own queen or king exposed." },
  { test: /wins? (?:a )?(?:queen|rook|bishop|knight|piece|material)|captures? (?:a )?(?:queen|rook|bishop|knight)/i, advice: "Before taking the material, check whether the capturing piece can be recaptured and whether the opponent has a stronger forcing reply. Count the exchange to the end, not just the first capture." },
  { test: /promot/i, advice: "Compare the promotion with check, capture, or a forcing threat. Queen is usually best, but check whether promoting immediately lets the opponent stalemate, win the new queen, or give a decisive check." },
  { test: /castle/i, advice: "After castling, check whether the king is actually safer and whether the rook has an open file. Keep an eye on pawn breaks that could open lines toward your king." },
];

function practicalTip(source, titleText, qualityText) {
  const tactical = tacticalTerms.find(({ test }) => test.test(`${titleText} ${source}`));
  if (tactical) return tactical.advice;

  const score = Number.parseFloat(moveLoss?.textContent || "");
  if (/blunder/i.test(qualityText) || score >= 2) {
    return "Pause before your next move and scan the opponent's checks, captures, and threats in that order. Then check whether your intended move leaves a piece undefended.";
  }
  if (/mistake|inaccuracy/i.test(qualityText) || score >= 0.5) {
    return "Compare your move with the suggested alternative. Ask what changed: king safety, an undefended piece, a lost tempo, or a better square for one of your pieces?";
  }
  if (/top choice|excellent|best/i.test(qualityText)) {
    return "Good choice. Keep using the same routine: look for forcing moves first, then choose the move that improves your least-active piece without weakening your king.";
  }
  return "For your next move, check forcing moves first, then improve your least-active piece. Before you play it, ask what your opponent would do in reply.";
}

function coachResponse() {
  if (!title || !text || !detail || text.dataset.coached === "true") return;
  const rawText = text.textContent.trim();
  const rawDetail = detail.textContent.trim();
  if (!rawText || /select a move|analyzing|analysis unavailable/i.test(rawText)) return;

  const heading = title.textContent.trim();
  const qualityText = heading || quality?.textContent || "";
  const takeaway = rawText
    .replace(/This is Stockfish's estimate at the current search depth, not a certainty about the game result\.?/i, "")
    .replace(/The engine line contains a tactical idea\.?/i, "")
    .replace(/The engine line stays quiet and positional\.?/i, "")
    .trim();
  const actionableTip = practicalTip(`${rawText} ${rawDetail}`, heading, qualityText);
  const coachText = takeaway
    ? `${takeaway} ${actionableTip}`
    : actionableTip;

  text.dataset.coached = "true";
  text.textContent = coachText;

  // Keep the engine's concrete move facts and alternative, then replace generic
  // advice with one specific calculation prompt the player can use immediately.
  detail.dataset.coached = "true";
  const facts = rawDetail
    .replace(/\s*Coaching tip:.*$/i, "")
    .replace(/\s*The engine line contains a tactical idea\.?/i, "")
    .trim();
  detail.textContent = `${facts}${facts ? " " : ""}Coach's question: ${actionableTip}`;
}

if (title && text && detail) {
  const observer = new MutationObserver(() => {
    // The app changes text and title separately; clear the marker when it starts
    // a new explanation so the observer can coach that complete response once.
    if (text.dataset.coached === "true" && !text.textContent.trim()) {
      delete text.dataset.coached;
      delete detail.dataset.coached;
    }
    if (text.dataset.coached !== "true") coachResponse();
  });
  observer.observe(title, { childList: true, characterData: true, subtree: true });
  observer.observe(text, { childList: true, characterData: true, subtree: true });
  observer.observe(detail, { childList: true, characterData: true, subtree: true });
  observer.observe(quality, { childList: true, characterData: true, subtree: true });

  // Explanation elements are commonly updated in one synchronous app turn.
  // Defer formatting so the observer reads the complete engine-generated copy.
  const originalCoachResponse = coachResponse;
  const schedule = () => queueMicrotask(originalCoachResponse);
  observer.disconnect();
  const scheduledObserver = new MutationObserver(schedule);
  scheduledObserver.observe(title, { childList: true, characterData: true, subtree: true });
  scheduledObserver.observe(text, { childList: true, characterData: true, subtree: true });
  scheduledObserver.observe(detail, { childList: true, characterData: true, subtree: true });
  scheduledObserver.observe(quality, { childList: true, characterData: true, subtree: true });
}
