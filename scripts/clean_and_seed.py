#!/usr/bin/env python3
"""
Clean the raw Album_Listening.csv export and emit:
  - albums_clean.csv        (tidy, deduped, parent-genre tagged)
  - seed.sql                (idempotent INSERTs for Supabase)
  - clean_report.txt        (what changed + distributions)

Run:  python scripts/clean_and_seed.py path/to/Album_Listening.csv
Idempotent: safe to re-run; seed uses ON CONFLICT DO NOTHING on a natural key.
"""
import sys, re, json, hashlib
from pathlib import Path
import pandas as pd

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("Album_Listening.csv")
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(".")
OUT.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------- load
df = pd.read_csv(SRC)
df = df.drop(columns=[c for c in df.columns if c.lower() == "sorting"], errors="ignore")
report = []
def log(s=""): report.append(s); print(s)

raw_rows = len(df)
# Drop the empty trailing rows (no artist AND no title)
df = df[~(df["Artist"].isna() & df["Release Title"].isna())].copy()
log(f"Rows: {raw_rows} raw -> {len(df)} real ({raw_rows - len(df)} empty trailing rows dropped)")

# ---------------------------------------------------------------- text hygiene
def tidy(x):
    if pd.isna(x): return None
    x = str(x).replace("\t", " ")
    x = re.sub(r"\s+", " ", x).strip()
    return x or None

for col in ["Artist", "Release Title", "Release Type", "Genre", "Comments", "Collection Status"]:
    df[col] = df[col].map(tidy)

# Drop rows with no title — `albums.title` is NOT NULL, and a title-less row (an artist
# with everything else blank) is a CSV artifact, not a real album. Must run AFTER tidy(),
# which normalizes "" -> None. (The line-27 filter only catches rows missing BOTH fields.)
_before_title = len(df)
df = df[df["Release Title"].notna()].copy()
if _before_title != len(df):
    log(f"Dropped {_before_title - len(df)} row(s) with an empty title (not real albums)")

# ---------------------------------------------------------------- canonicalize genre variants
GENRE_CANON = {
    "Abstract Hip-Hop": "Abstract Hip Hop",
    "East Coast Hip-Hop": "East Coast Hip Hop",
    "Experimental Hip-Hop": "Experimental Hip Hop",
    "Insrumental Hip Hop": "Instrumental Hip Hop",   # typo fix
    "Alt Rock": "Alternative Rock",
    "Alt Metal": "Alternative Metal",
    "Alt R&B": "Alternative R&B",
    "Britpop": "Brit Pop",
    "Post Punk": "Post-Punk",
    "Post Rock": "Post-Rock",
    "Post Grunge": "Post-Grunge",
    "Post Hardcore": "Post-Hardcore",
    "Jazz-Rock": "Jazz Rock",
    "Neo Soul": "Neo-Soul",
    "Metal/Hip-Hop": "Metal/Hip Hop",
    "Synth Pop": "Synthpop",
}
df["Genre"] = df["Genre"].map(lambda g: GENRE_CANON.get(g, g) if g else g)

# ---------------------------------------------------------------- parent genre
# Priority-ordered: first match wins. Order is deliberate (Metal/Punk before Rock, Rap before Pop, etc.)
def parent_genre(g):
    if g is None or (isinstance(g, float) and pd.isna(g)) or not str(g).strip():
        return "Unknown"
    s = g.lower()
    rules = [
        ("Hip Hop",     ["hip hop", "hip-hop", "rap", "grime", "trap", "cloud rap", "wonky", "glitch hop"]),
        ("Metal",       ["metal", "metalcore", "grindcore"]),
        ("Punk",        ["punk", "hardcore", "emo"]),
        ("Jazz",        ["jazz", "bop", "modal", "third stream", "canterbury"]),
        ("Soul / R&B",  ["soul", "r&b", "funk", "motown"]),
        ("Reggae / Dub",["reggae", "dub", "ska"]),
        ("Electronic",  ["electronic", "house", "techno", "idm", "dubstep", "drum and bass", "garage",
                         "big beat", "trip hop", "trip-hop", "microhouse", "psytrance", "chillstep",
                         "bubblegum bass", "electropop", "dance-pop", "alternative dance", "madchester"]),
        ("Folk",        ["folk", "americana", "singer/songwriter", "close harmony"]),
        ("Country",     ["country", "swamp rock", "roots rock"]),
        ("Metal",       ["sludge", "drone", "stoner metal", "thrash", "doom"]),
        ("Rock",        ["rock", "grunge", "shoegaze", "krautrock", "new wave", "no wave",
                         "dunedin sound", "neo-psychedelia", "madchester", "avant prog"]),
        ("Pop",         ["pop"]),
        ("Soundtrack",  ["soundtrack", "film", "television music", "novelty", "rock opera"]),
        ("Ambient",     ["ambient", "drone"]),
        ("World",       ["afrobeat", "afro-jazz", "andalusian"]),
    ]
    for parent, keys in rules:
        if any(k in s for k in keys):
            return parent
    return "Other"

