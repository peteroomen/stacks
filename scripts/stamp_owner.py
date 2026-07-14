#!/usr/bin/env python3
"""Stamp the owner uuid into seed.sql -> seed_owned.sql (adds owner_id column).
Usage: python scripts/stamp_owner.py <auth-user-uuid> [scripts/out/seed.sql]"""
import sys
from pathlib import Path
uuid = sys.argv[1]
src = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("scripts/out/seed.sql")
txt = src.read_text()
txt = txt.replace(
    "(artist,title,release_type,year,genre,genre_parent,listen_count,rating,comments,collection_status,nat_key,source)",
    "(owner_id,artist,title,release_type,year,genre,genre_parent,listen_count,rating,comments,collection_status,nat_key,source)",
)
# prepend owner uuid to every value tuple
import re
txt = re.sub(r"^  \('", f"  ('{uuid}','", txt, flags=re.M)
# fix conflict target to composite (owner_id, nat_key)
txt = txt.replace("on conflict (nat_key)", "on conflict (owner_id, nat_key)")
out = src.with_name("seed_owned.sql")
out.write_text(txt)
print(f"wrote {out}")
