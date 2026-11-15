#!/usr/bin/env python3
"""Apply balance tweaks to src/data/ships.json, keeping its one-ship-per-block layout.

Usage: python3 scripts/tune-ships.py id.field=value [id.field=value ...]
Example: python3 scripts/tune-ships.py general.newPrice=5500000 general.dailyCost=2800
"""
import json
import sys
from pathlib import Path

path = Path(__file__).resolve().parent.parent / 'src' / 'data' / 'ships.json'
ships = json.loads(path.read_text())
by_id = {s['id']: s for s in ships}

for arg in sys.argv[1:]:
    key, value = arg.split('=', 1)
    ship_id, field = key.split('.', 1)
    if ship_id not in by_id or field not in by_id[ship_id]:
        sys.exit(f'unknown ship or field: {key}')
    by_id[ship_id][field] = json.loads(value)

blocks = []
for s in ships:
    rest = {k: v for k, v in s.items() if k not in ('id', 'name', 'description', 'cargoClasses')}
    blocks.append(
        f'  {{ "id": {json.dumps(s["id"])}, "name": {json.dumps(s["name"])}, "description": {json.dumps(s["description"])},\n'
        f'    {", ".join(f"{json.dumps(k)}: {json.dumps(v)}" for k, v in rest.items())},\n'
        f'    "cargoClasses": {json.dumps(s["cargoClasses"])} }}'
    )
path.write_text('[\n' + ',\n'.join(blocks) + '\n]\n')
print(f'updated {len(sys.argv) - 1} value(s)')
