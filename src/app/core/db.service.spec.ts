import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { at, iso, sampleExport } from '../../testing/sample-export';
import { DbService } from './db.service';
import { buildMergedExport, dayKey, hashText, parseExport } from './merge';

function parsed(overrides: Record<string, unknown> = {}) {
  const text = JSON.stringify(sampleExport(overrides));
  return { parsed: parseExport(text), hash: hashText(text) };
}

describe('DbService', () => {
  let db: DbService;

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    db = TestBed.inject(DbService);
    await db.clearAll();
  });

  it('importa, fusiona registros y conserva la instantánea más reciente', async () => {
    const a = parsed();
    const s1 = await db.importExport(a.parsed, 'a.data', a.hash);
    expect(s1.newRecords).toBe(12);
    expect(s1.snapshot).toBe(true);

    // Exportación posterior: OGI ya purgó la expedición 100, hay una nueva y otras opciones.
    const later = sampleExport({ options: { b: 2 }, lastEmpireUpdate: iso(24, 10) });
    const exps = later['expeditions'] as Record<string, unknown>;
    delete exps['100'];
    exps['500'] = { result: 'Crystal', amount: [0, 9, 0, 0], date: iso(24, 9) };
    const textB = JSON.stringify(later);
    const s2 = await db.importExport(parseExport(textB), 'b.data', hashText(textB));
    expect(s2.newRecords).toBe(1);
    expect(s2.snapshot).toBe(true);

    // Una exportación antigua no sustituye a la instantánea.
    const old = parsed({ options: { viejo: true }, lastEmpireUpdate: iso(1, 10), expeditions: {} });
    const s3 = await db.importExport(old.parsed, 'old.data', old.hash);
    expect(s3.snapshot).toBe(false);

    expect(await db.findImportByHash(a.hash)).toBeTruthy();
    const [summary] = await db.refresh();
    expect(summary.slug).toBe('275-es-101348');
    expect(summary.importCount).toBe(3);
    expect(summary.expeditions).toBe(5);

    const loaded = (await db.loadUniverse(summary.id))!;
    expect(loaded.universe.snapshot['options']).toEqual({ b: 2 });
    const out = buildMergedExport(loaded.universe.snapshot, loaded.raw, loaded.bestSums, {
      fullHistory: true,
    });
    expect(Object.keys(out['expeditions'] as object).sort()).toEqual([
      '100',
      '101',
      '102',
      '103',
      '500',
    ]);
    const sums = out['expeditionSums'] as Record<string, { found: number[] }>;
    expect(sums[dayKey(at(21))].found).toEqual([1000, 0, 0, 500]);
    expect(sums[dayKey(at(24))].found).toEqual([0, 9, 0, 0]);
    expect((await db.listImports(summary.id)).map((i) => i.fileName)).toEqual([
      'old.data',
      'b.data',
      'a.data',
    ]);
  });

  it('se queda con el agregado importado más alto', async () => {
    const day = dayKey(at(21));
    const big = parsed({ expeditions: {}, combats: {}, harvests: {}, discoveries: {} });
    await db.importExport(big.parsed, 'big.data', big.hash);
    const small = parsed({
      lastEmpireUpdate: iso(28, 10),
      expeditions: {},
      combats: {},
      harvests: {},
      discoveries: {},
      expeditionSums: { [day]: { found: [1, 0, 0, 0], type: { Metal: 1 } } },
    });
    const stats = await db.importExport(small.parsed, 'small.data', small.hash);
    expect(stats.betterDays).toBe(0);
    const [summary] = await db.refresh();
    const loaded = (await db.loadUniverse(summary.id))!;
    expect(loaded.bestSums['expeditionSums']![day].found).toEqual([1000, 0, 0, 500]);
  });

  it('elimina un universo', async () => {
    const a = parsed();
    await db.importExport(a.parsed, 'a.data', a.hash);
    const [summary] = await db.refresh();
    await db.deleteUniverse(summary.id);
    expect(db.universes()).toEqual([]);
    expect(await db.loadUniverse(summary.id)).toBeNull();
    expect(await db.findImportByHash(a.hash)).toBeUndefined();
  });
});
