// Cloud saves: every saved game, gzip-compressed, in one secret GitHub gist that
// all the player's devices read and write. Each device keeps a token (gist scope
// only) and remembers, per game, the "last changed" time on which it and the cloud
// last agreed. From that, each sync decides per game: pull it (the cloud is newer
// and this device didn't change it), push it (this device is newer), or ask the
// player (both changed it since the last sync). Deletions travel as tombstones.

import {
  deletedGames, exportSlots, importSlot, markDeleted, removeSlotByUid, type SlotInfo, type Tombstone,
} from './sim/save';

const KEY = 'deadweight.cloud';
export const CLOUD_FILE = 'deadweight-saves.json';
export const CLOUD_DESCRIPTION = 'Here Be Dragons saved games (synced by the game)';
/** The description of the gist before the game was renamed (still found). */
const OLD_DESCRIPTIONS = ['Deadweight saved games (synced by the game)'];
const API = 'https://api.github.com';

type Store = Storage | undefined;
type Fetch = typeof fetch;
export type SyncedSlot = SlotInfo & { uid: string };

export interface CloudConfig {
  token: string;
  gistId?: string;
  /** Shown to the other devices ("saved on …"). */
  device: string;
  /** Per game (uid): its "last changed" time when this device and the cloud last agreed. */
  synced: Record<string, number>;
  lastSync?: number;
  lastError?: string;
}

export interface CloudGame {
  info: SyncedSlot;
  /** The saved game: JSON, gzip-compressed, base64. */
  data: string;
  savedBy: string;
  savedAt: number;
}

export interface CloudBundle {
  app: 'deadweight';
  format: 1;
  updatedAt: number;
  device: string;
  games: CloudGame[];
  deleted: Tombstone[];
}

export class CloudError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

// ---------------------------------------------------------------- settings on this device

export function loadConfig(storage: Store = globalThis.localStorage): CloudConfig | null {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as CloudConfig) : null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: CloudConfig, storage: Store = globalThis.localStorage): void {
  try { storage?.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

/** Stop syncing on this device (the gist stays where it is). */
export function clearConfig(storage: Store = globalThis.localStorage): void {
  try { storage?.removeItem(KEY); } catch { /* ignore */ }
}

/** A name for this device from its browser, e.g. "iPhone", "Mac", "Android phone". */
export function defaultDeviceName(ua = globalThis.navigator?.userAgent ?? ''): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && (globalThis.navigator?.maxTouchPoints ?? 0) > 1)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Linux/.test(ua)) return 'Linux PC';
  return 'This device';
}

// ---------------------------------------------------------------- compression

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A saved game's JSON as gzip + base64 (about a fifth of the size). */
export async function pack(json: string): Promise<string> {
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  return toBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
}

