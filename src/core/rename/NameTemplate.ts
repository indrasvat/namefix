import path from 'node:path';

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

export function formatTimestamp(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

export function sanitizePrefix(prefix: string): string {
  return prefix.trim().replace(/\s+/g, '_');
}

export function buildName(prefix: string, d: Date, ext: string): string {
  const p = sanitizePrefix(prefix || 'Screenshot');
  const ts = formatTimestamp(d);
  const e = ext.startsWith('.') ? ext : `.${ext}`;
  return `${p}_${ts}${e.toLowerCase()}`;
}

export function getExt(p: string): string {
  return path.extname(p) || '';
}

