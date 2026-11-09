import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gamesDir = resolve(projectRoot, "static", "games");

await mkdir(gamesDir, { recursive: true });

const gameFiles = (await readdir(projectRoot))
  .filter((filename) => filename.toLowerCase().endsWith(".pgn"))
  .sort();

for (const filename of gameFiles) {
  await cp(resolve(projectRoot, filename), resolve(gamesDir, filename));
}
for (const filename of await readdir(gamesDir)) {
  if (filename.toLowerCase().endsWith(".pgn") && !gameFiles.includes(filename)) {
    await rm(resolve(gamesDir, filename));
  }
}

await writeFile(
  resolve(gamesDir, "manifest.json"),
  JSON.stringify({ files: gameFiles }),
);
