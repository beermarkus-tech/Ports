#!/usr/bin/env python3
"""The Age of Sail world (from 1650, as the Dutch knew it): goods, ports, ships and
regions, written to src/data/sail/. Sea lanes come from scripts/sail-lanes.ts.
Re-run after editing; numbers are on the same scale as the modern game."""
import json
from pathlib import Path

out = Path(__file__).resolve().parent.parent / 'src' / 'data' / 'sail'
out.mkdir(parents=True, exist_ok=True)

# id, name, class, freight rate (per ton per 1000 nm, before pay scale), lot min, lot max, big lot max
GOODS = [
    ('pepper', 'Pepper', 'general', 115, 15, 120, 300),
    ('nutmeg', 'Nutmeg and mace', 'general', 230, 5, 60, 120),
    ('cloves', 'Cloves', 'general', 210, 5, 60, 120),
    ('cinnamon', 'Cinnamon', 'general', 170, 5, 60, 120),
    ('tea', 'Tea', 'general', 145, 10, 80, 160),
    ('silk', 'Silk', 'general', 205, 5, 50, 100),
    ('porcelain', 'Porcelain', 'general', 125, 10, 80, 200),
    ('textiles', 'Indian textiles', 'general', 95, 10, 100, 250),
    ('indigo', 'Indigo', 'general', 135, 5, 60, 120),
    ('saltpetre', 'Saltpetre', 'bulk', 55, 20, 150, 400),
    ('coffee', 'Coffee', 'general', 105, 10, 100, 250),
    ('sugar', 'Sugar', 'bulk', 62, 20, 160, 500),
    ('tobacco', 'Tobacco', 'general', 72, 10, 120, 300),
    ('silver', 'Silver', 'general', 155, 2, 30, 60),
    ('gold', 'Gold', 'general', 240, 1, 10, 20),
    ('copper', 'Copper', 'bulk', 62, 10, 120, 300),
    ('tin', 'Tin', 'bulk', 52, 10, 120, 300),
    ('ivory', 'Ivory', 'general', 160, 2, 30, 60),
    ('furs', 'Furs and deerskins', 'general', 120, 5, 60, 150),
    ('cloth', 'Woollen cloth', 'general', 72, 10, 120, 300),
    ('wine', 'Wine and brandy', 'general', 52, 10, 150, 400),
    ('grain', 'Grain', 'bulk', 26, 30, 250, 800),
    ('timber', 'Timber and naval stores', 'bulk', 22, 30, 250, 800),
    ('salt', 'Salt', 'bulk', 21, 30, 250, 800),
    ('cod', 'Stockfish', 'general', 38, 20, 150, 400),
    ('rice', 'Rice', 'bulk', 31, 30, 250, 800),
]

