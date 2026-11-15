#!/usr/bin/env python3
"""One-off data expansion: 16 new ports, 9 new goods, and the sea lanes to reach them.
Kept in the repo as a record of where the data came from; safe to re-run (it skips
anything already present)."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'src' / 'data'

# ---------------------------------------------------------------- goods
goods = json.loads((root / 'goods.json').read_text())
have = {g['id'] for g in goods}
new_goods = [
    {"id": "rice", "name": "Rice", "cargoClass": "bulk", "freightRate": 5.5, "lotMin": 1000, "lotMax": 5000, "bigLotMax": 25000},
    {"id": "sugar", "name": "Sugar", "cargoClass": "bulk", "freightRate": 5, "lotMin": 1500, "lotMax": 5000, "bigLotMax": 30000},
    {"id": "bauxite", "name": "Bauxite", "cargoClass": "bulk", "freightRate": 3.5, "lotMin": 1500, "lotMax": 5000, "bigLotMax": 45000},
    {"id": "rubber", "name": "Rubber", "cargoClass": "general", "freightRate": 11, "lotMin": 200, "lotMax": 1500, "bigLotMax": 3000},
    {"id": "cotton", "name": "Cotton", "cargoClass": "general", "freightRate": 9, "lotMin": 300, "lotMax": 2000, "bigLotMax": 4000},
    {"id": "wool", "name": "Wool", "cargoClass": "general", "freightRate": 12, "lotMin": 200, "lotMax": 1500, "bigLotMax": 3000},
    {"id": "tea", "name": "Tea", "cargoClass": "general", "freightRate": 15, "lotMin": 100, "lotMax": 800, "bigLotMax": 2000},
    {"id": "palmoil", "name": "Palm oil", "cargoClass": "liquid", "freightRate": 6, "lotMin": 2000, "lotMax": 12000, "bigLotMax": 25000},
    {"id": "fish", "name": "Fish", "cargoClass": "reefer", "freightRate": 13, "lotMin": 300, "lotMax": 2500, "bigLotMax": 4000},
]
goods += [g for g in new_goods if g['id'] not in have]
(root / 'goods.json').write_text('[\n' + ',\n'.join('  ' + json.dumps(g) for g in goods) + '\n]\n')

# ---------------------------------------------------------------- ports
ports = json.loads((root / 'ports.json').read_text())
P = {p['id']: p for p in ports}


def port(pid, name, country, lat, lon, fuel, fee, produces, demands, label=None, shipyard=False):
    if pid in P:
        return
    p = {"id": pid, "name": name, "country": country, "lat": lat, "lon": lon, "fuelPrice": fuel, "portFee": fee}
    if shipyard:
        p['shipyard'] = True
    if label:
        p['label'] = label
    p['produces'] = [{"good": g, "weight": w} for g, w in produces]
    p['demands'] = [{"good": g, "strength": s} for g, s in demands]
    ports.append(p)
    P[pid] = p


port('houston', 'Houston', 'USA', 29.6, -94.9, 360, 4400,
     [('fuelproducts', 2), ('chemicals', 2), ('grain', 2), ('cotton', 2), ('crude', 1)],
     [('machinery', 1.1), ('steel', 1.1), ('cars', 1.1), ('electronics', 1.1), ('coffee', 1.1)], label='below')
port('losangeles', 'Los Angeles', 'USA', 33.72, -118.27, 440, 4600,
     [('machinery', 2), ('fruit', 1), ('chemicals', 1)],
     [('electronics', 1.3), ('cars', 1.2), ('textiles', 1.2), ('steel', 1.1), ('fuelproducts', 1.1), ('crude', 1.1), ('coffee', 1.1)], label='left')
port('vancouver', 'Vancouver', 'Canada', 49.29, -123.11, 450, 4200,
     [('grain', 3), ('timber', 2), ('coal', 2), ('copper', 1)],
     [('cars', 1.2), ('electronics', 1.2), ('machinery', 1.1), ('textiles', 1.1), ('fuelproducts', 1.0)], label='left')
port('valparaiso', 'Valparaíso', 'Chile', -33.03, -71.63, 480, 3500,
     [('copper', 3), ('fruit', 2), ('fish', 1), ('wine', 1)],
     [('machinery', 1.3), ('cars', 1.2), ('fuelproducts', 1.2), ('electronics', 1.2), ('chemicals', 1.1)], label='left')
port('buenosaires', 'Buenos Aires', 'Argentina', -34.6, -58.37, 470, 3600,
     [('grain', 3), ('meat', 2), ('wool', 1)],
     [('machinery', 1.3), ('cars', 1.2), ('fertilizer', 1.2), ('chemicals', 1.1), ('electronics', 1.1)], label='below')
port('dubai', 'Dubai', 'UAE', 25.01, 55.06, 320, 4300,
     [('crude', 3), ('fuelproducts', 2), ('chemicals', 1), ('fertilizer', 1)],
     [('machinery', 1.2), ('cars', 1.3), ('electronics', 1.2), ('grain', 1.2), ('rice', 1.3), ('steel', 1.1), ('textiles', 1.1),
      ('sugar', 1.2), ('tea', 1.2), ('bauxite', 1.3), ('fruit', 1.2), ('meat', 1.2)], label='above')
port('mombasa', 'Mombasa', 'Kenya', -4.06, 39.67, 500, 3100,
     [('tea', 2), ('coffee', 2), ('fruit', 1)],
     [('machinery', 1.2), ('fuelproducts', 1.2), ('cars', 1.2), ('grain', 1.2), ('rice', 1.2), ('steel', 1.1), ('sugar', 1.1)])
port('alexandria', 'Alexandria', 'Egypt', 31.2, 29.9, 430, 3300,
     [('cotton', 2), ('fertilizer', 2), ('textiles', 1)],
     [('grain', 1.3), ('machinery', 1.1), ('timber', 1.1), ('cars', 1.1), ('palmoil', 1.1), ('tea', 1.2), ('meat', 1.1)], label='below')
port('istanbul', 'Istanbul', 'Turkey', 41.0, 28.98, 440, 3700,
     [('steel', 2), ('textiles', 2), ('cars', 1), ('machinery', 1)],
     [('crude', 1.2), ('coal', 1.2), ('cotton', 1.3), ('grain', 1.1), ('wool', 1.1), ('tea', 1.2), ('sugar', 1.1)])
port('colombo', 'Colombo', 'Sri Lanka', 6.94, 79.84, 410, 3000,
     [('tea', 3), ('textiles', 2), ('rubber', 1)],
     [('machinery', 1.2), ('fuelproducts', 1.2), ('grain', 1.2), ('rice', 1.1), ('cotton', 1.1), ('cars', 1.1)], label='below')
port('bangkok', 'Bangkok', 'Thailand', 13.08, 100.88, 410, 3400,
     [('rice', 3), ('rubber', 2), ('sugar', 1), ('cars', 1)],
     [('machinery', 1.2), ('steel', 1.1), ('fuelproducts', 1.1), ('chemicals', 1.1), ('cotton', 1.0)], label='right')
port('jakarta', 'Jakarta', 'Indonesia', -6.1, 106.88, 400, 3500,
     [('palmoil', 3), ('rubber', 2), ('coal', 2), ('textiles', 1)],
     [('machinery', 1.2), ('fertilizer', 1.2), ('grain', 1.1), ('electronics', 1.0), ('cotton', 1.1), ('fuelproducts', 1.1)], label='below')
port('busan', 'Busan', 'South Korea', 35.1, 129.04, 380, 4000,
     [('cars', 2), ('steel', 2), ('electronics', 2), ('machinery', 1), ('fish', 1)],
     [('ironore', 1.3), ('coal', 1.2), ('crude', 1.2), ('grain', 1.1), ('rubber', 1.1), ('copper', 1.1)], label='above', shipyard=True)
port('yokohama', 'Yokohama', 'Japan', 35.44, 139.65, 420, 4500,
     [('cars', 3), ('electronics', 2), ('machinery', 2), ('steel', 1)],
     [('ironore', 1.3), ('coal', 1.3), ('crude', 1.3), ('grain', 1.2), ('meat', 1.2), ('fruit', 1.1), ('timber', 1.1),
      ('fish', 1.3), ('rubber', 1.2), ('sugar', 1.1)])
port('porthedland', 'Port Hedland', 'Australia', -20.31, 118.58, 470, 3800,
     [('ironore', 4), ('bauxite', 1)],
     [('fuelproducts', 1.2), ('machinery', 1.1)])
port('auckland', 'Auckland', 'New Zealand', -36.84, 174.77, 520, 3900,
     [('meat', 2), ('wool', 2), ('timber', 1), ('fish', 1)],
     [('cars', 1.3), ('machinery', 1.2), ('fuelproducts', 1.2), ('electronics', 1.2), ('textiles', 1.1)], label='above')


def add(pid, kind, good, value):
    lst = P[pid][kind]
    key = 'weight' if kind == 'produces' else 'strength'
    if not any(x['good'] == good for x in lst):
        lst.append({"good": good, key: value})


# New goods in the existing ports too, so they close trade loops.
add('santos', 'produces', 'sugar', 2)
add('sydney', 'produces', 'wool', 1)
add('mumbai', 'produces', 'cotton', 1)
for good, s in [('palmoil', 1.3), ('rubber', 1.0)]:
    add('mumbai', 'demands', good, s)
for good, s in [('sugar', 1.0), ('rubber', 1.0), ('palmoil', 1.1), ('wool', 1.0), ('tea', 1.1), ('fish', 1.0)]:
    add('rotterdam', 'demands', good, s)
for good, s in [('sugar', 1.1), ('rubber', 1.2), ('palmoil', 1.2), ('cotton', 1.2), ('wool', 1.2), ('bauxite', 1.2), ('fish', 1.1)]:
    add('shanghai', 'demands', good, s)
for good, s in [('sugar', 1.0), ('rubber', 1.0), ('tea', 1.0)]:
    add('newyork', 'demands', good, s)
for good, s in [('rice', 1.3), ('palmoil', 1.1), ('fish', 1.1)]:
    add('lagos', 'demands', good, s)
add('genoa', 'demands', 'wool', 1.1)
# Regional trade, so a small ship isn't stranded in the Americas.
add('rotterdam', 'demands', 'grain', 1.0)
add('rotterdam', 'demands', 'cotton', 1.0)
add('santos', 'demands', 'grain', 1.1)
add('houston', 'produces', 'fertilizer', 1)
P['sydney'].setdefault('label', 'left')
P['shanghai'].setdefault('label', 'left')

out = []
for p in ports:
    head = {k: p[k] for k in ('id', 'name', 'country', 'lat', 'lon', 'fuelPrice', 'portFee')}
    for k in ('shipyard', 'label'):
        if k in p:
            head[k] = p[k]
    s = '  ' + json.dumps(head, ensure_ascii=False)[:-1] + ',\n'
    s += '    "produces": ' + json.dumps(p['produces'], separators=(',', ':')) + ',\n'
    s += '    "demands":  ' + json.dumps(p['demands'], separators=(',', ':')) + ' }'
    out.append(s)
(root / 'ports.json').write_text('[\n' + ',\n'.join(out) + '\n]\n')

# ---------------------------------------------------------------- sea lanes
lanes = json.loads((root / 'sealanes.json').read_text())
node_ids = {n['id'] for n in lanes['nodes']}
new_nodes = [
    # Gulf of Mexico and Florida
    ('gulf', 26.0, -89.5), ('yucatan', 21.6, -85.6), ('floridastr', 24.0, -81.6), ('floridaexit', 25.8, -79.6),
    # North American Pacific coast
    ('cabo', 22.0, -110.6), ('baja', 27.5, -116.0), ('mendocino', 40.0, -125.6), ('juandefuca', 48.45, -125.1), ('victoria', 48.25, -123.3),
    ('pac_n', 46.0, -165.0),
    # South American Pacific coast and Cape Horn
    ('peru', -5.0, -83.0), ('atacama', -20.0, -73.6), ('chiloe', -45.0, -76.5), ('horn', -57.6, -65.4),
    ('patagonia', -48.0, -60.0), ('plata', -36.2, -55.0), ('riogrande', -33.5, -51.0),
    # Arabian Sea and Gulf
    ('oman', 18.5, 59.5), ('hadd', 22.7, 60.2), ('hormuz', 26.6, 56.6), ('hormuz_w', 26.55, 55.9),
    # East Africa
    ('somali', 2.0, 48.0),
    # Eastern Mediterranean and the Straits
    ('matapan', 35.8, 22.4), ('aegean', 37.3, 24.7), ('dardanelles', 40.0, 26.1), ('marmara', 40.75, 28.0),
    ('rhodes', 35.3, 27.8), ('nile_n', 31.9, 31.0),
    # South-East Asia
    ('gulfthai', 6.5, 104.2), ('sunda', -6.6, 105.2), ('lombok', -8.5, 115.8), ('lombok_s', -10.2, 115.9),
    ('makassar', -3.0, 118.0), ('makassar_n', 1.5, 119.2), ('celebes', 4.0, 123.5), ('sangihe', 4.8, 126.0),
    ('phil_e', 10.0, 128.5), ('luzon_e', 19.0, 124.5), ('taiwan_e', 23.5, 122.8),
    # Western Australia
    ('nwcape', -21.6, 113.3), ('shark', -26.0, 112.5),
    # Korea and Japan
    ('jeju_s', 32.6, 126.6), ('korea_str', 34.2, 129.2), ('kyushu_s', 30.8, 130.6), ('kii', 33.0, 136.0), ('izu', 34.2, 139.3),
    # New Zealand
    ('hauraki', -36.0, 175.6), ('bayislands', -34.8, 174.6), ('northcape', -34.0, 173.0),
]
for nid, lat, lon in new_nodes:
    if nid not in node_ids:
        lanes['nodes'].append({"id": nid, "lat": lat, "lon": lon})

edge_keys = {tuple(sorted(e if isinstance(e, list) else [e['a'], e['b']])) for e in lanes['edges']}
new_edges = [
    # Houston and the Caribbean
    ('houston', 'gulf'), ('gulf', 'yucatan'), ('yucatan', 'colon'), ('gulf', 'floridastr'), ('floridastr', 'floridaexit'),
    ('floridaexit', 'nyapproach'), ('floridaexit', 'sargasso'), ('floridaexit', 'bahamas'),
    # Los Angeles, Vancouver and the North Pacific
    ('pac_e', 'cabo'), ('cabo', 'baja'), ('baja', 'losangeles'), ('losangeles', 'mendocino'), ('mendocino', 'juandefuca'),
    ('juandefuca', 'victoria'), ('victoria', 'vancouver'), ('losangeles', 'izu'), ('juandefuca', 'pac_n'), ('pac_n', 'izu'),
    ('losangeles', 'pac_s'),
    # Valparaíso, Cape Horn, Buenos Aires
    ('balboa', 'peru'), ('peru', 'atacama'), ('atacama', 'valparaiso'), ('valparaiso', 'chiloe'), ('chiloe', 'horn'),
    ('horn', 'patagonia'), ('patagonia', 'plata'), ('plata', 'buenosaires'), ('plata', 'riogrande'), ('riogrande', 'santos'),
    ('riogrande', 'cabofrio'), ('riogrande', 'capetown'), ('valparaiso', 'pac_s'),
    # Dubai
    ('guardafui', 'oman'), ('oman', 'hadd'), ('hadd', 'hormuz'), ('hormuz', 'hormuz_w'), ('hormuz_w', 'dubai'), ('mumbai', 'hadd'),
    # Mombasa
    ('guardafui', 'somali'), ('somali', 'mombasa'), ('mombasa', 'mascarene'), ('mombasa', 'dondra'),
    # Alexandria and Istanbul
    ('sicily', 'matapan'), ('matapan', 'crete'), ('matapan', 'aegean'), ('aegean', 'dardanelles'), ('dardanelles', 'marmara'),
    ('marmara', 'istanbul'), ('alexandria', 'crete'), ('alexandria', 'nile_n'), ('nile_n', 'portsaid'), ('alexandria', 'rhodes'),
    ('rhodes', 'aegean'), ('rhodes', 'portsaid'),
    # Colombo
    ('colombo', 'dondra'), ('colombo', 'kerala'),
    # Bangkok
    ('singapore', 'gulfthai'), ('gulfthai', 'bangkok'), ('gulfthai', 'scs_s'),
    # Jakarta and the Sunda Strait
    ('gaspar', 'jakarta'), ('jakarta', 'sunda'), ('sunda', 'dondra'), ('sunda', 'mascarene'), ('sunda', 'leeuwin'),
    # Port Hedland, Lombok, Makassar and the route east of the Philippines
    ('porthedland', 'lombok_s'), ('lombok_s', 'lombok'), ('lombok', 'javasea'), ('lombok', 'makassar'),
    ('makassar', 'makassar_n'), ('makassar_n', 'celebes'), ('celebes', 'sangihe'), ('sangihe', 'phil_e'), ('phil_e', 'luzon_e'),
    ('luzon_e', 'taiwan_e'), ('taiwan_e', 'zhejiang'), ('luzon_e', 'kii'), ('phil_e', 'marianas'),
    ('porthedland', 'nwcape'), ('nwcape', 'shark'), ('shark', 'leeuwin'), ('porthedland', 'sunda'),
    # Korea and Japan
    ('shanghai', 'jeju_s'), ('jeju_s', 'korea_str'), ('korea_str', 'busan'), ('korea_str', 'kyushu_s'), ('kyushu_s', 'kii'),
    ('kii', 'izu'), ('izu', 'yokohama'), ('kii', 'ryukyu'), ('kyushu_s', 'taiwan_e'), ('jeju_s', 'kyushu_s'),
    # Auckland
    ('auckland', 'hauraki'), ('hauraki', 'bayislands'), ('bayislands', 'northcape'), ('northcape', 'nsw'),
    ('northcape', 'pac_s'), ('bayislands', 'vanuatu_n'), ('hauraki', 'pac_s'),
]
for a, b in new_edges:
    if tuple(sorted([a, b])) not in edge_keys:
        lanes['edges'].append([a, b])
        edge_keys.add(tuple(sorted([a, b])))

out = ['{', '  "canals": {']
out.append(',\n'.join(f'    "{k}": {json.dumps(v)}' for k, v in lanes['canals'].items()))
out += ['  },', '  "nodes": [']
out.append(',\n'.join('    ' + json.dumps(n) for n in lanes['nodes']))
out += ['  ],', '  "edges": [']
out.append(',\n'.join('    ' + json.dumps(e) for e in lanes['edges']))
out += ['  ]', '}']
(root / 'sealanes.json').write_text('\n'.join(out) + '\n')
print(f'{len(ports)} ports, {len(goods)} goods, {len(lanes["nodes"])} lane nodes, {len(lanes["edges"])} lanes')
