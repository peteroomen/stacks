// Normalisation passes on AI chat output before ReactMarkdown parses it.
// Each rule is defensive — the system prompt steers the model away from these
// patterns, but LLMs are non-deterministic so the normaliser is a safety net.
//
// Adapted from riff (peteroomen/riff, lib/markdown/normalise.ts). Generic
// guards only: the guitar-specific rules there (chord-chart pipe escaping,
// ♭/♯ font-fallback spans — the latter needs rehype-raw, which we deliberately
// don't use since the model echoes user note content) were dropped.

// A GFM table delimiter row: an all-`-`/`:`/`|`/space line with at least one
// `-` and one `|`, e.g. `|--------|-------|` or `| :--- | ---: |`.
const TABLE_DELIMITER_ROW = /^\s*\|?[\s:|-]*-[\s:|-]*\|[\s:|-]*$/;

// Flag which line indices belong to a real GFM table block: a header line
// (contains a `|`) immediately followed by a delimiter row, plus every
// contiguous pipe-bearing body row after it.
function tableLineIndices(lines: string[]): Set<number> {
  const inTable = new Set<number>();
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].includes("|") && TABLE_DELIMITER_ROW.test(lines[i + 1])) {
      let j = i;
      while (j < lines.length && lines[j].includes("|")) {
        inTable.add(j);
        j++;
      }
      i = j - 1; // skip past the block we just consumed
    }
  }
  return inTable;
}

export function normaliseMarkdown(text: string): string {
  // GFM requires a blank line before a table, but models often glue the header
  // row straight onto the preceding prose — which silently demotes the whole
  // table to paragraph text. Insert the missing blank line.
  const raw = text.split("\n");
  const lines: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const isHeader =
      i + 1 < raw.length &&
      raw[i].includes("|") &&
      !TABLE_DELIMITER_ROW.test(raw[i]) &&
      TABLE_DELIMITER_ROW.test(raw[i + 1]);
    if (isHeader && lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
    lines.push(raw[i]);
  }

  // Fence standalone `---` runs so ReactMarkdown parses them as <hr> (dropped
  // by our component override), catching inline cases like "today.---". Skip
  // table lines and delimiter rows — their dashes are structural, not a fence.
  const tableLines = tableLineIndices(lines);
  const guarded = lines
    .map((line, i) =>
      tableLines.has(i) || TABLE_DELIMITER_ROW.test(line)
        ? line
        : line.replace(/---/g, "\n\n---\n\n")
    )
    .join("\n");

  return (
    guarded
      // Headings (#–######) only count at the start of a line / after double
      // newlines, so a mid-sentence "#" (e.g. "my #1 record") can't become one.
      .replace(/(^|[\n]{2,})(#{1,6} )/gm, "$1\n$2")
      // Fix mid-sentence ## (2+ hashes) mashed against punctuation.
      .replace(/([^\n\s])(#{2,6} )/g, "$1\n\n$2")
      // Insert a missing space when punctuation is mashed against the next
      // word or bold opener (e.g. "clicked!**Step", "record:System"). The
      // `(?=\S)` guard restricts the `**` branch to opening delimiters: a
      // closing `**` is followed by whitespace/end, and inserting a space
      // before it would detach it from its word. Must run BEFORE the label
      // rule below so a mashed label gains the whitespace that rule anchors on.
      .replace(/([a-z][.!?:])(\*\*(?=\S)|[A-Z])/g, "$1 $2")
      // Fix `**label: **` patterns where a space before the closing `**`
      // prevents GFM from recognising a right-flanking delimiter run, so bold
      // never renders. The `(^|\s)` anchor pins the first `**` to an opening
      // delimiter — without it the match can begin at the CLOSING `**` of an
      // earlier well-formed pair and break both spans.
      .replace(/(^|\s)(\*\*[^*\n]+?) +\*\*/g, "$1$2** ")
  );
}