# id, name, country, lat, lon, victuals price, port fee, produces [(good, weight)], demands [(good, strength)], extra
PORTS = [
    ('amsterdam', 'Amsterdam', 'Dutch Republic', 52.37, 4.9, 240, 2600,
     [('cloth', 3), ('grain', 2), ('timber', 1), ('wine', 1)],
     [('pepper', 1.3), ('nutmeg', 1.4), ('cloves', 1.4), ('cinnamon', 1.3), ('tea', 1.1), ('silk', 1.3), ('porcelain', 1.3), ('textiles', 1.2),
      ('sugar', 1.2), ('tobacco', 1.1), ('coffee', 1.1), ('furs', 1.1), ('indigo', 1.2), ('saltpetre', 1.1), ('cod', 1.0)], {'shipyard': True}),
    ('london', 'London', 'England', 51.5, -0.1, 250, 2700,
     [('cloth', 3), ('grain', 1)],
     [('pepper', 1.2), ('textiles', 1.3), ('tobacco', 1.3), ('sugar', 1.3), ('tea', 1.1), ('coffee', 1.2), ('indigo', 1.1), ('saltpetre', 1.2)], {'label': 'left'}),
    ('danzig', 'Danzig', 'Poland', 54.35, 18.65, 200, 1800,
     [('grain', 3), ('timber', 2)],
     [('salt', 1.3), ('wine', 1.2), ('cloth', 1.1), ('pepper', 1.1), ('sugar', 1.1)], {}),
    ('bergen', 'Bergen', 'Norway', 60.39, 5.32, 220, 1600,
     [('cod', 3), ('timber', 1)],
     [('grain', 1.3), ('salt', 1.2), ('cloth', 1.1), ('wine', 1.1)], {}),
    ('lisbon', 'Lisbon', 'Portugal', 38.7, -9.14, 230, 2400,
     [('salt', 3), ('wine', 2)],
     [('grain', 1.3), ('cloth', 1.2), ('cinnamon', 1.2), ('pepper', 1.2), ('cod', 1.2), ('timber', 1.1)], {'label': 'left'}),
    ('cadiz', 'Cádiz', 'Spain', 36.53, -6.29, 230, 2400,
     [('wine', 3), ('salt', 1), ('silver', 1)],
     [('cloth', 1.3), ('grain', 1.2), ('textiles', 1.1), ('cod', 1.2), ('timber', 1.1)], {'label': 'below'}),
    ('venice', 'Venice', 'Republic of Venice', 45.43, 12.33, 240, 2500,
     [('wine', 2), ('cloth', 1)],
     [('pepper', 1.3), ('cinnamon', 1.2), ('coffee', 1.2), ('textiles', 1.1), ('silk', 1.1)], {}),
    ('elmina', 'Elmina', 'Gold Coast', 5.08, -1.35, 270, 1800,
     [('gold', 2), ('ivory', 2)],
     [('cloth', 1.3), ('textiles', 1.3), ('wine', 1.1), ('copper', 1.2)], {}),
    ('cape', 'The Cape', 'Cape of Good Hope', -33.92, 18.42, 140, 1200,
     [('grain', 1)],
     [('cloth', 1.1), ('rice', 1.2), ('textiles', 1.1), ('wine', 1.1), ('timber', 1.2)], {}),
    ('mozambique', 'Mozambique', 'Portuguese East Africa', -15.03, 40.7, 260, 1800,
     [('ivory', 2), ('gold', 1)],
     [('textiles', 1.3), ('cloth', 1.1), ('rice', 1.1)], {}),
    ('zanzibar', 'Zanzibar', 'Swahili Coast', -6.16, 39.2, 240, 1600,
     [('ivory', 2)],
     [('textiles', 1.3), ('rice', 1.2), ('porcelain', 1.1)], {}),
    ('mocha', 'Mocha', 'Yemen', 13.32, 43.25, 260, 2000,
     [('coffee', 3)],
     [('textiles', 1.3), ('rice', 1.2), ('pepper', 1.2), ('silver', 1.3), ('cloves', 1.1)], {}),
    ('bandarabbas', 'Bandar Abbas', 'Persia', 27.18, 56.27, 250, 2100,
     [('silk', 2)],
     [('pepper', 1.3), ('sugar', 1.2), ('textiles', 1.1), ('silver', 1.3), ('copper', 1.1), ('cloves', 1.2)], {'label': 'left'}),
    ('surat', 'Surat', 'Mughal India', 21.17, 72.83, 200, 2300,
     [('textiles', 3), ('indigo', 2), ('saltpetre', 1)],
     [('silver', 1.4), ('copper', 1.2), ('cloves', 1.2), ('cloth', 1.1), ('nutmeg', 1.1)], {}),
    ('goa', 'Goa', 'Portuguese India', 15.5, 73.8, 210, 2100,
     [('pepper', 2), ('textiles', 1)],
     [('silver', 1.3), ('wine', 1.2), ('copper', 1.1)], {'label': 'left'}),
    ('calicut', 'Calicut', 'Malabar Coast', 11.25, 75.78, 190, 1900,
     [('pepper', 3)],
     [('silver', 1.3), ('copper', 1.2), ('rice', 1.1)], {'label': 'left'}),
    ('galle', 'Galle', 'Ceylon', 6.03, 80.22, 200, 1900,
     [('cinnamon', 3), ('ivory', 1)],
     [('rice', 1.3), ('textiles', 1.2), ('copper', 1.1)], {}),
    ('madras', 'Madras', 'Coromandel Coast', 13.08, 80.27, 200, 2000,
     [('textiles', 3), ('saltpetre', 1), ('indigo', 1)],
     [('silver', 1.3), ('nutmeg', 1.1), ('copper', 1.2), ('cloves', 1.1)], {}),
    ('malacca', 'Malacca', 'Malay Peninsula', 2.2, 102.25, 200, 2000,
     [('tin', 2), ('pepper', 1)],
     [('textiles', 1.3), ('rice', 1.1), ('porcelain', 1.1)], {'label': 'left'}),
    ('bantam', 'Bantam', 'Java', -6.03, 106.15, 190, 1900,
     [('pepper', 3)],
     [('textiles', 1.3), ('silver', 1.2), ('porcelain', 1.2), ('copper', 1.1)], {'label': 'left'}),
    ('batavia', 'Batavia', 'VOC, Java', -6.13, 106.8, 190, 2400,
     [('sugar', 2), ('pepper', 1), ('rice', 2)],
     [('textiles', 1.3), ('silver', 1.3), ('cloth', 1.1), ('tea', 1.1), ('porcelain', 1.1), ('wine', 1.2)], {'shipyard': True, 'label': 'below'}),
    ('banda', 'Banda', 'Spice Islands', -4.52, 129.9, 230, 1800,
     [('nutmeg', 4), ('cloves', 2)],
     [('rice', 1.4), ('textiles', 1.3)], {}),
    ('patani', 'Patani', 'Malay Peninsula', 6.87, 101.25, 190, 1800,
     [('pepper', 2), ('gold', 1)],
     [('silk', 1.2), ('porcelain', 1.2), ('textiles', 1.2), ('copper', 1.1)], {'label': 'left'}),
    ('macassar', 'Macassar', 'Celebes', -5.13, 119.41, 200, 1800,
     [('cloves', 2), ('rice', 2)],
     [('textiles', 1.3), ('silver', 1.2), ('porcelain', 1.2), ('silk', 1.1)], {'label': 'left'}),
    ('ayutthaya', 'Ayutthaya', 'Siam', 14.35, 100.57, 180, 1800,
     [('rice', 2), ('tin', 1), ('furs', 1)],
     [('textiles', 1.2), ('silver', 1.2), ('copper', 1.1)], {'label': 'left'}),
    ('hoian', 'Hoi An', 'Đại Việt', 15.88, 108.33, 190, 1800,
     [('silk', 2), ('sugar', 1)],
     [('silver', 1.3), ('copper', 1.2), ('textiles', 1.1)], {'label': 'below'}),
    ('manila', 'Manila', 'Spanish Philippines', 14.6, 120.98, 210, 2100,
     [('silver', 3), ('sugar', 1)],
     [('silk', 1.4), ('porcelain', 1.3), ('textiles', 1.1)], {}),
    ('macau', 'Macau', 'Portuguese China', 22.2, 113.54, 210, 2200,
     [('silk', 2), ('porcelain', 1)],
     [('silver', 1.4), ('pepper', 1.2)], {'label': 'below'}),
    ('canton', 'Canton', 'Ming China', 23.13, 113.26, 200, 2400,
     [('silk', 2), ('porcelain', 2), ('tea', 2)],
     [('silver', 1.5), ('pepper', 1.2), ('textiles', 1.1)], {'label': 'left'}),
    ('amoy', 'Amoy', 'Fujian, China', 24.48, 118.08, 200, 2200,
     [('porcelain', 2), ('silk', 2), ('tea', 2), ('sugar', 1)],
     [('silver', 1.4), ('pepper', 1.3), ('cloves', 1.2), ('rice', 1.1)], {'label': 'above'}),
    ('zeelandia', 'Zeelandia', 'VOC, Formosa', 23.0, 120.16, 210, 2000,
     [('sugar', 2), ('furs', 2)],
     [('textiles', 1.1), ('silver', 1.2), ('pepper', 1.2)], {}),
    ('dejima', 'Dejima', 'Nagasaki, Japan', 32.75, 129.87, 240, 2600,
     [('copper', 3), ('silver', 2)],
     [('silk', 1.5), ('furs', 1.3), ('sugar', 1.3), ('textiles', 1.2)], {}),
    ('havana', 'Havana', 'Spanish Cuba', 23.13, -82.38, 230, 2200,
     [('sugar', 2), ('tobacco', 2)],
     [('cloth', 1.2), ('wine', 1.2), ('grain', 1.1)], {'label': 'left'}),
    ('cartagena', 'Cartagena', 'Spanish Main', 10.4, -75.55, 240, 2200,
     [('silver', 2), ('gold', 1)],
     [('cloth', 1.3), ('wine', 1.3), ('textiles', 1.1)], {'label': 'below'}),
    ('veracruz', 'Veracruz', 'New Spain', 19.2, -96.13, 240, 2300,
     [('silver', 3), ('indigo', 1)],
     [('cloth', 1.3), ('wine', 1.2), ('textiles', 1.2)], {'label': 'left'}),
    ('portobelo', 'Portobelo', 'Isthmus of Panama', 9.55, -79.65, 240, 2100,
     [('silver', 2)],
     [('cloth', 1.3), ('wine', 1.2)], {'label': 'left'}),
    ('barbados', 'Barbados', 'English Caribbean', 13.1, -59.6, 230, 1800,
     [('sugar', 3)],
     [('grain', 1.2), ('cloth', 1.1), ('cod', 1.2), ('timber', 1.1)], {}),
    ('bahia', 'Bahia', 'Portuguese Brazil', -12.97, -38.5, 220, 2000,
     [('sugar', 3), ('tobacco', 1)],
     [('cloth', 1.2), ('wine', 1.2), ('grain', 1.1)], {}),
    ('recife', 'Recife', 'Dutch Brazil', -8.05, -34.88, 220, 1900,
     [('sugar', 3), ('timber', 1)],
     [('cloth', 1.2), ('grain', 1.2), ('wine', 1.1)], {}),
    ('jamestown', 'Jamestown', 'Virginia', 37.21, -76.78, 230, 1700,
     [('tobacco', 3), ('timber', 1)],
     [('cloth', 1.3), ('wine', 1.1), ('salt', 1.1)], {'label': 'left'}),
    ('newamsterdam', 'New Amsterdam', 'New Netherland', 40.7, -74.01, 230, 1800,
     [('furs', 3), ('timber', 1), ('grain', 1)],
     [('cloth', 1.3), ('wine', 1.1), ('salt', 1.1)], {}),
    ('boston', 'Boston', 'New England', 42.36, -71.06, 230, 1700,
     [('cod', 2), ('timber', 2), ('furs', 1)],
     [('cloth', 1.2), ('sugar', 1.2), ('wine', 1.1), ('salt', 1.2)], {}),
    # The South Sea: Spanish water the Dutch had barely seen in 1650 (under fog at the start).
    ('acapulco', 'Acapulco', 'New Spain', 16.85, -99.9, 260, 2400,
     [('silver', 4), ('indigo', 1)],
     [('silk', 1.7), ('porcelain', 1.6), ('textiles', 1.4), ('cloth', 1.3), ('wine', 1.3)], {}),
    ('callao', 'Callao', 'Peru', -12.05, -77.15, 270, 2400,
     [('silver', 4), ('gold', 1), ('copper', 1)],
     [('cloth', 1.6), ('wine', 1.5), ('textiles', 1.3), ('silk', 1.4), ('timber', 1.2)], {}),
]

