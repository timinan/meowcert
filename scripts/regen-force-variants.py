"""Re-apply force_white/force_black recolor with the new crisper lightness
values (white 0.92→0.98, black 0.15→0.05). Iterates shipped.json, finds
every variant whose id is force_white / force_black / dual_*-white /
dual_*-black, and re-recolors the parent's frames into that variant's
existing assets-raw/<id>/ dir.

The variant IDs (cNNN) stay the same — only the bitmap contents change.
After this runs you still need:
  npm run extract:assets
  npm run sync:catalog
to bake the new bitmaps into the atlas.
"""
import json
import importlib.util
from pathlib import Path
from PIL import Image

ROOT = Path('.')
SHIPPED = ROOT / 'tools/cosmetics/variants/shipped.json'
COSMETIC_RAW = ROOT / 'assets-raw/cosmetic'

spec = importlib.util.spec_from_file_location(
    'ship_module', ROOT / 'scripts/ship-cosmetic-variants.py')
ship = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ship)


def is_force_or_force_dual(variant_id: str) -> bool:
    if variant_id.startswith('force_'):
        return True
    if variant_id.startswith('dual_'):
        combo = variant_id[len('dual_'):]
        recipes = ship.DUAL_COMBOS.get(combo)
        if recipes is None:
            return False
        for r in recipes:
            if r[0] == 'force':
                return True
    return False


def main():
    shipped = json.load(open(SHIPPED))
    targets = []  # (parent, variant_id, new_id)
    for parent, variants in shipped.items():
        if not isinstance(variants, dict):
            continue
        for vid, info in variants.items():
            if is_force_or_force_dual(vid):
                targets.append((parent, vid, info['new_id']))
    print(f'regen {len(targets)} variants')

    regen = 0
    skipped = []
    for parent, vid, new_id in targets:
        parent_dir = COSMETIC_RAW / parent
        new_dir = COSMETIC_RAW / new_id
        if not parent_dir.exists() or not new_dir.exists():
            skipped.append((parent, vid, new_id, 'dir missing'))
            continue
        # Pre-compute parent clusters from idle_00 (matches ship script's logic)
        parent_idle0 = parent_dir / f'cosmetic_{parent}_idle_00.png'
        if not parent_idle0.exists():
            skipped.append((parent, vid, new_id, 'no idle_00'))
            continue
        img0 = Image.open(parent_idle0).convert('RGBA')
        clusters = ship.find_hue_clusters(img0)
        primary_hue = clusters[0][0] if clusters else 0

        # Re-recolor every source frame of the parent into new_dir
        sources = sorted(parent_dir.glob(f'cosmetic_{parent}_*.png'))
        for sp in sources:
            try:
                img = Image.open(sp).convert('RGBA')
                out = ship.apply_variant(img, vid, primary_hue, clusters)
                dst_name = sp.name.replace(parent, new_id)
                out.save(new_dir / dst_name)
            except Exception as e:
                skipped.append((parent, vid, new_id, f'{sp.name}: {e}'))
                break
        regen += 1
        if regen % 20 == 0:
            print(f'  {regen}/{len(targets)} ...')

    print(f'\ndone: regen={regen}  skipped={len(skipped)}')
    for s in skipped[:5]:
        print('  skipped:', s)


if __name__ == '__main__':
    main()
