"""Re-apply the fixed-split-x logic to every vertical L/R cat variant
already on disk. Overwrites the existing cat dirs in-place; preserves
their cat IDs. Skips/removes the hbsplit cats per Tim's "only keep
down-the-middle splits" decision.

Reads VARIANTS from gen-cat-variants.py (already trimmed to the kept set
implicitly — we filter on kind=='split' here).
"""
import json
import shutil
import sys
from pathlib import Path
from PIL import Image
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import importlib.util
spec = importlib.util.spec_from_file_location(
    'gen_cat_variants', Path(__file__).parent / 'gen-cat-variants.py')
gcv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gcv)

ROOT = Path('.')
RAW = ROOT / 'assets-raw'
CATS_JSON = ROOT / 'tools/cats/cats.json'

# Existing ID assignments (preserve so SMALL_CATS + any other refs stay
# valid). hbsplit cats are listed too so we can delete them cleanly.
NAME_TO_ID = {
    # vertical splits — keep + regenerate with fixed split_x
    'Sherbet': 91, 'Macaron': 92, 'Seaglass': 93, 'Lullaby': 94,
    'Cottoncandy': 96, 'Lagoon': 99,
    'Tuxedo': 103, 'Bandit': 104, 'Cinnamon': 105, 'Pumpkin': 106,
    'Domino': 107, 'Spice': 108, 'Storm': 109, 'Mittens': 110,
    'Coal': 113, 'Snowdrop': 114, 'Caramel': 115, 'Toffee': 116,
    # hbsplit — delete
    'Bishop': 95, 'Knight': 97, 'Sailor': 98, 'Ranger': 100,
    'Wizard': 101, 'Strawberry': 102, 'Apricot': 111, 'Lava': 112,
}

DELETE_IDS = {95, 97, 98, 100, 101, 102, 111, 112}


def main():
    cats = json.loads(CATS_JSON.read_text())

    # 1. Delete the 8 hbsplit cats from disk + cats.json
    deleted = []
    for cid_int in sorted(DELETE_IDS):
        cid = f'cat{cid_int}'
        d = RAW / cid
        if d.exists():
            shutil.rmtree(d)
            deleted.append(cid)
    cats = [c for c in cats if c['id'] not in {f'cat{i}' for i in DELETE_IDS}]
    print(f'deleted hbsplit dirs: {deleted}')

    # 2. Regen the 18 vertical splits in place
    regen = 0
    for name, kind, params in gcv.VARIANTS:
        if kind != 'split':
            continue
        cid_int = NAME_TO_ID[name]
        cid = f'cat{cid_int}'
        dst = RAW / cid
        # Wipe + regen
        if dst.exists():
            shutil.rmtree(dst)
        dst.mkdir(parents=True)

        h_hue, h_sat, h_bias, b_hue, b_sat, b_bias = params
        l_tgt = gcv.shift_palette(gcv.BASE_FUR_PALETTE, h_hue, h_sat, h_bias)
        r_tgt = gcv.shift_palette(gcv.BASE_FUR_PALETTE, b_hue, b_sat, b_bias)
        l_map = gcv.build_pixel_map(gcv.BASE_FUR_PALETTE, l_tgt)
        r_map = gcv.build_pixel_map(gcv.BASE_FUR_PALETTE, r_tgt)

        src_dir = RAW / gcv.BASE_CAT
        for fp in sorted(src_dir.glob(f'{gcv.BASE_CAT}_*.png')):
            a = np.array(Image.open(fp).convert('RGBA'))
            out = gcv.recolor_frame_split(a, l_map, r_map)
            Image.fromarray(out, 'RGBA').save(dst / fp.name.replace(gcv.BASE_CAT, cid))
        print(f'  regen {cid:6s} {name}')
        regen += 1

    CATS_JSON.write_text(json.dumps(cats, indent=2) + '\n')
    print(f'\nregen={regen}, cats.json entries now: {len(cats)}')


if __name__ == '__main__':
    main()
