import { OgiExport, dayKey } from '../app/core/merge';

// Fechas en hora local, como hace OGI al calcular la clave del día.
export const at = (d: number, h = 12) => new Date(2026, 9, d, h, 0, 0);
export const iso = (d: number, h?: number) => at(d, h).toISOString();
export const secs = (d: number, h?: number) => String(Math.floor(at(d, h).getTime() / 1000));

export function sampleExport(overrides: Record<string, unknown> = {}): OgiExport {
  return {
    playerId: 101348,
    universeUrl: 'https://s275-es.ogame.gameforge.com',
    lastEmpireUpdate: iso(21, 10),
    options: { a: 1 },
    expeditions: {
      100: { result: 'Metal', amount: [1000, 0, 0, 0], size: 'normal', date: iso(21, 9) },
      101: { result: 'AM', amount: [0, 0, 0, 500], size: 'normal', date: iso(21, 10) },
      102: { result: 'Void', date: iso(21, 11) },
      103: { result: 'Fleet', amount: [10, 20, 0], size: 'normal', date: iso(21, 11) },
    },
    combats: {
      200: {
        timestamp: secs(21, 8),
        hashcode: 'h1',
        coordinates: { position: 7 },
        win: true,
        draw: false,
        isProbes: false,
        loot: [100, 50, 10, 0],
        losses: { 202: 1 },
      },
      201: {
        timestamp: secs(21, 8),
        hashcode: 'h1',
        coordinates: { position: 7 },
        win: true,
        draw: false,
        isProbes: false,
        loot: [100, 50, 10, 0],
        losses: {},
      },
      202: {
        timestamp: secs(21, 9),
        hashcode: 'h2',
        coordinates: { position: 8 },
        win: true,
        draw: false,
        isProbes: true,
        loot: [0, 0, 0, 0],
        losses: {},
      },
      203: {
        timestamp: secs(21, 9),
        coordinates: { position: 16 },
        win: true,
        draw: false,
        isProbes: false,
        loot: [0, 0, 0],
        losses: { 210: 3 },
      },
    },
    harvests: {
      300: {
        date: iso(21, 9),
        metal: 5,
        crystal: 6,
        deuterium: 0,
        coords: '1:2:16',
        combat: false,
      },
      301: { date: iso(21, 9), metal: 1, crystal: 2, deuterium: 3, coords: '1:2:7', combat: true },
    },
    discoveries: {
      400: { result: 'artefacts', size: 'normal', amount: 12, date: iso(21, 9), favorited: false },
      401: { result: 'lifeform2', size: 'normal', amount: 40, date: iso(21, 9), favorited: false },
    },
    expeditionSums: {
      [dayKey(at(21))]: {
        found: [1000, 0, 0, 500],
        harvest: [5, 6, 0],
        losses: { 210: 3 },
        fleet: { 202: 4 },
        type: { Metal: 1, AM: 1, Void: 1, Fleet: 1 },
        adjust: [0, 0, 0],
        fuel: -77,
      },
    },
    combatsSums: {
      [dayKey(at(21))]: {
        loot: [100, 50, 10],
        harvest: [1, 2, 3],
        losses: { 202: 1 },
        fuel: -5,
        adjust: [0, 0, 0],
        topCombats: [{ debris: 0, loot: 160, ennemi: 'x', losses: 0 }],
        count: 1,
        wins: 1,
        draws: 0,
      },
    },
    discoveriesSums: {
      [dayKey(at(21))]: {
        found: [0, 40, 0, 0],
        artefacts: 12,
        type: { artefacts: 1, lifeform2: 1 },
      },
    },
    ...overrides,
  };
}
