// Deep-link to a YouTube Music search for an album — the closest we can get to
// "play this album" without the YT Music API. Un-sorts sort-name artists so the
// query reads naturally ("Beatles, The" -> "The Beatles").
export function ytMusicUrl(artist: string, title: string) {
  const a = artist.replace(/^(.*?),\s*(the|a|an)$/i, "$2 $1");
  return `https://music.youtube.com/search?q=${encodeURIComponent(`${a} ${title}`)}`;
}
