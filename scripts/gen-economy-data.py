#!/usr/bin/env python3
"""Extract per-category rarity counts from the generated catalogs into
tools/economy/catalog-counts.json — feeds the Economy tab's rarity
re-bucket tracker (current vs 50/30/15/5 target).

Sources:
  cats        src/shared/cats-catalog.generated.ts
  cosmetics   src/shared/cosmetics-catalog.generated.ts
  effects     src/client/shared/effect-catalog-gen.ts  (generated batch)
              + hand-authored EFFECT_COSMETIC_CATALOG in src/shared/state.ts
  backgrounds src/shared/themes-catalog.generated.ts

Re-run after any catalog regen: python3 scripts/gen-economy-data.py
"""
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tools" / "economy" / "catalog-counts.json"

RARITIES = ["common", "uncommon", "rare", "legendary"]
RARITY_RE = re.compile(r"rarity:\s*['\"](common|uncommon|rare|legendary)['\"]")


def count_file(path: Path, start_marker: str | None = None, end_marker: str | None = None):
    txt = path.read_text()
    if start_marker:
        idx = txt.find(start_marker)
        if idx >= 0:
            txt = txt[idx:]
    if end_marker:
        idx = txt.find(end_marker)
        if idx >= 0:
            txt = txt[:idx]
    counts = {r: 0 for r in RARITIES}
    for m in RARITY_RE.finditer(txt):
        counts[m.group(1)] += 1
    return counts


def merge(*counts_list):
    out = {r: 0 for r in RARITIES}
    for c in counts_list:
        for r in RARITIES:
            out[r] += c[r]
    return out


def main():
    cats = count_file(ROOT / "src/shared/cats-catalog.generated.ts")
    cosmetics = count_file(ROOT / "src/shared/cosmetics-catalog.generated.ts")
    effects_gen = count_file(ROOT / "src/client/shared/effect-catalog-gen.ts")
    # Hand-authored effect entries live inside state.ts between the catalog
    # declaration and the NEW_EFFECT_CATALOG merge push.
    effects_hand = count_file(
        ROOT / "src/shared/state.ts",
        start_marker="EFFECT_COSMETIC_CATALOG",
        end_marker="NEW_EFFECT_CATALOG",
    )
    backgrounds = count_file(ROOT / "src/shared/themes-catalog.generated.ts")

    data = {
        "generatedAt": date.today().isoformat(),
        "categories": {
            "cats": cats,
            "cosmetics": cosmetics,
            "effects": merge(effects_gen, effects_hand),
            "backgrounds": backgrounds,
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2) + "\n")
    for name, c in data["categories"].items():
        total = sum(c.values())
        print(f"{name:12s} total={total:4d}  " + "  ".join(f"{r}={c[r]}" for r in RARITIES))
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
