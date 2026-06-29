#!/bin/bash
# Delete a single cat by ID — wipes raw frames, catalog entry, lane color,
# and regenerates the atlas. Usage:  ./tools/cats/delete-cat.sh cat42
set -e
if [ -z "$1" ]; then echo "usage: $0 catNN"; exit 1; fi
CAT="$1"
cd "$(dirname "$0")/../.."
rm -rf "assets-raw/$CAT"
python3 -c "
import json
d = json.load(open('tools/cats/cats.json'))
d = [c for c in d if c.get('id') != '$CAT']
json.dump(d, open('tools/cats/cats.json','w'), indent=2)
print(f'$CAT removed from catalog')
"
# strip lane color line if present
sed -i '' "/$CAT:/d" src/client/constants/cat-colors.ts 2>/dev/null || true
npm run extract:assets 2>&1 | grep -E "atlas|cats|offsets" | head -3
echo "✓ $CAT deleted"
