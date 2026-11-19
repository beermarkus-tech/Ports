import { describe, expect, it } from 'vitest';
import {
  PORT_LAYOUT, berthStatus, bumpDamage, handling, harbourFor, newBody, scoreDocking, step, touchesLand, type Controls,
} from '../src/sim/docking';

const ahead: Controls = { throttle: 3, rudder: 0, push: 0 };

describe('docking: harbours', () => {
  it('every port has a harbour where the ship starts in open water', () => {
    for (const port of Object.keys(PORT_LAYOUT)) {
      for (const length of [80, 260]) {
        const h = harbourFor(port, length);
        const b = newBody(h, length);
        expect(touchesLand(b, h), `${port} ${length} m`).toBe(false);
      }
    }
  });

  it('the berth is a quay edge with water beside it', () => {
    for (const port of Object.keys(PORT_LAYOUT)) {
      const h = harbourFor(port, 120);
      const b = newBody(h, 120);
      // Lay the ship alongside the middle of the berth, on the water side, and check it fits.
      const [ax, ay] = h.berth.a, [bx, by] = h.berth.b;
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len, uy = (by - ay) / len;
      const mid = [(ax + bx) / 2, (ay + by) / 2];
      let fits = false;
      for (const side of [1, -1]) {
        b.x = mid[0] - uy * side * (b.beam / 2 + 3);
        b.y = mid[1] + ux * side * (b.beam / 2 + 3);
        b.heading = Math.atan2(uy, ux);
        b.u = 0; b.v = 0; b.r = 0;
        if (!touchesLand(b, h)) { fits = true; break; }
      }
      expect(fits, port).toBe(true);
      expect(berthStatus(b, h).moored, port).toBe(true);
      expect(len).toBeGreaterThan(120);
    }
  });
});

describe('docking: handling', () => {
  it('big ships pick up speed and turn more slowly than small ones', () => {
    const h = harbourFor('genoa', 80, 0);
    const small = newBody(h, 80), big = newBody(h, 260);
    small.u = big.u = 0;
    for (let t = 0; t < 20; t++) { step(small, ahead, h, 1); step(big, ahead, h, 1); }
    expect(small.u).toBeGreaterThan(big.u);
    expect(handling(260).turn).toBeLessThan(handling(80).turn);
  });

  it('the rudder turns the ship only when water flows past it', () => {
    const h = harbourFor('genoa', 80, 0);
    const b = newBody(h, 80);
    b.u = 0;
    const h0 = b.heading;
    for (let t = 0; t < 10; t++) step(b, { throttle: 0, rudder: 1, push: 0 }, h, 1);
    expect(Math.abs(b.heading - h0)).toBeLessThan(0.01);
    b.u = 3;
    for (let t = 0; t < 10; t++) step(b, { throttle: 2, rudder: 1, push: 0 }, h, 1);
    expect(b.heading - h0).toBeGreaterThan(0.2);
  });

  it('steaming straight on in the breakwater harbour ends at the quay', () => {
    const h = harbourFor('genoa', 120, 0);
    const b = newBody(h, 120);
    let hit = false;
    for (let t = 0; t < 2000 && !hit; t++) { step(b, ahead, h, 0.5); hit = touchesLand(b, h); }
    expect(hit).toBe(true);
  });

  it('gentle contact is free; hard knocks cost condition', () => {
    expect(bumpDamage(0.2)).toBe(0);
    expect(bumpDamage(1)).toBeGreaterThan(0);
    expect(bumpDamage(5)).toBeLessThanOrEqual(12);
  });

  it('scores a clean, quick, straight docking as perfect', () => {
    expect(scoreDocking(2, 60, 0, 0, 90).perfect).toBe(true);
    expect(scoreDocking(2, 60, 1, 3, 90).perfect).toBe(false);
    expect(scoreDocking(9, 400, 0, 0, 90).score).toBeLessThan(85);
  });
});

describe('docking: pilot or by hand', () => {
  it('a ship you command arrives with the option to dock it yourself; refund once, damage applies', async () => {
    const { advance, dockByHand, harbourServices, newGame, sail, ActionError } = await import('../src/sim/game');
    let g = newGame(5);
    g = { ...g, fleet: [{ ...g.fleet[0], fuel: 200 }] };
    g = sail(g, g.fleet[0].id, 'genoa');
    for (let d = 0; d < 40 && g.fleet[0].voyage; d++) g = advance(g, 1);
    const s = g.fleet[0];
    expect(s.location).toBe('genoa');
    expect(s.docking?.services).toBe(harbourServices(g, s, 'genoa'));
    const cash = g.cash, cond = s.condition;
    const h = dockByHand(g, s.id, { perfect: false, damage: 3, score: 70 });
    expect(h.cash - cash).toBe(s.docking!.services);
    expect(h.fleet[0].condition).toBe(cond - 3);
    expect(() => dockByHand(h, s.id, { perfect: true, damage: 0, score: 99 })).toThrow(ActionError);
    const p = dockByHand(g, s.id, { perfect: true, damage: 0, score: 95 });
    expect(p.cash - cash).toBe(s.docking!.services + s.docking!.portFee);
  });

  it('a ship with a captain always takes the pilot', async () => {
    const { advance, assignCaptain, hireCaptain, newGame } = await import('../src/sim/game');
    let g = newGame(5);
    g = hireCaptain({ ...g, cash: 5_000_000 }, g.captainPool![0].id);
    g = assignCaptain(g, g.captains![0].id, g.fleet[0].id, ['europe'], 50);
    for (let d = 0; d < 60; d++) { g = advance(g, 1); g = { ...g, reports: [] }; }
    expect(g.fleet[0].docking).toBeUndefined();
  });
});
