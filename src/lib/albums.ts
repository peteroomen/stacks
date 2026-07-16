import { createHash } from "node:crypto";

// Natural key for idempotent inserts / dupe detection: sha1(artist|title|year),
// truncated to 16 hex chars. Must stay byte-compatible with the seed importer
// (scripts/clean_and_seed.py) and the chat add_album tool so the same album from
// any path collides on the same key.
export function natKey(artist: string, title: string, year?: number | null): string {
  return createHash("sha1")
    .update(`${artist.toLowerCase()}|${title.toLowerCase()}|${year ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

// Priority-ordered genre → broad bucket map. First match wins; order is
// deliberate (Metal/Punk before Rock, Hip Hop before Pop, etc.). Mirrors
// parent_genre() in scripts/clean_and_seed.py so a manually-added album lands in
// the same filter bucket the seed data uses.
const PARENT_RULES: [string, string[]][] = [
  ["Hip Hop", ["hip hop", "hip-hop", "rap", "grime", "trap", "cloud rap", "wonky", "glitch hop"]],
  ["Metal", ["metal", "metalcore", "grindcore"]],
  ["Punk", ["punk", "hardcore", "emo"]],
  ["Jazz", ["jazz", "bop", "modal", "third stream", "canterbury"]],
  ["Soul / R&B", ["soul", "r&b", "funk", "motown"]],
  ["Reggae / Dub", ["reggae", "dub", "ska"]],
  ["Electronic", ["electronic", "house", "techno", "idm", "dubstep", "drum and bass", "garage",
    "big beat", "trip hop", "trip-hop", "microhouse", "psytrance", "chillstep",
    "bubblegum bass", "electropop", "dance-pop", "alternative dance", "madchester"]],
  ["Folk", ["folk", "americana", "singer/songwriter", "close harmony"]],
  ["Country", ["country", "swamp rock", "roots rock"]],
  ["Metal", ["sludge", "drone", "stoner metal", "thrash", "doom"]],
  ["Rock", ["rock", "grunge", "shoegaze", "krautrock", "new wave", "no wave",
    "dunedin sound", "neo-psychedelia", "madchester", "avant prog"]],
  ["Pop", ["pop"]],
  ["Soundtrack", ["soundtrack", "film", "television music", "novelty", "rock opera"]],
  ["Ambient", ["ambient", "drone"]],
  ["World", ["afrobeat", "afro-jazz", "andalusian"]],
];

export function parentGenre(genre: string | null | undefined): string {
  if (!genre || !genre.trim()) return "Unknown";
  const s = genre.toLowerCase();
  for (const [parent, keys] of PARENT_RULES) {
    if (keys.some((k) => s.includes(k))) return parent;
  }
  return "Other";
}
