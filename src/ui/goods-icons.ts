// Drawn icons for every good: one drawing per good on a 24-unit grid, in two
// treatments. 1650: engraved, ink on parchment, a wash of the good's own colour,
// cross-hatched shade and a slightly uneven line. Modern: line icons in the app's
// navy and blue, filled by cargo class. Classes in a drawing: f = coloured fill,
// w = paper (light, or navy in the modern skin), k = ink, l = line only, m = a
// second colour. Styles live in style.css (.gi).

import { getWorld } from '../sim/world';

function gear(cx: number, cy: number, r1: number, r2: number, n: number): string {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a0 = (i / (n * 2)) * Math.PI * 2, a1 = ((i + 1) / (n * 2)) * Math.PI * 2, r = i % 2 ? r2 : r1;
    const p = (a: number, rr: number) => `${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`;
    d += `${i ? 'L' : 'M'}${p(a0 + 0.08, r)} L${p(a1 - 0.08, r)} `;
  }
  return d + 'Z';
}
const kernels = (x: number, top: number, n: number, dx = 2.3) => Array.from({ length: n }, (_, i) => {
  const y = top + i * 3.6;
  return `<ellipse class="f" cx="${x - dx}" cy="${y}" rx="1.6" ry="2.7" transform="rotate(-28 ${x - dx} ${y})"/><ellipse class="f" cx="${x + dx}" cy="${y}" rx="1.6" ry="2.7" transform="rotate(28 ${x + dx} ${y})"/>`;
}).join('');

