export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers?.host || "localhost"}`);
  const username = req.query?.username || url.searchParams.get("username");

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (!username || !username.trim()) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Username is required." }));
    return;
  }

  const cleanUsername = username.trim().toLowerCase();
  const headers = {
    "User-Agent": "ChessStudio/1.0 (contact: chess-studio@example.com)",
    "Accept": "application/json",
  };

  try {
    const archivesRes = await fetch(
      `https://api.chess.com/pub/player/${encodeURIComponent(cleanUsername)}/games/archives`,
      { headers }
    );

    if (archivesRes.status === 404) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: `Chess.com user "${username}" was not found.` }));
      return;
    }

    if (!archivesRes.ok) {
      res.statusCode = archivesRes.status;
      res.end(JSON.stringify({ error: `Chess.com API returned HTTP ${archivesRes.status}.` }));
      return;
    }

    const archivesData = await archivesRes.json();
    const archives = archivesData.archives || [];
    if (!archives.length) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: `No game archives found for "${username}".` }));
      return;
    }

    const latestArchiveUrl = archives[archives.length - 1];
    const gamesRes = await fetch(latestArchiveUrl, { headers });
    if (!gamesRes.ok) {
      res.statusCode = gamesRes.status;
      res.end(JSON.stringify({ error: `Failed to fetch monthly archive (HTTP ${gamesRes.status}).` }));
      return;
    }

    const gamesData = await gamesRes.json();
    let games = (gamesData.games || []).filter((g) => g.pgn && g.pgn.trim());

    if (games.length < 10 && archives.length > 1) {
      try {
        const prevRes = await fetch(archives[archives.length - 2], { headers });
        if (prevRes.ok) {
          const prevData = await prevRes.json();
          const prevGames = (prevData.games || []).filter((g) => g.pgn && g.pgn.trim());
          games = [...prevGames, ...games];
        }
      } catch {
        // ignore error fetching previous month
      }
    }

    if (!games.length) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: `No games with PGN data found for "${username}".` }));
      return;
    }

    // Newest games first
    games.reverse();
    const recentGames = games.slice(0, 30);

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        username: cleanUsername,
        count: recentGames.length,
        games: recentGames.map((g) => ({
          url: g.url,
          pgn: g.pgn,
          white: {
            username: g.white?.username || "White",
            rating: g.white?.rating ?? null,
            result: g.white?.result || "",
          },
          black: {
            username: g.black?.username || "Black",
            rating: g.black?.rating ?? null,
            result: g.black?.result || "",
          },
          timeControl: g.time_control,
          timeClass: g.time_class,
          endTime: g.end_time,
          rated: g.rated,
        })),
        combinedPgn: recentGames.map((g) => g.pgn.trim()).join("\n\n"),
      })
    );
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message || "Failed to fetch games from Chess.com." }));
  }
}
