import { describe, expect, it } from 'vitest';
import { advance, newGame } from '../src/sim/game';
import { activeSlot, createSlot, deleteSlot, listSlots, loadGame, loadSlot, renameSlot, saveGame, setActiveSlot } from '../src/sim/save';

/** A Storage in memory. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

describe('save slots', () => {
  it('moves a save from before slots into the first slot', () => {
    const st = memoryStorage();
    const g = advance(newGame(3), 12);
    st.setItem('deadweight.save.v1', JSON.stringify(g));
    const slots = listSlots(st);
    expect(slots).toHaveLength(1);
    expect(slots[0].era).toBe('modern');
    expect(slots[0].day).toBeCloseTo(g.day);
    expect(st.getItem('deadweight.save.v1')).toBeNull();
    expect(loadGame(st)!.day).toBeCloseTo(g.day);
  });

  it('keeps two games side by side, each with its own clock', () => {
    const st = memoryStorage();
    let a = newGame(1);
    a.company = 'Tilly & Co.';
    const idA = createSlot(a, 'Tilly & Co.', st);
    let b = newGame(2);
    const idB = createSlot(b, 'Second House', st);
    expect(activeSlot(st)).toBe(idB);
    b = advance(b, 40);
    saveGame(b, st);
    setActiveSlot(idA, st);
    a = advance(loadGame(st)!, 5);
    saveGame(a, st);
    expect(loadSlot(idA, st)!.day).toBeCloseTo(5);
    expect(loadSlot(idB, st)!.day).toBeCloseTo(40);
    const slots = listSlots(st);
    expect(slots.map((x) => x.id).sort()).toEqual([idA, idB].sort());
    expect(slots.find((x) => x.id === idB)!.day).toBeCloseTo(40);
  });

  it('renames and deletes games', () => {
    const st = memoryStorage();
    const idA = createSlot(newGame(1), 'A', st);
    const idB = createSlot(newGame(2), 'B', st);
    renameSlot(idA, 'Renamed', st);
    expect(listSlots(st).find((x) => x.id === idA)!.name).toBe('Renamed');
    deleteSlot(idB, st);
    expect(listSlots(st).map((x) => x.id)).toEqual([idA]);
    expect(loadSlot(idB, st)).toBeNull();
    expect(activeSlot(st)).toBeNull();
    // With no active slot, loading falls back to the most recent game.
    expect(loadGame(st)).not.toBeNull();
    expect(activeSlot(st)).toBe(idA);
  });

  it('saving with no slot yet creates one', () => {
    const st = memoryStorage();
    saveGame(newGame(4), st);
    expect(listSlots(st)).toHaveLength(1);
    expect(activeSlot(st)).not.toBeNull();
  });
});