const D: Record<string, string> = {
  // ---------- shared shapes ----------
  coffee: '<ellipse class="f" cx="9" cy="13" rx="4.6" ry="6.4" transform="rotate(-25 9 13)"/><path class="l" d="M7.2 7.6c2.6 2.2 0.4 7.4 3.6 10.8"/><ellipse class="f" cx="16" cy="10" rx="4.2" ry="5.8" transform="rotate(30 16 10)"/><path class="l" d="M18.4 5.4c-2.6 1.6-1.6 6.6-4.6 9.4"/>',
  tea: '<path class="f" d="M4 20C4 11 9 5 19 4c0 10-6 16-15 16z"/><path class="l" d="M4 20L14.5 9.5M8 16h4.2M10.8 13.2V9.6M13.4 10.8h3"/><path class="f" d="M14 21c0-4 2-6.5 6-7 0 4-2 6.5-6 7z"/>',
  timber: '<circle class="f" cx="7.5" cy="16" r="4.2"/><circle class="f" cx="16.5" cy="16" r="4.2"/><circle class="f" cx="12" cy="8.6" r="4.2"/><circle class="l" cx="7.5" cy="16" r="1.7"/><circle class="l" cx="16.5" cy="16" r="1.7"/><circle class="l" cx="12" cy="8.6" r="1.7"/>',
  // ---------- modern ----------
  grain: '<path class="l" d="M12 22.5V6.5"/>' + kernels(12, 8.4, 4) + '<ellipse class="f" cx="12" cy="5" rx="1.6" ry="2.8"/>',
  coal: '<path class="w" d="M2.8 19.6l2-5 4.2-1.4 2.6 3-.6 3.4z"/><path class="w" d="M9.8 19.6l1.8-6.2 4.6-2.4 3.6 3.4 1.4 5.2z"/><path class="w" d="M7.6 12.4l2.4-4.6 4 .4 1.2 3.4-3.6 1.8z"/><path class="l" d="M12.4 15.4l2.6 1.4M8.6 10.4l2 .4"/>',
  ironore: '<path class="f" d="M3.5 18.5l2.2-7 5.2-3.2 6.2 1.8 3.4 6-3 4.4H6.6z"/><path class="m" d="M8 12.6l3 .8M13.6 10.8l.8 3.4M9.8 16.4l4.4-1M16.6 14.6l1.8 1.8"/>',
  copper: '<path class="f" d="M3.6 15.4l8.4-4 8.4 4-8.4 4z"/><path class="f" d="M3.6 12l8.4-4 8.4 4-8.4 4z"/><path class="l" d="M3.6 12v3.4M20.4 12v3.4M12 16v3.4"/>',
  fertilizer: '<path class="f" d="M7.2 6.2C6 9 4 12 4 16c0 3.4 3.4 5.4 8 5.4s8-2 8-5.4c0-4-2-7-3.2-9.8z"/><path class="l" d="M7.2 6.2h9.6M9 2.8l3 3.4 3-3.4"/><path class="w" d="M9.6 16.6c0-3 2-4.6 4.8-4.6 0 3-2 4.6-4.8 4.6z"/>',
  steel: '<path class="f" d="M4.5 4.5h15v3.2h-5.6v8.6h5.6v3.2h-15v-3.2h5.6V7.7H4.5z"/>',
  machinery: `<path class="f" d="${gear(12, 12, 8.6, 6.4, 9)}"/><circle class="w" cx="12" cy="12" r="2.8"/>`,
  electronics: '<rect class="f" x="6.5" y="6.5" width="11" height="11" rx="1.6"/><rect class="w" x="9.6" y="9.6" width="4.8" height="4.8" rx=".6"/><path class="l" d="M9 3.5v3M12 3.5v3M15 3.5v3M9 17.5v3M12 17.5v3M15 17.5v3M3.5 9h3M3.5 12h3M3.5 15h3M17.5 9h3M17.5 12h3M17.5 15h3"/>',
  textiles: '<path class="f" d="M7 5.6h10.4a3 6.4 0 0 1 0 12.8H7z"/><ellipse class="w" cx="7" cy="12" rx="3" ry="6.4"/><ellipse class="l" cx="7" cy="12" rx="1.1" ry="2.2"/><path class="f" d="M17.4 18.4v3.4H11v-3.4"/>',
  cocoa: '<path class="l" d="M12 3.2V1.2"/><path class="f" d="M12 3.2c4 0 6.8 4 6.8 8.8S16 21 12 21s-6.8-4.2-6.8-9S8 3.2 12 3.2z"/><path class="l" d="M12 3.4V21M9 4.2c-1.2 5-1.2 11.2 0 16M15 4.2c1.2 5 1.2 11.2 0 16"/>',
  wine: '<path class="f" d="M10 1.8h4v5c2.2 1 3.2 3.2 3.2 5.4v9.2a1 1 0 0 1-1 1H7.8a1 1 0 0 1-1-1v-9.2c0-2.2 1-4.4 3.2-5.4z"/><rect class="w" x="8.4" y="13" width="7.2" height="5.2" rx=".6"/>',
  cars: '<path class="f" d="M2.5 16.6v-3.2l2.2-1.2 3.4-4.4h7.4l4 4 2.2 1.2v3.6z"/><path class="w" d="M8.8 9.2h3v3H6.6zM13.4 9.2h1.8l2.8 3h-4.6z"/><circle class="k" cx="7.4" cy="16.8" r="2.1"/><circle class="k" cx="16.6" cy="16.8" r="2.1"/>',
  crude: '<path class="f" d="M5.6 4.8h12.8v15.4H5.6z"/><path class="l" d="M5.6 8.4h12.8M5.6 16.6h12.8"/><path class="k" d="M12 9.6c2 2.8 2.6 3.8 2.6 5a2.6 2.6 0 0 1-5.2 0c0-1.2.6-2.2 2.6-5z"/>',
  fuelproducts: '<path class="f" d="M5.4 5.2h9.4l3.8 3.8v12.6H5.4z"/><path class="l" d="M7.6 5.2V2.8h4.2v2.4"/><path class="w" d="M8.6 10.4l6.6 7.8M15.2 10.4l-6.6 7.8"/>',
  chemicals: '<path class="f" d="M10 2.8h4v6.4l5.2 10.4a1.6 1.6 0 0 1-1.4 2.4H6.2a1.6 1.6 0 0 1-1.4-2.4L10 9.2z"/><path class="w" d="M7.3 15.6h9.4l2 4H5.3z"/><circle class="l" cx="11" cy="12.6" r=".9"/><circle class="l" cx="13.4" cy="10.6" r=".6"/>',
  fruit: '<circle class="f" cx="12" cy="14" r="7.2"/><path class="l" d="M12 6.8V4.4"/><path class="w" d="M12.2 6.6c.2-2.8 2.6-4 5.2-3.8-.6 2.4-2.4 3.8-5.2 3.8z"/><path class="l" d="M8.4 11.4a4.6 4.6 0 0 1 2.4-2"/>',
  meat: '<path class="f" d="M13.6 2.8c4.2-.6 7.8 2.8 7.4 7.2-.4 4.2-4.6 6.8-8.4 5.8l-2.8 2.8-2-2 2.8-2.8c-1.2-4.2 1-10.4 3-11z"/><path class="w" d="M9.4 17.2l-3 3a1.7 1.7 0 1 1-2.4-1.4 1.7 1.7 0 1 1 1.4-2.4l3-3z"/><path class="l" d="M15 6.6c1.8.2 3 1.4 3.2 3.2"/>',
  rice: '<path class="w" d="M5.4 12c0-3.8 3-6 6.6-6s6.6 2.2 6.6 6z"/><path class="f" d="M3 12h18c0 5-4 8.6-9 8.6S3 17 3 12z"/><path class="l" d="M14.6 2.6l6 7M17 2l4.6 6"/>',
  sugar: '<path class="w" d="M3.6 13.2l5.2-2.2 5.2 2.2v6l-5.2 2.2-5.2-2.2z"/><path class="l" d="M3.6 13.2l5.2 2.2 5.2-2.2M8.8 15.4v6"/><path class="w" d="M11 6.4l4.4-1.8 4.4 1.8v5.2l-4.4 1.8L11 11.6z"/><path class="l" d="M11 6.4l4.4 1.8 4.4-1.8M15.4 8.2v5.2"/>',
  bauxite: '<path class="f" d="M2.8 19l3-6.4 5-1.2 3.2 3 .8 4.6z"/><path class="f" d="M12.6 19l2-6.6 4-2 3 4.2V19z"/><path class="m" d="M6.6 15.4l2 .6M16.4 14l1.4 1.6"/>',
  rubber: '<path class="f" d="M5.4 2.4h6.4v19.2H5.4z"/><path class="l" d="M5.4 8.6l6.4-3.2M5.4 12.6l6.4-3.2"/><path class="l" d="M11.8 11.8h2.4"/><path class="w" d="M14 12.6h6v3.6a3 3 0 0 1-6 0z"/><path class="k" d="M15.4 8.2c.8 1.2 1.2 1.8 1.2 2.4a1.2 1.2 0 0 1-2.4 0c0-.6.4-1.2 1.2-2.4z"/>',
  cotton: '<circle class="w" cx="8.6" cy="10.2" r="3.6"/><circle class="w" cx="15.4" cy="10.2" r="3.6"/><circle class="w" cx="12" cy="6.8" r="3.6"/><path class="f" d="M5.6 12.6c2 2.2 4.2 3.2 6.4 3.2s4.4-1 6.4-3.2l-1 4.2c-1 2-3.2 3.2-5.4 3.2s-4.4-1.2-5.4-3.2z"/><path class="l" d="M12 20v2.4"/>',
  wool: '<circle class="f" cx="11.4" cy="12" r="8"/><path class="l" d="M4.4 9.2c4 1.2 10 1.2 14 0M3.8 13.4c5 2 10.4 2 15.2 0M8.4 4.6c-2 5-2 10 0 14.8M14.4 4.4c2 5 2 10.4 0 15.2"/><path class="l" d="M17.6 17.4c1.8 2 3.2 2.4 4.4 1.4"/>',
  palmoil: '<path class="f" d="M12 2.6c4 6 6.2 9.2 6.2 12.4a6.2 6.2 0 0 1-12.4 0c0-3.2 2.2-6.4 6.2-12.4z"/><path class="w" d="M9.2 15.4a2.8 2.8 0 0 0 2.8 2.8"/>',
  fish: '<path class="f" d="M2.6 12c3-5 9.4-6.4 13.4-3l5.4-3.2v12.4L16 15c-4 3.4-10.4 2-13.4-3z"/><circle class="k" cx="7.2" cy="11" r="1"/><path class="l" d="M11 8.8c1.2 2 1.2 4.4 0 6.4"/>',
  dairy: '<path class="f" d="M6.8 8.4l2.6-4.6h5.2l2.6 4.6v13H6.8z"/><path class="l" d="M6.8 8.4h10.4M9.4 3.8l2.2 4.6"/><path class="w" d="M9 12.2h6v5.4H9z"/>',
  // ---------- 1650 ----------
  pepper: '<path class="l" d="M13 2c0 3-1 5-3 7.2M13 2c2 1.4 4.4 1.4 6.4.4"/>' + [[9,10],[13,10],[11,13.4],[15,13.4],[9,16.8],[13,16.8],[11,20.2]].map(([x, y]) => `<circle class="f" cx="${x}" cy="${y}" r="2.1"/>`).join(''),
  nutmeg: '<ellipse class="f" cx="12" cy="13" rx="6" ry="7.6"/><path class="m" d="M8.4 6.4c-2.2 4-2 10 1.2 14M12 5.4c-1.2 5-1 10 .8 15.2M15.6 6.4c2.2 4 2 10-1.2 14M7 11c3 1 7 1 10 0"/>',
  cloves: '<path class="l" d="M7.4 9.4l4.6 12M15.6 8.6L12.8 21.4"/><circle class="f" cx="7" cy="7" r="2.2"/><path class="f" d="M7 4.8l-1.4-2.6M7 4.8l1.6-2.4M4.8 7.6l-2.6-.8"/><circle class="f" cx="16.4" cy="6.2" r="2.2"/><path class="f" d="M16.4 4l1.4-2.4M16.4 4l-1.6-2.2M18.6 6.8l2.6-.6"/>',
  cinnamon: '<g transform="rotate(-14 12 12)"><rect class="f" x="3" y="5.6" width="18" height="3.4" rx="1.7"/><rect class="f" x="3" y="10.4" width="18" height="3.4" rx="1.7"/><rect class="f" x="3" y="15.2" width="18" height="3.4" rx="1.7"/><path class="l" d="M4.6 7.3a.9.9 0 1 1 .2 0M4.6 12.1a.9.9 0 1 1 .2 0M4.6 16.9a.9.9 0 1 1 .2 0"/></g>',
  silk: '<path class="f" d="M4 4.6h16c-2.2 4.2-2.2 10.6 0 14.8H4c2.2-4.2 2.2-10.6 0-14.8z"/><path class="w" d="M8.4 6.6c1.2 3.4 1.2 7.4 0 10.8"/><path class="l" d="M14.2 6.6c-1.2 3.4-1.2 7.4 0 10.8"/>',
  porcelain: '<path class="l" d="M9.6 2.2h4.8"/><path class="w" d="M9 3.4h6v1.8c3 1.2 5 4 5 8s-2 7-4 8H8c-2-1-4-4-4-8s2-6.8 5-8z"/><path class="m" d="M6.8 10.4c2 2 3-1 5.2 1s3.2-1 5.2 1M7.6 15.8c2.4 1 6.4 1 8.8 0M9.6 5.4h4.8"/>',
  textilesIn: '<path class="f" d="M3.6 6.4h16.8v11.2H3.6z"/><path class="l" d="M3.6 9.4h16.8M3.6 14.6h16.8"/>' + [6,10,14,18].map((x) => `<circle class="w" cx="${x}" cy="12" r="1.1"/>`).join('') + '<path class="f" d="M20.4 17.6l-2 3.6h-4l1-3.6"/>',
  indigo: '<path class="f" d="M3.4 14.2l6.2-3 6.2 3-6.2 3z"/><path class="f" d="M3.4 14.2v4l6.2 3v-4zM15.8 14.2v4l-6.2 3v-4z"/><path class="f" d="M9.6 8.8l5.6-2.8 5.6 2.8-5.6 2.8z"/><path class="f" d="M20.8 8.8v3.8l-5.6 2.8"/>',
  saltpetre: '<path class="f" d="M7.2 6.2C6 9 4 12 4 16c0 3.4 3.4 5.4 8 5.4s8-2 8-5.4c0-4-2-7-3.2-9.8z"/><path class="l" d="M7.2 6.2h9.6M9 2.8l3 3.4 3-3.4"/><path class="w" d="M12 10.6l2.2 3.4-2.2 3.4-2.2-3.4z"/>',
  sugarloaf: '<path class="w" d="M12 2.6l6.4 17.6H5.6z"/><path class="f" d="M7.4 15.2h9.2l1.8 5H5.6z"/><path class="l" d="M5 20.8h14"/>',
  tobacco: '<path class="f" d="M12 2.4c4.6 3.4 6.6 8 5.4 13-1 4-3.2 6.2-5.4 7.2-2.2-1-4.4-3.2-5.4-7.2-1.2-5 .8-9.6 5.4-13z"/><path class="l" d="M12 4.6v17M12 9l-3.2-2.2M12 9l3.2-2.2M12 13.4l-4-2.6M12 13.4l4-2.6M12 17.6l-3.4-2.2M12 17.6l3.4-2.2"/>',
  silver: '<circle class="f" cx="12" cy="12" r="8.6"/><circle class="l" cx="12" cy="12" r="6.6"/><path class="l" d="M12 6.4v11.2M6.4 12h11.2"/><path class="l" d="M9.6 9.6h1.2M13.2 14.4h1.2"/>',
  gold: '<path class="f" d="M2.8 17.6l3.2-6.4h12l3.2 6.4z"/><path class="w" d="M6 11.2l1.6-3.4h8.8l1.6 3.4z"/><path class="l" d="M2.8 17.6h18.4"/>',
  copperPlates: '<path class="f" d="M3.6 15.4l8.4-4 8.4 4-8.4 4z"/><path class="f" d="M3.6 12l8.4-4 8.4 4-8.4 4z"/><path class="l" d="M3.6 12v3.4M20.4 12v3.4M12 16v3.4"/>',
  tin: '<path class="f" d="M3.6 15.2h16.8v4H3.6z"/><path class="f" d="M5.6 10.6h12.8v4.6H5.6z"/><path class="l" d="M7.6 10.6l1-3h6.8l1 3"/>',
  ivory: '<path class="w" d="M3.6 20.6c9.8.4 15.6-5.6 17-16.6-2.6 6.4-7 9.6-15.6 10.8z"/><path class="l" d="M6.6 15.4c1.4 1.4 1.4 3.4 0 5"/>',
  furs: '<path class="f" d="M12 2.6c2 0 3 1.8 3 3.2l4.2 1-2 4 3 3-4.2 1.2 1 6-5-2-5 2 1-6-4.2-1.2 3-3-2-4L9 5.8c0-1.4 1-3.2 3-3.2z"/><path class="l" d="M12 7.6v9.6"/>',
  cloth: '<path class="f" d="M3.6 6.4h16.8v5H3.6z"/><path class="f" d="M3.6 12.6h16.8v5H3.6z"/><path class="l" d="M3.6 6.4c-1.4 1.2-1.4 3.8 0 5M3.6 12.6c-1.4 1.2-1.4 3.8 0 5M20.4 6.4c1.4 1.2 1.4 3.8 0 5"/><path class="m" d="M8 6.4v11.2"/>',
  cask: '<path class="f" d="M5.6 5.6h12.8c2.2 2.4 2.2 10.4 0 12.8H5.6"/><ellipse class="w" cx="5.6" cy="12" rx="2.6" ry="6.4"/><path class="l" d="M9.4 5.8c1 3 1 9.4 0 12.4M14.6 5.8c1 3 1 9.4 0 12.4"/><circle class="k" cx="12" cy="9" r=".9"/>',
  sheaf: '<path class="l" d="M12 22l0-10M12 22l-4-10M12 22l4-10M12 22l-6.4-8.6M12 22l6.4-8.6"/><rect class="w" x="8.6" y="15.4" width="6.8" height="2.4" rx=".6"/>' + [[12,5.6],[8,6.6],[16,6.6],[5.6,9.6],[18.4,9.6],[10,9.4],[14,9.4]].map(([x, y]) => `<ellipse class="f" cx="${x}" cy="${y}" rx="1.5" ry="3"/>`).join(''),
  logs: '<path class="f" d="M5.4 7.4h14v4.6h-14z"/><ellipse class="w" cx="5.4" cy="9.7" rx="1.8" ry="2.3"/><path class="f" d="M3.4 13.4h14V18h-14z"/><ellipse class="w" cx="3.4" cy="15.7" rx="1.8" ry="2.3"/><path class="l" d="M9 9.7h6M7 15.7h7"/><path class="k" d="M18.8 13.4h2.6v5.4h-2.6z"/>',
  salt: '<path class="w" d="M2.8 19.6c3-8 6-12.4 9.2-12.4s6.2 4.4 9.2 12.4z"/><path class="l" d="M2.8 19.6h18.4"/><path class="l" d="M10 12.6l.8.8M13.6 14.8l.8.8M8.6 16.6l.8.8M15.8 11.4l.8.8"/>',
  cod: '<path class="l" d="M7 1.8v3M17 1.8v3M5 2h14"/><path class="f" d="M7 4.6c2.2 1.6 2.8 4.6 2 8l-1 5 1.6 4.2H4.4L6 17.6l-1-5c-.8-3.4-.2-6.4 2-8z"/><path class="f" d="M17 4.6c2.2 1.6 2.8 4.6 2 8l-1 5 1.6 4.2h-5.2l1.6-4.2-1-5c-.8-3.4-.2-6.4 2-8z"/>',
  ricesack: '<path class="f" d="M6.2 6.6C5 9.4 3.4 12.6 3.4 16c0 3.2 3.4 5.2 8.6 5.2s8.6-2 8.6-5.2c0-3.4-1.6-6.6-2.8-9.4z"/><path class="l" d="M6.2 6.6h11.6M8.6 3l3.4 3.6L15.4 3"/>' + [[9,14],[12,12.6],[15,14],[10.6,17],[13.6,17.2]].map(([x, y]) => `<ellipse class="w" cx="${x}" cy="${y}" rx=".8" ry="1.3" transform="rotate(30 ${x} ${y})"/>`).join(''),
};

