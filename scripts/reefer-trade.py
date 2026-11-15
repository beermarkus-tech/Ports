#!/usr/bin/env python3
"""Data change: give refrigerated ships a real trade.

Chilled cargo pays a premium over ordinary freight (the ships cost more), a new
good (dairy) loads at the Rotterdam shipyard, and more ports make and buy
chilled goods so reefers have work in both directions. Safe to re-run.
"""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'src' / 'data'

# ---------------------------------------------------------------- goods
goods = json.loads((root / 'goods.json').read_text())
G = {g['id']: g for g in goods}
for gid, rate in [('fruit', 14), ('meat', 16), ('fish', 17)]:
    G[gid]['freightRate'] = rate
if 'dairy' not in G:
    goods.append({"id": "dairy", "name": "Dairy", "cargoClass": "reefer", "freightRate": 16,
                  "lotMin": 200, "lotMax": 2000, "bigLotMax": 4000})
(root / 'goods.json').write_text('[\n' + ',\n'.join('  ' + json.dumps(g) for g in goods) + '\n]\n')

# ---------------------------------------------------------------- ports
text = (root / 'ports.json').read_text()
data = json.loads(text)
ports = data if isinstance(data, list) else data['ports']
P = {p['id']: p for p in ports}


def add(pid, kind, good, value):
    lst = P[pid][kind]
    key = 'weight' if kind == 'produces' else 'strength'
    if not any(x['good'] == good for x in lst):
        lst.append({"good": good, key: value})


# Who makes chilled goods.
for pid, good, w in [
    ('rotterdam', 'dairy', 2), ('auckland', 'dairy', 2),
    ('alexandria', 'fruit', 1), ('istanbul', 'fruit', 1), ('bangkok', 'fruit', 1),
    ('bangkok', 'fish', 1), ('vancouver', 'fish', 1), ('shanghai', 'fish', 1),
    ('newyork', 'meat', 1),
]:
    add(pid, 'produces', good, w)

# Who buys them (so reefers find chilled cargo on the way back too).
for pid, good, s in [
    ('singapore', 'fruit', 1.1), ('singapore', 'fish', 1.1), ('singapore', 'dairy', 1.2),
    ('dubai', 'dairy', 1.2), ('lagos', 'dairy', 1.2), ('lagos', 'meat', 1.1),
    ('jakarta', 'dairy', 1.1), ('jakarta', 'meat', 1.1), ('mumbai', 'dairy', 1.1),
    ('bangkok', 'dairy', 1.1), ('busan', 'fruit', 1.1), ('busan', 'meat', 1.1),
    ('losangeles', 'fish', 1.0), ('houston', 'fruit', 1.1), ('colombo', 'dairy', 1.1),
    ('alexandria', 'dairy', 1.1), ('vancouver', 'fruit', 1.1), ('shanghai', 'dairy', 1.2),
    ('yokohama', 'dairy', 1.1), ('newyork', 'fish', 1.0),
]:
    add(pid, 'demands', good, s)


def compact(lst, key):
    return '[' + ','.join('{"good":"%s","%s":%s}' % (x['good'], key, json.dumps(x[key])) for x in lst) + ']'


out = []
for p in ports:
    head = {k: v for k, v in p.items() if k not in ('produces', 'demands')}
    head_json = json.dumps(head, ensure_ascii=False)[1:-1]
    out.append('  {' + head_json + ',\n    "produces": ' + compact(p['produces'], 'weight') +
               ',\n    "demands":  ' + compact(p['demands'], 'strength') + ' }')
body = '[\n' + ',\n'.join(out) + '\n]\n'
if not isinstance(data, list):
    raise SystemExit('unexpected ports.json layout')
(root / 'ports.json').write_text(body)
print(f'{len(goods)} goods, {len(ports)} ports')
