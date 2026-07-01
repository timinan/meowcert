"""One-shot: resync variant catalog `slot` from parent.

Why: ship-cosmetic-variants.py was supposed to inherit parent slot at ship
time but a different code path (likely the calibrator's freshEntry default
slot:'head' or an earlier ship-script version) left 186 face/neck variants
stuck at slot:'head'. In the DressingRoom they show under the HEAD tab
instead of FACE/NECK, hiding the variant from the slot picker that was
meant to surface it. This script walks shipped.json, looks up each
variant's parent, and copies the parent's slot onto the variant if it
differs. Idempotent. Safe to re-run.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / 'tools/cosmetics/cosmetics.json'
SHIPPED = ROOT / 'tools/cosmetics/variants/shipped.json'


def main() -> None:
    catalog = json.load(open(CATALOG))
    shipped = json.load(open(SHIPPED))
    by_id = {c['id']: c for c in catalog}

    variant_to_parent = {}
    for parent_id, kids in shipped.items():
        for _label, info in kids.items():
            variant_to_parent[info['new_id']] = parent_id

    fixed = 0
    already_correct = 0
    missing = 0
    examples = []
    for variant_id, parent_id in variant_to_parent.items():
        v = by_id.get(variant_id)
        p = by_id.get(parent_id)
        if v is None or p is None:
            missing += 1
            continue
        v_slot = v.get('slot')
        p_slot = p.get('slot')
        if v_slot == p_slot:
            already_correct += 1
            continue
        v['slot'] = p_slot
        fixed += 1
        if len(examples) < 6:
            examples.append((variant_id, v_slot, p_slot, parent_id))

    with open(CATALOG, 'w') as f:
        json.dump(catalog, f, indent=2)

    print('=== resync-variant-slots ===')
    print(f'  fixed:             {fixed}')
    print(f'  already correct:   {already_correct}')
    print(f'  missing entries:   {missing}')
    if examples:
        print('\nFix examples:')
        for vid, was, now, pid in examples:
            print(f'  {vid:7s}  {was!r:8s} -> {now!r}  (parent {pid})')


if __name__ == '__main__':
    main()