// Goods, with the drawing each uses and its colour wash.
/** Age of Sail goods: id, name, class, drawing, wash colour, second colour. */
const SAIL: [string, string, string, string, string, string?][] = [
  ['pepper', 'Pepper', 'general', 'pepper', '#4a3c2e'], ['nutmeg', 'Nutmeg and mace', 'general', 'nutmeg', '#9a6a3c', '#b8402e'],
  ['cloves', 'Cloves', 'general', 'cloves', '#7a4428'], ['cinnamon', 'Cinnamon', 'general', 'cinnamon', '#b8743a'],
  ['tea', 'Tea', 'general', 'tea', '#7d8a46'], ['silk', 'Silk', 'general', 'silk', '#b84a52'],
  ['porcelain', 'Porcelain', 'general', 'porcelain', '#f8f0dc', '#2f5b8a'], ['textiles', 'Indian textiles', 'general', 'textilesIn', '#c8682e'],
  ['indigo', 'Indigo', 'general', 'indigo', '#34508a'], ['saltpetre', 'Saltpetre', 'bulk', 'saltpetre', '#d8ccb0'],
  ['coffee', 'Coffee', 'general', 'coffee', '#6a4428'], ['sugar', 'Sugar', 'bulk', 'sugarloaf', '#3f6a9a'],
  ['tobacco', 'Tobacco', 'general', 'tobacco', '#a07a34'], ['silver', 'Silver', 'general', 'silver', '#c2c6cc'],
  ['gold', 'Gold', 'general', 'gold', '#d9a441'], ['copper', 'Copper', 'bulk', 'copperPlates', '#c07440'],
  ['tin', 'Tin', 'bulk', 'tin', '#a4a9ae'], ['ivory', 'Ivory', 'general', 'ivory', '#f4ead2'],
  ['furs', 'Furs and deerskins', 'general', 'furs', '#8a5c36'], ['cloth', 'Woollen cloth', 'general', 'cloth', '#8a3a30', '#e9d9a8'],
  ['wine', 'Wine and brandy', 'general', 'cask', '#9a6a3a'], ['grain', 'Grain', 'bulk', 'sheaf', '#d6aa4c'],
  ['timber', 'Timber and naval stores', 'bulk', 'logs', '#9a7444'], ['salt', 'Salt', 'bulk', 'salt', '#f1ece2'],
  ['cod', 'Stockfish', 'general', 'cod', '#cbb98a'], ['rice', 'Rice', 'bulk', 'ricesack', '#d8c8a0'],
];
/** Modern fills follow the cargo class. */
const CLS: Record<string, string> = { bulk: '#d9a24c', general: '#4f8fd8', liquid: '#d0625a', reefer: '#7fcbe6' };
const MODERN: [string, string, string, string][] = [
  ['grain', 'Grain', 'bulk', 'grain'], ['coal', 'Coal', 'bulk', 'coal'], ['ironore', 'Iron ore', 'bulk', 'ironore'], ['copper', 'Copper', 'bulk', 'copper'],
  ['fertilizer', 'Fertilizer', 'bulk', 'fertilizer'], ['timber', 'Timber', 'general', 'timber'], ['steel', 'Steel', 'general', 'steel'],
  ['machinery', 'Machinery', 'general', 'machinery'], ['electronics', 'Electronics', 'general', 'electronics'], ['textiles', 'Textiles', 'general', 'textiles'],
  ['coffee', 'Coffee', 'general', 'coffee'], ['cocoa', 'Cocoa', 'general', 'cocoa'], ['wine', 'Wine', 'general', 'wine'], ['cars', 'Cars', 'general', 'cars'],
  ['crude', 'Crude oil', 'liquid', 'crude'], ['fuelproducts', 'Fuel products', 'liquid', 'fuelproducts'], ['chemicals', 'Chemicals', 'liquid', 'chemicals'],
  ['fruit', 'Fruit', 'reefer', 'fruit'], ['meat', 'Meat', 'reefer', 'meat'], ['rice', 'Rice', 'bulk', 'rice'], ['sugar', 'Sugar', 'bulk', 'sugar'],
  ['bauxite', 'Bauxite', 'bulk', 'bauxite'], ['rubber', 'Rubber', 'general', 'rubber'], ['cotton', 'Cotton', 'general', 'cotton'], ['wool', 'Wool', 'general', 'wool'],
  ['tea', 'Tea', 'general', 'tea'], ['palmoil', 'Palm oil', 'liquid', 'palmoil'], ['fish', 'Fish', 'reefer', 'fish'], ['dairy', 'Dairy', 'reefer', 'dairy'],
];

