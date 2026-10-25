import test from "node:test";
import assert from "node:assert/strict";
import "../js/merge.js";

const {
  buildMergedExport,
  combineDaySum,
  computeFinalSums,
  dayKey,
  deriveSums,
  exportFileName,
  isBetterSum,
  keepForOgi,
  parseExport,
  sortDayKeys,
} = globalThis.OGIMerge;

// Fechas en hora local, como hace OGI al calcular la clave del día.
const at = (d, h = 12) => new Date(2026, 9, d, h, 0, 0);
const iso = (d, h) => at(d, h).toISOString();
const secs = (d, h) => String(Math.floor(at(d, h).getTime() / 1000));

function sampleExport(overrides = {}) {
  return {
    playerId: 101348,
    universeUrl: "https://s275-es.ogame.gameforge.com",
    lastEmpireUpdate: iso(21, 10),
    options: { a: 1 },
    expeditions: {
      100: { result: "Metal", amount: [1000, 0, 0, 0], size: "normal", date: iso(21, 9) },
      101: { result: "AM", amount: [0, 0, 0, 500], size: "normal", date: iso(21, 10) },
      102: { result: "Void", date: iso(21, 11) },
      103: { result: "Fleet", amount: [10, 20, 0], size: "normal", date: iso(21, 11) },
    },
    combats: {
      200: {
        timestamp: secs(21, 8),
        hashcode: "h1",
        coordinates: { position: 7 },
        win: true,
        draw: false,
        isProbes: false,
        loot: [100, 50, 10, 0],
        losses: { 202: 1 },
      },
      201: {
        timestamp: secs(21, 8),
        hashcode: "h1",
        coordinates: { position: 7 },
        win: true,
        draw: false,
        isProbes: false,
        loot: [100, 50, 10, 0],
        losses: {},
      },
      202: {
        timestamp: secs(21, 9),
        hashcode: "h2",
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
      300: { date: iso(21, 9), metal: 5, crystal: 6, deuterium: 0, coords: "1:2:16", combat: false },
      301: { date: iso(21, 9), metal: 1, crystal: 2, deuterium: 3, coords: "1:2:7", combat: true },
    },
    discoveries: {
      400: { result: "artefacts", size: "normal", amount: 12, date: iso(21, 9), favorited: false },
      401: { result: "lifeform2", size: "normal", amount: 40, date: iso(21, 9), favorited: false },
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
        topCombats: [{ debris: 0, loot: 160, ennemi: "x", losses: 0 }],
        count: 1,
        wins: 1,
        draws: 0,
      },
    },
    discoveriesSums: {
      [dayKey(at(21))]: { found: [0, 40, 0, 0], artefacts: 12, type: { artefacts: 1, lifeform2: 1 } },
    },
    ...overrides,
  };
}

test("parseExport identifica universo, jugador y fecha de exportación", () => {
  const data = sampleExport();
  const p = parseExport(JSON.stringify(data));
  assert.equal(p.universeId, "https://s275-es.ogame.gameforge.com#101348");
  assert.equal(p.lang, "es");
  assert.equal(p.universe, "275");
  assert.equal(p.exportedAt, Date.parse(iso(21, 11)));
  assert.equal(exportFileName(data.universeUrl), "oginfinity-es-275.data");
  assert.throws(() => parseExport("{}"), /OGame Infinity/);
  assert.throws(() => parseExport("no json"), /JSON/);
});

test("deriveSums reproduce los agregados de OGI a partir de los registros en bruto", () => {
  const data = sampleExport();
  const der = deriveSums(data);
  const day = dayKey(at(21));
  for (const kind of ["expeditionSums", "combatsSums", "discoveriesSums"]) {
    const imported = data[kind][day];
    for (const c of Object.values(der[kind][day])) {
      for (const [field, value] of Object.entries(c.fields))
        assert.deepEqual(value, imported[field], `${kind}.${field}`);
    }
  }
});

test("combineDaySum: el bruto completo gana y se conservan campos no reconstruibles", () => {
  const data = sampleExport();
  const day = dayKey(at(21));
  const der = deriveSums(data);
  const { sum, source } = combineDaySum("expeditionSums", data.expeditionSums[day], der.expeditionSums[day]);
  assert.equal(source, "bruto");
  assert.equal(sum.fuel, -77);
  assert.deepEqual(sum.fleet, { 202: 4 });
});