# id, name, description, capacity (t), speed (kn, in a fair wind), victuals per day (rations of 10 hands), victuals carried,
# daily cost, size factor, repair cost per point, new price
SHIPS = [
    ('jacht', 'Jacht', 'A small, quick Dutch yacht: coasting, scouting and urgent errands. Takes small lots anywhere.', 80, 7, 1.5, 300, 700, 0.5, 1500, 700_000),
    ('fluyt', 'Fluyt', 'The Dutch workhorse: a big hold for a tiny crew, almost no guns. Cheap to run.', 300, 6, 2, 420, 1100, 0.8, 2200, 1_700_000),
    ('largefluyt', 'Large fluyt', 'A bigger fluyt for the Baltic and Mediterranean bulk trades.', 500, 6, 3, 630, 1600, 1.0, 2800, 2_700_000),
    ('pinas', 'Pinnace', 'An armed, quicker merchantman: at home where pirates and privateers sail.', 400, 7, 6, 1260, 2600, 1.0, 3000, 3_200_000),
    ('indiaman', 'East Indiaman', 'The long-haul trader: roomy, armed, built for voyages of two years.', 800, 6.5, 12, 2520, 4200, 1.6, 4500, 6_200_000),
    ('retourschip', 'Retourschip', "The Company's great homeward-bound ship: holds full of spice, a small town of crew.", 1100, 6.5, 18, 3780, 6000, 2.0, 6000, 9_800_000),
]