const BY_ERA = {
  sail: new Map(SAIL.map((g) => [g[0], { draw: g[3], c: g[4], c2: g[5] ?? '#7b2d26' }])),
  modern: new Map(MODERN.map((g) => [g[0], { draw: g[3], c: CLS[g[2]], c2: '#dfeaf5' }])),
};

/** Shared SVG defs (the engraving's hatch and rough line), added to the page once. */
function ensureDefs(): void {
  if (typeof document === 'undefined' || document.getElementById('gi-defs')) return;
  const holder = document.createElement('div');
  holder.innerHTML = `<svg id="gi-defs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <pattern id="gi-hatch" width="2.6" height="2.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="2.6" stroke="#2b1d0e" stroke-width="0.55" stroke-opacity="0.38"/></pattern>
    <filter id="gi-rough" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="4" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="0.75"/></filter></defs></svg>`;
  document.body.appendChild(holder.firstElementChild!);
}

const cache = new Map<string, string>();

/** An inline SVG icon for a good in the current era (empty if none is drawn). */
export function goodIcon(goodId: string, size = 36): string {
  const era = getWorld().era.id;
  const key = `${era}:${goodId}:${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  ensureDefs();
  const g = BY_ERA[era].get(goodId);
  let svg = '';
  if (g) {
    let body = D[g.draw];
    // In the engraving every coloured area also gets cross-hatched shade.
    if (era === 'sail') body = body.replace(/<(path|circle|ellipse|rect)( class="f")([^>]*)\/>/g, (m, tag, _c, rest) => `${m}<${tag} class="h"${rest}/>`);
    const name = getWorld().goods[goodId]?.name ?? goodId;
    svg = `<svg class="gi gi-${era}" viewBox="0 0 24 24" width="${size}" height="${size}" style="--c:${g.c};--c2:${g.c2}" role="img" aria-label="${name}"><g${era === 'sail' ? ' filter="url(#gi-rough)"' : ''}>${body}</g></svg>`;
  }
  cache.set(key, svg);
  return svg;
}

/** Colours of the cargo-class marks. */
export const CLASS_LABEL: Record<string, string> = { bulk: 'Bulk', general: 'General cargo', liquid: 'Liquid (tanker)', reefer: 'Refrigerated' };
