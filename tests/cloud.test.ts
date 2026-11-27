import { describe, expect, it } from 'vitest';
import { applyCheck, changedSinceSync, checkCloud, CloudError, CLOUD_DESCRIPTION, CLOUD_FILE, type CloudConfig, pack, unpack } from '../src/cloud';
import { advance, newGame } from '../src/sim/game';
import { activeSlot, createSlot, deleteSlot, listSlots, loadSlot, saveGame, setActiveSlot } from '../src/sim/save';

/** A Storage kept in memory: one per "device". */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

/** A tiny stand-in for the GitHub gists API, shared by the devices. */
function fakeGitHub(token = 'tok') {
  const gists = new Map<string, { id: string; description: string; files: Record<string, { content: string }> }>();
  let n = 0;
  const calls: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (auth !== `Bearer ${token}`) return json({ message: 'Bad credentials' }, 401);
    if (url.pathname === '/gists' && method === 'GET') return json([...gists.values()]);
    if (url.pathname === '/gists' && method === 'POST') {
      const body = JSON.parse(String(init!.body));
      const id = `g${++n}`;
      gists.set(id, { id, description: body.description, files: body.files });
      return json(gists.get(id), 201);
    }
    const m = /^\/gists\/(\w+)$/.exec(url.pathname);
    if (m && gists.has(m[1])) {
      const g = gists.get(m[1])!;
      if (method === 'PATCH') {
        const body = JSON.parse(String(init!.body));
        g.files = { ...g.files, ...body.files };
      }
      return json(g);
    }
    return json({ message: 'Not Found' }, 404);
  }) as typeof fetch;
  return { f, gists, calls };
}

const cfgFor = (device: string): CloudConfig => ({ token: 'tok', device, synced: {} });

/** Open a device's only (or named) game and play some days on it, as the app would. */
function play(storage: Storage, days: number, name?: string): void {
  const slot = name ? listSlots(storage).find((x) => x.name === name)! : listSlots(storage)[0];
  setActiveSlot(slot.id, storage);
  saveGame(advance(loadSlot(slot.id, storage)!, days), storage);
}

async function sync(cfg: CloudConfig, storage: Storage, f: typeof fetch, choices: Record<string, 'cloud' | 'device'> = {}) {
  const check = await checkCloud(cfg, storage, f);
  const res = await applyCheck(check, choices, storage, f);
  return { check, ...res };
}

