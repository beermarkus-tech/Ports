let START = Date.UTC(2000, 0, 1);
let CUR = '$';
let YEAR = 2000;

/** Set the calendar and money sign for the era being played. */
export function setEraFormat(startYear: number, currency: string): void {
  START = Date.UTC(startYear, 0, 1);
  YEAR = startYear;
  CUR = currency;
}

export function startYear(): number { return YEAR; }
export function currency(): string { return CUR; }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function money(n: number, signed = false): string {
  const s = `${CUR}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
  if (n < 0) return `−${s}`;
  return signed ? `+${s}` : s;
}

export function compactMoney(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}${CUR}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${sign}${CUR}${Math.round(a / 1e3)}k`;
  return money(n);
}

export function gameDate(day: number): string {
  const d = new Date(START + Math.floor(day) * 86_400_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function days(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r} ${r === 1 ? 'day' : 'days'}`;
}

export function tons(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} t`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