df["genre_parent"] = df["Genre"].map(parent_genre)

# ---------------------------------------------------------------- release type
RT_CANON = {"Compilation": "Compilation", "Double Album": "Album", "Live Album": "Live Album",
            "Mixtape": "Mixtape", "Soundtrack": "Soundtrack", "EP": "EP", "Album": "Album"}
df["Release Type"] = df["Release Type"].map(lambda x: RT_CANON.get(x, x) if x else "Album")

# ---------------------------------------------------------------- numeric
df["Year"] = pd.to_numeric(df["Year"], errors="coerce").astype("Int64")
df["Listen Count"] = pd.to_numeric(df["Listen Count"], errors="coerce").fillna(0).astype(int)
df["Rating"] = pd.to_numeric(df["Rating"], errors="coerce")   # nullable float, 0-10

# ---------------------------------------------------------------- dedupe on (artist, title, year)
def s_(v):
    return "" if (v is None or (isinstance(v, float) and pd.isna(v))) else str(v)
def natkey(r):
    base = f"{s_(r['Artist']).lower()}|{s_(r['Release Title']).lower()}|{s_(r['Year'])}"
    return hashlib.sha1(base.encode()).hexdigest()[:16]
df["nat_key"] = df.apply(natkey, axis=1)
before = len(df)
df = df.drop_duplicates(subset="nat_key", keep="first")
log(f"De-dupe on (artist,title,year): {before} -> {len(df)} ({before-len(df)} dupes removed)")

# ---------------------------------------------------------------- rename to snake_case
df = df.rename(columns={
    "Artist": "artist", "Release Title": "title", "Release Type": "release_type",
    "Year": "year", "Genre": "genre", "Listen Count": "listen_count",
    "Rating": "rating", "Comments": "comments", "Collection Status": "collection_status",
})
cols = ["artist","title","release_type","year","genre","genre_parent",
        "listen_count","rating","comments","collection_status","nat_key"]
df = df[cols]

# ---------------------------------------------------------------- report
log("")
log("== Parent genre distribution ==")
for k,v in df["genre_parent"].value_counts().items(): log(f"  {k:<14} {v}")
log("")
log(f"Unique artists: {df['artist'].nunique()} | subgenres: {df['genre'].nunique()}")
log(f"Rated: {df['rating'].notna().sum()} | with comments: {df['comments'].notna().sum()}")
log(f"Collection: {df['collection_status'].notna().sum()} tagged "
    f"({df['collection_status'].value_counts().to_dict()})")
unmapped = df[df['genre_parent'].isin(['Other','Unknown'])]['genre'].dropna().unique().tolist()
if unmapped: log(f"Review these subgenres (fell to Other/Unknown): {sorted(unmapped)}")

# ---------------------------------------------------------------- write clean csv
df.to_csv(OUT/"albums_clean.csv", index=False)

# ---------------------------------------------------------------- write seed.sql
def sql(v):
    if v is None or (isinstance(v,float) and pd.isna(v)) or v is pd.NA: return "NULL"
    if isinstance(v,(int,float)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"

lines = ["-- Auto-generated seed. Idempotent via ON CONFLICT (nat_key).",
         "-- Assumes a single owner; owner_id is set at import time (see README).",
         "insert into stacks.albums",
         "  (artist,title,release_type,year,genre,genre_parent,listen_count,rating,comments,collection_status,nat_key,source)",
         "values"]
vals = []
for _,r in df.iterrows():
    year = "NULL" if pd.isna(r["year"]) else int(r["year"])
    rating = "NULL" if pd.isna(r["rating"]) else float(r["rating"])
    vals.append("  (" + ",".join([
        sql(r["artist"]), sql(r["title"]), sql(r["release_type"]), str(year),
        sql(r["genre"]), sql(r["genre_parent"]), str(int(r["listen_count"])), str(rating),
        sql(r["comments"]), sql(r["collection_status"]), sql(r["nat_key"]), "'csv'"]) + ")")
lines.append(",\n".join(vals) + "\non conflict (nat_key) do nothing;")
(OUT/"seed.sql").write_text("\n".join(lines))
(OUT/"clean_report.txt").write_text("\n".join(report))
log("")
log(f"Wrote albums_clean.csv, seed.sql ({len(df)} rows), clean_report.txt")