# Junks, for the Chinese house: battened sails that point higher into the wind than square sails,
# and a hold divided by watertight bulkheads (they spring leaks less often).
JUNKS = [
    ('smalljunk', 'Fujian junk', 'A small coasting junk from Fujian: two masts of battened sails, a hold in watertight compartments. Takes small lots anywhere.', 100, 6.5, 1.6, 320, 700, 0.55, 1400, 650_000),
    ('oceanjunk', 'Ocean junk', 'The trading junk of the Nanyang: three masts, a deep hold, and merchants aboard who each rent a compartment.', 320, 6.5, 2.4, 560, 1150, 0.85, 2100, 1_750_000),
    ('nanyangjunk', 'Large ocean junk', 'A bigger ocean junk for the long runs to Batavia, Siam and Manila.', 550, 6.2, 4, 1000, 1900, 1.1, 2900, 3_000_000),
    ('greatjunk', 'Great junk', 'The largest of the trading junks: a floating market of several hundred merchants and crew.', 900, 6, 11, 2600, 4600, 1.7, 4600, 7_000_000),
]

REGIONS = [
    ('northsea', 'North Sea & Baltic', ['amsterdam', 'london', 'danzig', 'bergen']),
    ('iberia', 'Iberia & the Mediterranean', ['lisbon', 'cadiz', 'venice']),
    ('guinea', 'Guinea Coast & the Cape', ['elmina', 'cape']),
    ('arabia', 'East Africa & Arabia', ['mozambique', 'zanzibar', 'mocha']),
    ('india', 'Persia & India', ['bandarabbas', 'surat', 'goa', 'calicut', 'galle', 'madras']),
    ('indies', 'The East Indies', ['malacca', 'patani', 'bantam', 'batavia', 'macassar', 'banda', 'ayutthaya']),
    ('china', 'China Seas & Japan', ['hoian', 'manila', 'macau', 'canton', 'amoy', 'zeelandia', 'dejima']),
    ('caribbean', 'The Caribbean', ['havana', 'cartagena', 'veracruz', 'portobelo', 'barbados']),
    ('northamerica', 'North America', ['jamestown', 'newamsterdam', 'boston']),
    ('brazil', 'Brazil', ['bahia', 'recife']),
    ('southsea', 'The South Sea', ['acapulco', 'callao']),
]