describe('cloud saves (GitHub gist)', () => {
  it('packs a saved game small and unpacks it unchanged', async () => {
    const json = JSON.stringify(advance(newGame(1), 100));
    const packed = await pack(json);
    expect(packed.length).toBeLessThan(json.length / 2);
    expect(await unpack(packed)).toBe(json);
  });

  it('an unchanged save keeps its "last changed" time', () => {
    const s = memoryStorage();
    const g = newGame(1);
    createSlot(g, 'Test', s);
    const t0 = listSlots(s)[0].lastPlayed;
    const later = Date.now() + 5000;
    const realNow = Date.now;
    Date.now = () => later;
    try {
      saveGame(g, s);
      expect(listSlots(s)[0].lastPlayed).toBe(t0);
      saveGame(advance(g, 3), s);
      expect(listSlots(s)[0].lastPlayed).toBe(later);
    } finally { Date.now = realNow; }
  });

  it('a game started on one device appears on the other', async () => {
    const gh = fakeGitHub();
    const a = memoryStorage(), b = memoryStorage();
    createSlot(newGame(2), 'Huis van Os', a);
    const first = await sync(cfgFor('Mac'), a, gh.f);
    expect(gh.gists.size).toBe(1);
    const gist = [...gh.gists.values()][0];
    expect(gist.description).toBe(CLOUD_DESCRIPTION);
    expect(JSON.parse(gist.files[CLOUD_FILE].content).games).toHaveLength(1);
    // The phone finds the same gist by itself and pulls the game.
    const second = await sync(cfgFor('iPhone'), b, gh.f);
    expect(second.cfg.gistId).toBe(first.cfg.gistId);
    expect(second.replaced).toHaveLength(1);
    const slotB = listSlots(b)[0];
    expect(slotB.name).toBe('Huis van Os');
    expect(slotB.uid).toBe(listSlots(a)[0].uid);
    expect(loadSlot(slotB.id, b)?.day).toBe(0);
  });

  it('the newer save wins when only one device played', async () => {
    const gh = fakeGitHub();
    const a = memoryStorage(), b = memoryStorage();
    createSlot(newGame(3), 'Lines', a);
    let ca = (await sync(cfgFor('Mac'), a, gh.f)).cfg;
    let cb = (await sync(cfgFor('iPhone'), b, gh.f)).cfg;
    // Play on the phone and sync.
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    try {
      play(b, 20);
    } finally { Date.now = realNow; }
    expect(changedSinceSync(cb, b)).toBe(true);
    const pushed = await sync(cb, b, gh.f);
    expect(pushed.check.decision.push).toHaveLength(1);
    cb = pushed.cfg;
    // Back on the Mac: the cloud is newer and the Mac didn't play: pull, no question.
    const pulled = await sync(ca, a, gh.f);
    expect(pulled.check.decision.pull).toHaveLength(1);
    expect(pulled.check.decision.conflicts).toHaveLength(0);
    ca = pulled.cfg;
    expect(listSlots(a)).toHaveLength(1);
    expect(loadSlot(listSlots(a)[0].id, a)!.day).toBe(20);
    expect(changedSinceSync(ca, a)).toBe(false);
  });

  it('played on both devices: the player chooses, and the other copy is replaced', async () => {
    const gh = fakeGitHub();
    const a = memoryStorage(), b = memoryStorage();
    createSlot(newGame(4), 'Both', a);
    const ca = (await sync(cfgFor('Mac'), a, gh.f)).cfg;
    const cb = (await sync(cfgFor('iPhone'), b, gh.f)).cfg;
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    play(a, 10);
    Date.now = () => realNow() + 120_000;
    play(b, 30);
    Date.now = realNow;
    await sync(cb, b, gh.f); // the phone pushes its 30 days
    const check = await checkCloud(ca, a, gh.f);
    expect(check.decision.conflicts).toHaveLength(1);
    const c = check.decision.conflicts[0];
    // Unanswered: nothing is overwritten either way.
    await applyCheck(check, {}, a, gh.f);
    expect(loadSlot(listSlots(a)[0].id, a)!.day).toBe(10);
    // Keep the Mac's: the cloud gets 10 days.
    const again = await checkCloud(ca, a, gh.f);
    const res = await applyCheck(again, { [c.uid]: 'device' }, a, gh.f);
    const cloudGame = JSON.parse([...gh.gists.values()][0].files[CLOUD_FILE].content).games[0];
    expect(JSON.parse(await unpack(cloudGame.data)).day).toBe(10);
    expect(cloudGame.savedBy).toBe('Mac');
    expect(res.cfg.synced[c.uid]).toBe(listSlots(a)[0].lastPlayed);
  });

  it('a game deleted on one device goes from the other too', async () => {
    const gh = fakeGitHub();
    const a = memoryStorage(), b = memoryStorage();
    createSlot(newGame(5), 'Keep', a);
    createSlot(newGame(6), 'Drop', a);
    const ca = (await sync(cfgFor('Mac'), a, gh.f)).cfg;
    const cb = (await sync(cfgFor('iPhone'), b, gh.f)).cfg;
    expect(listSlots(b)).toHaveLength(2);
    deleteSlot(listSlots(a).find((x) => x.name === 'Drop')!.id, a);
    const afterDelete = await sync(ca, a, gh.f);
    expect(changedSinceSync(afterDelete.cfg, a)).toBe(false);
    const res = await sync(cb, b, gh.f);
    expect(res.removed).toHaveLength(1);
    expect(listSlots(b).map((x) => x.name)).toEqual(['Keep']);
    // And it doesn't come back on the next sync of either device.
    await sync(res.cfg, b, gh.f);
    expect((await sync(afterDelete.cfg, a, gh.f)).check.decision.pull).toHaveLength(0);
  });

  it('games from two devices merge; slot ids that clash locally are fine', async () => {
    const gh = fakeGitHub();
    const a = memoryStorage(), b = memoryStorage();
    createSlot(newGame(7), 'Mac game', a); // s1 on the Mac
    createSlot(newGame(8), 'Phone game', b); // s1 on the phone too
    const ca = (await sync(cfgFor('Mac'), a, gh.f)).cfg;
    await sync(cfgFor('iPhone'), b, gh.f);
    await sync(ca, a, gh.f);
    expect(listSlots(a).map((x) => x.name).sort()).toEqual(['Mac game', 'Phone game']);
    expect(listSlots(b).map((x) => x.name).sort()).toEqual(['Mac game', 'Phone game']);
    expect(activeSlot(b)).toBeTruthy();
  });

  it('a bad token gives a clear error', async () => {
    const gh = fakeGitHub('right');
    await expect(checkCloud({ token: 'wrong', device: 'Mac', synced: {} }, memoryStorage(), gh.f)).rejects.toThrow(CloudError);
    await expect(checkCloud({ token: 'wrong', device: 'Mac', synced: {} }, memoryStorage(), gh.f)).rejects.toThrow(/token/);
  });
});