test("combineDaySum: si OGI purgó parte del día gana el agregado importado", () => {
  const data = sampleExport();
  const day = dayKey(at(21));
  delete data.expeditions[100]; // simulamos un registro ya purgado
  const der = deriveSums(data);
  const { sum, source } = combineDaySum("expeditionSums", data.expeditionSums[day], der.expeditionSums[day]);
  assert.equal(source, "mixto"); // eventos importados, pérdidas y recolección del bruto
  assert.deepEqual(sum.found, [1000, 0, 0, 500]);
  assert.equal(sum.type.Metal, 1);
});

test("combineDaySum: registros de dos dispositivos suman más que cualquier agregado", () => {
  const a = sampleExport();
  const day = dayKey(at(21));
  const raw = {
    expeditions: { ...a.expeditions, 999: { result: "Crystal", amount: [0, 7, 0, 0], date: iso(21, 15) } },
  };
  const der = deriveSums(raw);
  const { sum } = combineDaySum("expeditionSums", a.expeditionSums[day], der.expeditionSums[day]);
  assert.deepEqual(sum.found, [1000, 7, 0, 500]);
  assert.equal(sum.type.Crystal, 1);
});

test("isBetterSum elige el agregado con más eventos, luego magnitud y luego el más reciente", () => {
  const small = { count: 1, loot: [1, 0, 0] };
  const big = { count: 2, loot: [0, 0, 0] };
  assert.equal(isBetterSum("combatsSums", big, 1, small, 2), true);
  assert.equal(isBetterSum("combatsSums", small, 2, big, 1), false);
  assert.equal(isBetterSum("combatsSums", { count: 1, loot: [5, 0, 0] }, 1, small, 2), true);
  assert.equal(isBetterSum("combatsSums", small, 3, small, 2), true);
  assert.equal(isBetterSum("combatsSums", small, 1, small, 2), false);
});

test("computeFinalSums incluye días sólo importados y sólo calculados", () => {
  const data = sampleExport();
  const old = "01.09.26";
  const best = { expeditionSums: { ...data.expeditionSums, [old]: { found: [1, 1, 1, 0], type: { Metal: 9 } } } };
  const raw = { expeditions: { 1: { result: "Metal", amount: [3, 0, 0, 0], date: iso(23, 12) } } };
  const { sums, sources } = computeFinalSums(best, raw);
  assert.equal(sources.expeditionSums[old], "importado");
  assert.equal(sources.expeditionSums[dayKey(at(23))], "bruto");
  assert.deepEqual(sums.expeditionSums[dayKey(at(23))].found, [3, 0, 0, 0]);
  assert.deepEqual(Object.keys(sums.expeditionSums), sortDayKeys(Object.keys(sums.expeditionSums)));
});

test("buildMergedExport usa la instantánea más reciente y aplica la retención de OGI", () => {
  const snapshot = sampleExport({ options: { nuevo: true } });
  const now = at(30).getTime();
  const raw = {
    expeditions: {
      1: { result: "Metal", amount: [3, 0, 0, 0], date: iso(29, 12) },
      2: { result: "Metal", amount: [3, 0, 0, 0], date: iso(10, 12) },
      3: { result: "Void", date: iso(10, 12), favorited: true },
    },
    combats: { 9: { timestamp: secs(1, 12), coordinates: { position: 7 }, loot: [0, 0, 0], losses: {} } },
  };
  const out = buildMergedExport(snapshot, raw, {}, { now });
  assert.deepEqual(out.options, { nuevo: true });
  assert.deepEqual(Object.keys(out.expeditions), ["1", "3"]);
  assert.deepEqual(Object.keys(out.combats), ["9"]);
  assert.deepEqual(out.harvests, {});
  const full = buildMergedExport(snapshot, raw, {}, { now, fullHistory: true });
  assert.deepEqual(Object.keys(full.expeditions), ["1", "2", "3"]);
  assert.ok(full.expeditionSums[dayKey(at(10))]);
  assert.equal(keepForOgi("harvests", { date: iso(1, 12), favorited: true }, now), false);
});