# More buyers, added later: every good must sell somewhere (tin, ivory and gold had no buyer at all),
# and the Chinese house needs buyers in Asia for what it finds in the western seas.
EXTRA_DEMANDS = {
    'canton': [('tin', 1.2), ('ivory', 1.3), ('nutmeg', 1.1)],
    'amoy': [('tin', 1.1), ('ivory', 1.1), ('saltpetre', 1.2), ('nutmeg', 1.1)],  # gunpowder for Koxinga's war on the Qing
    'surat': [('tin', 1.1), ('ivory', 1.3), ('gold', 1.2)],
    'goa': [('ivory', 1.2), ('gold', 1.1)],
    'madras': [('gold', 1.2)],
    'lisbon': [('ivory', 1.1)],
    'amsterdam': [('ivory', 1.0), ('gold', 1.0)],
    'batavia': [('cinnamon', 1.1)],
}

goods = [{'id': i, 'name': n, 'cargoClass': c, 'freightRate': r, 'lotMin': a, 'lotMax': b, 'bigLotMax': m} for i, n, c, r, a, b, m in GOODS]
ids = {g['id'] for g in goods}
ports = []
for pid, name, country, lat, lon, fuel, fee, produces, demands, extra in PORTS:
    demands = demands + [d for d in EXTRA_DEMANDS.get(pid, []) if d[0] not in [x for x, _ in demands]]
    for g, _ in produces + demands:
        assert g in ids, (pid, g)
    p = {'id': pid, 'name': name, 'country': country, 'lat': lat, 'lon': lon, 'fuelPrice': fuel, 'portFee': fee}
    p.update(extra)
    p['produces'] = [{'good': g, 'weight': w} for g, w in produces]
    p['demands'] = [{'good': g, 'strength': s} for g, s in demands]
    ports.append(p)