export async function unpack(data: string): Promise<string> {
  const stream = new Blob([fromBase64(data) as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

// ---------------------------------------------------------------- GitHub

async function gh<T>(cfg: CloudConfig, path: string, init: RequestInit = {}, f: Fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await f(`${API}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${cfg.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new CloudError('No connection to GitHub.');
  }
  if (!res.ok) {
    const msg = res.status === 401 ? 'GitHub refused the token (wrong or expired).'
      : res.status === 403 || res.status === 404 ? 'The token may not access gists: it needs the "gist" permission.'
        : `GitHub answered ${res.status}.`;
    throw new CloudError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

interface GistFile { content?: string; truncated?: boolean; raw_url?: string }
interface Gist { id: string; description: string | null; files: Record<string, GistFile> }

/** The player's saves gist: found by its description, or created (secret) on first use. */
export async function findOrCreateGist(cfg: CloudConfig, f: Fetch = fetch): Promise<string> {
  if (cfg.gistId) return cfg.gistId;
  for (let page = 1; page <= 5; page++) {
    const list = await gh<Gist[]>(cfg, `/gists?per_page=100&page=${page}`, {}, f);
    const found = list.find((g) => (g.description === CLOUD_DESCRIPTION || OLD_DESCRIPTIONS.includes(g.description ?? '')) && g.files[CLOUD_FILE]);
    if (found) return found.id;
    if (list.length < 100) break;
  }
  const empty: CloudBundle = { app: 'deadweight', format: 1, updatedAt: Date.now(), device: cfg.device, games: [], deleted: [] };
  const created = await gh<Gist>(cfg, '/gists', {
    method: 'POST',
    body: JSON.stringify({ description: CLOUD_DESCRIPTION, public: false, files: { [CLOUD_FILE]: { content: JSON.stringify(empty) } } }),
  }, f);
  return created.id;
}

export async function readBundle(cfg: CloudConfig, f: Fetch = fetch): Promise<CloudBundle | null> {
  const gist = await gh<Gist>(cfg, `/gists/${cfg.gistId}`, {}, f);
  const file = gist.files[CLOUD_FILE];
  if (!file) return null;
  let text = file.content ?? '';
  if (file.truncated && file.raw_url) {
    // The API cuts files over about 1 MB short: fetch the whole file.
    const res = await f(file.raw_url);
    if (!res.ok) throw new CloudError(`GitHub answered ${res.status}.`, res.status);
    text = await res.text();
  }
  try {
    const b = JSON.parse(text) as CloudBundle;
    return b && b.app === 'deadweight' && Array.isArray(b.games) ? { ...b, deleted: b.deleted ?? [] } : null;
  } catch {
    return null;
  }
}

export async function writeBundle(cfg: CloudConfig, bundle: CloudBundle, f: Fetch = fetch): Promise<void> {
  await gh(cfg, `/gists/${cfg.gistId}`, { method: 'PATCH', body: JSON.stringify({ files: { [CLOUD_FILE]: { content: JSON.stringify(bundle) } } }) }, f);
}

// ---------------------------------------------------------------- deciding

export interface Conflict {
  uid: string;
  local: SyncedSlot;
  cloud: CloudGame;
}

export interface Decision {
  /** The cloud is newer and this device didn't change the game since the last sync (or doesn't have it). */
  pull: CloudGame[];
  /** This device is newer, or the cloud doesn't have the game. */
  push: string[];
  /** Changed on this device and in the cloud since the last sync: the player chooses. */
  conflicts: Conflict[];
  /** Deleted on another device. */
  removeLocal: Tombstone[];
}

/** Compare this device's games with the cloud's, game by game. */
export function decide(local: SyncedSlot[], localDeleted: Tombstone[], bundle: CloudBundle | null, synced: Record<string, number>): Decision {
  const d: Decision = { pull: [], push: [], conflicts: [], removeLocal: [] };
  const cloud = new Map((bundle?.games ?? []).map((g) => [g.info.uid, g]));
  const cloudDeleted = new Map((bundle?.deleted ?? []).map((t) => [t.uid, t]));
  const mine = new Map(local.map((x) => [x.uid, x]));
  const myDeleted = new Map(localDeleted.map((t) => [t.uid, t]));
  for (const [uid, l] of mine) {
    const c = cloud.get(uid);
    if (!c) {
      const tomb = cloudDeleted.get(uid);
      // Deleted elsewhere, and not played here since: delete it here too.
      if (tomb && l.lastPlayed <= tomb.at) d.removeLocal.push(tomb);
      else d.push.push(uid);
      continue;
    }
    const L = l.lastPlayed, R = c.info.lastPlayed;
    if (L === R) continue;
    const S = synced[uid] ?? Math.min(L, R);
    const changedHere = L > S, changedThere = R > S;
    if (changedHere && changedThere) d.conflicts.push({ uid, local: l, cloud: c });
    else if (R > L) d.pull.push(c);
    else d.push.push(uid);
  }
  for (const [uid, c] of cloud) {
    if (mine.has(uid)) continue;
    const tomb = myDeleted.get(uid);
    // Deleted here: keep it deleted unless another device played it after that.
    if (tomb && c.info.lastPlayed <= tomb.at) continue;
    d.pull.push(c);
  }
  return d;
}

export function hasWork(d: Decision): boolean {
  return d.pull.length + d.push.length + d.conflicts.length + d.removeLocal.length > 0;
}

// ---------------------------------------------------------------- syncing

export interface Check {
  cfg: CloudConfig;
  bundle: CloudBundle | null;
  decision: Decision;
}

/** Fetch the cloud's games and decide what to do (nothing is changed yet). */
export async function checkCloud(cfg: CloudConfig, storage: Store = globalThis.localStorage, f: Fetch = fetch): Promise<Check> {
  const gistId = await findOrCreateGist(cfg, f);
  if (gistId !== cfg.gistId) { cfg = { ...cfg, gistId }; saveConfig(cfg, storage); }
  const bundle = await readBundle(cfg, f);
  const local = exportSlots(storage).map((x) => x.info);
  return { cfg, bundle, decision: decide(local, deletedGames(storage), bundle, cfg.synced) };
}

/**
 * Carry out a check: pull, delete and push as decided, with the player's choice for
 * each conflict ('cloud' or 'device'; conflicts left out stay as they are for now).
 * Returns the uids of games whose copy on this device was replaced or removed.
 */
export async function applyCheck(check: Check, choices: Record<string, 'cloud' | 'device'> = {}, storage: Store = globalThis.localStorage, f: Fetch = fetch): Promise<{ replaced: string[]; removed: string[]; cfg: CloudConfig }> {
  const { bundle, decision } = check;
  const cfg: CloudConfig = { ...check.cfg, synced: { ...check.cfg.synced } };
  const replaced: string[] = [], removed: string[] = [];
  const unresolved = new Set(decision.conflicts.filter((c) => !choices[c.uid]).map((c) => c.uid));
  const takeCloud = [...decision.pull, ...decision.conflicts.filter((c) => choices[c.uid] === 'cloud').map((c) => c.cloud)];
  for (const g of takeCloud) {
    importSlot(g.info, await unpack(g.data), storage);
    cfg.synced[g.info.uid] = g.info.lastPlayed;
    replaced.push(g.info.uid);
  }
  for (const t of decision.removeLocal) {
    removeSlotByUid(t.uid, storage);
    markDeleted(t.uid, t.at, storage);
    delete cfg.synced[t.uid];
    removed.push(t.uid);
  }
  // The cloud gets every game as it now stands here, except unresolved conflicts (the cloud's copy stays).
  const needsWrite = !bundle || decision.push.length > 0 || decision.conflicts.some((c) => choices[c.uid] === 'device')
    || deletedGames(storage).some((t) => !(bundle.deleted ?? []).some((b) => b.uid === t.uid));
  if (needsWrite) {
    const cloudByUid = new Map((bundle?.games ?? []).map((g) => [g.info.uid, g]));
    const games: CloudGame[] = [];
    const now = Date.now();
    for (const { info, json } of exportSlots(storage)) {
      const c = cloudByUid.get(info.uid);
      if (unresolved.has(info.uid) && c) { games.push(c); continue; }
      if (c && c.info.lastPlayed === info.lastPlayed) { games.push({ ...c, info }); continue; }
      games.push({ info, data: await pack(json), savedBy: cfg.device, savedAt: now });
    }
    const present = new Set(games.map((g) => g.info.uid));
    const tombs = new Map<string, Tombstone>();
    for (const t of [...(bundle?.deleted ?? []), ...deletedGames(storage)]) {
      if (present.has(t.uid)) continue;
      const prev = tombs.get(t.uid);
      if (!prev || t.at > prev.at) tombs.set(t.uid, t);
    }
    await writeBundle(cfg, { app: 'deadweight', format: 1, updatedAt: now, device: cfg.device, games, deleted: [...tombs.values()].slice(-200) }, f);
    for (const g of games) if (!unresolved.has(g.info.uid)) cfg.synced[g.info.uid] = g.info.lastPlayed;
  }
  // Games no longer here (deleted) need no sync record any more.
  const here = new Set(exportSlots(storage).map((x) => x.info.uid));
  for (const uid of Object.keys(cfg.synced)) if (!here.has(uid)) delete cfg.synced[uid];
  cfg.lastSync = Date.now();
  delete cfg.lastError;
  saveConfig(cfg, storage);
  return { replaced, removed, cfg };
}

/** Whether this device changed any game since it last agreed with the cloud. */
export function changedSinceSync(cfg: CloudConfig, storage: Store = globalThis.localStorage): boolean {
  return exportSlots(storage).some(({ info }) => cfg.synced[info.uid] !== info.lastPlayed)
    || deletedGames(storage).some((t) => cfg.synced[t.uid] !== undefined);
}
