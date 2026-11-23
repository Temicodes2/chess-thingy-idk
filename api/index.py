from http.server import BaseHTTPRequestHandler
import json
import urllib.parse
import urllib.request
import urllib.error

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        username = params.get("username", [""])[0].strip()

        if not username:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Username is required."}).encode())
            return

        clean_username = username.lower()
        headers = {
            "User-Agent": "ChessStudio/1.0 (contact: chess-studio@example.com)",
            "Accept": "application/json",
        }

        archives_url = f"https://api.chess.com/pub/player/{urllib.parse.quote(clean_username)}/games/archives"
        req = urllib.request.Request(archives_url, headers=headers)

        try:
            with urllib.request.urlopen(req) as resp:
                archives_data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            msg = f'Chess.com user "{username}" was not found.' if e.code == 404 else f"Chess.com API returned HTTP {e.code}."
            self.wfile.write(json.dumps({"error": msg}).encode())
            return
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
            return

        archives = archives_data.get("archives", [])
        if not archives:
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": f'No game archives found for "{username}".'}).encode())
            return

        latest_url = archives[-1]
        try:
            req_games = urllib.request.Request(latest_url, headers=headers)
            with urllib.request.urlopen(req_games) as resp:
                games_data = json.loads(resp.read().decode())
            games = [g for g in games_data.get("games", []) if g.get("pgn", "").strip()]

            if len(games) < 10 and len(archives) > 1:
                try:
                    req_prev = urllib.request.Request(archives[-2], headers=headers)
                    with urllib.request.urlopen(req_prev) as resp_prev:
                        prev_data = json.loads(resp_prev.read().decode())
                        prev_games = [g for g in prev_data.get("games", []) if g.get("pgn", "").strip()]
                        games = prev_games + games
                except Exception:
                    pass

            if not games:
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"error": f'No games with PGN data found for "{username}".'}).encode())
                return

            games.reverse()
            recent_games = games[:30]
            combined_pgn = "\n\n".join(g["pgn"].strip() for g in recent_games)

            games_list = []
            for g in recent_games:
                w = g.get("white", {})
                b = g.get("black", {})
                games_list.append({
                    "url": g.get("url", ""),
                    "pgn": g.get("pgn", ""),
                    "white": {
                        "username": w.get("username", "White") if isinstance(w, dict) else "White",
                        "rating": w.get("rating") if isinstance(w, dict) else None,
                        "result": w.get("result", "") if isinstance(w, dict) else "",
                    },
                    "black": {
                        "username": b.get("username", "Black") if isinstance(b, dict) else "Black",
                        "rating": b.get("rating") if isinstance(b, dict) else None,
                        "result": b.get("result", "") if isinstance(b, dict) else "",
                    },
                    "timeControl": g.get("time_control", ""),
                    "timeClass": g.get("time_class", ""),
                    "endTime": g.get("end_time"),
                    "rated": g.get("rated", False),
                })

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            output = {
                "username": clean_username,
                "count": len(recent_games),
                "games": games_list,
                "combinedPgn": combined_pgn,
            }
            self.wfile.write(json.dumps(output).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