pids = {p['id'] for p in ports}
for _, _, members in REGIONS:
    for m in members:
        assert m in pids, m
assert sorted(m for _, _, ms in REGIONS for m in ms) == sorted(pids), 'every port in exactly one region'
assert set(EXTRA_DEMANDS) <= pids
for g in ids:
    assert any(d['good'] == g for p in ports for d in p['demands']), f'nobody buys {g}'
ships = [{'id': i, 'name': n, 'description': d, 'capacity': c, 'speedKn': s, 'fuelPerDay': f, 'bunkerCapacity': b, 'dailyCost': dc,
          'sizeFactor': sf, 'repairCostPerPoint': rc, 'newPrice': np, 'cargoClasses': ['bulk', 'general'], 'family': 'sail'}
         for i, n, d, c, s, f, b, dc, sf, rc, np in SHIPS]
ships += [{'id': i, 'name': n, 'description': d, 'capacity': c, 'speedKn': s, 'fuelPerDay': f, 'bunkerCapacity': b, 'dailyCost': dc,
           'sizeFactor': sf, 'repairCostPerPoint': rc, 'newPrice': np, 'cargoClasses': ['bulk', 'general'], 'family': 'sail', 'rig': 'junk'}
          for i, n, d, c, s, f, b, dc, sf, rc, np in JUNKS]
regions = [{'id': i, 'name': n, 'ports': m} for i, n, m in REGIONS]

(out / 'goods.json').write_text(json.dumps(goods, indent=1, ensure_ascii=False) + '\n')
(out / 'ports.json').write_text(json.dumps(ports, indent=1, ensure_ascii=False) + '\n')
(out / 'ships.json').write_text(json.dumps(ships, indent=1, ensure_ascii=False) + '\n')
(out / 'regions.json').write_text(json.dumps(regions, indent=1, ensure_ascii=False) + '\n')
print(f'{len(goods)} goods, {len(ports)} ports, {len(ships)} ships, {len(regions)} regions')
