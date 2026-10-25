import {
  OgiExport,
  RawData,
  buildMergedExport,
  combineDaySum,
  computeFinalSums,
  dayKey,
  deriveSums,
  exportFileName,
  isBetterSum,
  keepForOgi,
  parseExport,
  sameData,
  sortDayKeys,
  universeSlug,
} from './merge';
import { at, iso, sampleExport, secs } from '../../testing/sample-export';

const raw = (data: OgiExport) => data as unknown as RawData;
const sums = (data: OgiExport, kind: string) =>
  data[kind] as Record<string, Record<string, unknown>>;

describe('merge', () => {
  it('parseExport identifica universo, jugador y fecha de exportación', () => {
    const data = sampleExport();
    const p = parseExport(JSON.stringify(data));
    expect(p.universeId).toBe('https://s275-es.ogame.gameforge.com#101348');
    expect(p.lang).toBe('es');
    expect(p.universe).toBe('275');
    expect(p.exportedAt).toBe(Date.parse(iso(21, 11)));
    expect(exportFileName(data.universeUrl)).toBe('oginfinity-es-275.data');
    expect(universeSlug(data.universeUrl, data.playerId)).toBe('275-es-101348');
    expect(() => parseExport('{}')).toThrow(/OGame Infinity/);
    expect(() => parseExport('no json')).toThrow(/JSON/);
  });

  it('deriveSums reproduce los agregados de OGI a partir de los registros en bruto', () => {
    const data = sampleExport();
    const der = deriveSums(raw(data)) as unknown as Record<
      string,
      Record<string, Record<string, { fields: object }>>
    >;
    const day = dayKey(at(21));
    for (const kind of ['expeditionSums', 'combatsSums', 'discoveriesSums']) {
      const imported = sums(data, kind)[day];
      for (const c of Object.values(der[kind][day])) {
        for (const [field, value] of Object.entries(c.fields)) {
          expect(value, `${kind}.${field}`).toEqual(imported[field]);
        }
      }
    }
  });

  it('combineDaySum: el bruto completo gana y se conservan campos no reconstruibles', () => {
    const data = sampleExport();
    const day = dayKey(at(21));
    const der = deriveSums(raw(data));
    const { sum, source } = combineDaySum(
      'expeditionSums',
      sums(data, 'expeditionSums')[day],
      der.expeditionSums[day],
    );
    expect(source).toBe('bruto');
    expect(sum.fuel).toBe(-77);
    expect(sum.fleet).toEqual({ 202: 4 });
  });

  it('combineDaySum: si OGI purgó parte del día gana el agregado importado', () => {
    const data = sampleExport();
    const day = dayKey(at(21));
    delete (data['expeditions'] as Record<string, unknown>)['100'];
    const der = deriveSums(raw(data));
    const { sum, source } = combineDaySum(
      'expeditionSums',
      sums(data, 'expeditionSums')[day],
      der.expeditionSums[day],
    );
    expect(source).toBe('mixto');
    expect(sum.found).toEqual([1000, 0, 0, 500]);
    expect(sum.type!['Metal']).toBe(1);
  });

  it('combineDaySum: registros de dos dispositivos suman más que cualquier agregado', () => {
    const a = sampleExport();
    const day = dayKey(at(21));
    const merged: RawData = {
      expeditions: {
        ...(a['expeditions'] as RawData['expeditions']),
        999: { result: 'Crystal', amount: [0, 7, 0, 0], date: iso(21, 15) },
      },
    };
    const der = deriveSums(merged);
    const { sum } = combineDaySum(
      'expeditionSums',
      sums(a, 'expeditionSums')[day],
      der.expeditionSums[day],
    );
    expect(sum.found).toEqual([1000, 7, 0, 500]);
    expect(sum.type!['Crystal']).toBe(1);
  });

  it('isBetterSum elige más eventos, luego magnitud y luego el más reciente', () => {
    const small = { count: 1, loot: [1, 0, 0] };
    const big = { count: 2, loot: [0, 0, 0] };
    expect(isBetterSum('combatsSums', big, 1, small, 2)).toBe(true);
    expect(isBetterSum('combatsSums', small, 2, big, 1)).toBe(false);
    expect(isBetterSum('combatsSums', { count: 1, loot: [5, 0, 0] }, 1, small, 2)).toBe(true);
    expect(isBetterSum('combatsSums', small, 3, small, 2)).toBe(true);
    expect(isBetterSum('combatsSums', small, 1, small, 2)).toBe(false);
  });

  it('computeFinalSums incluye días sólo importados y sólo calculados', () => {
    const data = sampleExport();
    const old = '01.09.26';
    const best = {
      expeditionSums: {
        ...(data['expeditionSums'] as object),
        [old]: { found: [1, 1, 1, 0], type: { Metal: 9 } },
      },
    };
    const rawData: RawData = {
      expeditions: { 1: { result: 'Metal', amount: [3, 0, 0, 0], date: iso(23, 12) } },
    };
    const { sums: out, sources } = computeFinalSums(best, rawData);
    expect(sources['expeditionSums'][old]).toBe('importado');
    expect(sources['expeditionSums'][dayKey(at(23))]).toBe('bruto');
    expect(out['expeditionSums'][dayKey(at(23))].found).toEqual([3, 0, 0, 0]);
    expect(Object.keys(out['expeditionSums'])).toEqual(
      sortDayKeys(Object.keys(out['expeditionSums'])),
    );
  });

  it('buildMergedExport usa la instantánea más reciente y aplica la retención de OGI', () => {
    const snapshot = sampleExport({ options: { nuevo: true } });
    const now = at(30).getTime();
    const rawData: RawData = {
      expeditions: {
        1: { result: 'Metal', amount: [3, 0, 0, 0], date: iso(29, 12) },
        2: { result: 'Metal', amount: [3, 0, 0, 0], date: iso(10, 12) },
        3: { result: 'Void', date: iso(10, 12), favorited: true },
      },
      combats: {
        9: { timestamp: secs(1, 12), coordinates: { position: 7 }, loot: [0, 0, 0], losses: {} },
      },
    };
    const out = buildMergedExport(snapshot, rawData, {}, { now });
    expect(out['options']).toEqual({ nuevo: true });
    expect(Object.keys(out['expeditions'] as object)).toEqual(['1', '3']);
    expect(Object.keys(out['combats'] as object)).toEqual(['9']);
    expect(out['harvests']).toEqual({});
    const full = buildMergedExport(snapshot, rawData, {}, { now, fullHistory: true });
    expect(Object.keys(full['expeditions'] as object)).toEqual(['1', '2', '3']);
    expect(sums(full, 'expeditionSums')[dayKey(at(10))]).toBeTruthy();
    expect(keepForOgi('harvests', { date: iso(1, 12), favorited: true }, now)).toBe(false);
  });

  it('sameData ignora el orden de las claves', () => {
    expect(sameData({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(sameData({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});
