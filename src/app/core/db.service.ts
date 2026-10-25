import { Injectable, signal } from '@angular/core';
import {
  DaySum,
  ParsedExport,
  RAW_KINDS,
  RawData,
  RawRecord,
  SUM_KINDS,
  SumData,
  OgiExport,
  isBetterSum,
  isNewerRecord,
  sameData,
  sortDayKeys,
  universeSlug,
} from './merge';

// Almacenamiento local en IndexedDB.
//   universes: un registro por universo+jugador con la exportación más reciente.
//   imports:   historial de archivos importados.
//   records:   registros en bruto fusionados  [u, k, id] -> { d: datos, x: fecha de exportación }
//   sums:      mejor agregado diario importado [u, k, day] -> { d: datos, x: fecha de exportación }

const DB_NAME = 'ogi-fusion';
const DB_VERSION = 1;
const STORES = ['universes', 'imports', 'records', 'sums'] as const;

export interface UniverseRecord {
  id: string;
  slug: string;
  universeUrl: string;
  playerId: number;
  host: string;
  lang: string;
  universe: string;
  exportedAt: number;
  firstImportAt: number;
  lastImportAt: number;
  importCount: number;
  snapshot: OgiExport;
}

export interface UniverseSummary extends Omit<UniverseRecord, 'snapshot'> {
  expeditions: number;
  combats: number;
  firstDay: string | null;
  lastDay: string | null;
  days: number;
}

export interface ImportStats {
  newRecords: number;
  updatedRecords: number;
  newDays: number;
  betterDays: number;
  snapshot: boolean;
}

export interface ImportRecord {
  id?: number;
  u: string;
  fileName: string;
  hash: string;
  importedAt: number;
  exportedAt: number;
  stats: ImportStats;
}

interface StoredRecord {
  u: string;
  k: string;
  id: string;
  d: RawRecord;
  x: number;
}

interface StoredSum {
  u: string;
  k: string;
  day: string;
  d: DaySum;
  x: number;
}

export interface LoadedUniverse {
  universe: UniverseRecord;
  raw: RawData;
  bestSums: SumData;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transacción abortada'));
  });
}

@Injectable({ providedIn: 'root' })
export class DbService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  /** Resumen de los universos almacenados, actualizado tras cada cambio. */
  readonly universes = signal<UniverseSummary[]>([]);
  readonly ready = signal(false);

  get supported(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('universes', { keyPath: 'id' });
        const imports = db.createObjectStore('imports', { keyPath: 'id', autoIncrement: true });
        imports.createIndex('u', 'u');
        imports.createIndex('hash', 'hash');
        const records = db.createObjectStore('records', { keyPath: ['u', 'k', 'id'] });
        records.createIndex('uk', ['u', 'k']);
        records.createIndex('u', 'u');
        const sums = db.createObjectStore('sums', { keyPath: ['u', 'k', 'day'] });
        sums.createIndex('uk', ['u', 'k']);
        sums.createIndex('u', 'u');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('La base de datos está bloqueada por otra pestaña.'));
    });
    return this.dbPromise;
  }

  /** Pide al navegador que no borre los datos automáticamente. */
  async requestPersistence(): Promise<boolean> {
    try {
      return (await navigator.storage?.persist?.()) ?? false;
    } catch {
      return false;
    }
  }

  async storageUsage(): Promise<number | null> {
    try {
      return (await navigator.storage?.estimate?.())?.usage ?? null;
    } catch {
      return null;
    }
  }

  async findImportByHash(hash: string): Promise<ImportRecord | undefined> {
    const db = await this.open();
    const tx = db.transaction('imports');
    return promisify(tx.objectStore('imports').index('hash').get(hash));
  }

  /** Integra una exportación ya analizada (resultado de parseExport). */
  async importExport(parsed: ParsedExport, fileName: string, hash: string): Promise<ImportStats> {
    const db = await this.open();
    const tx = db.transaction([...STORES], 'readwrite');
    const finished = done(tx);
    const u = parsed.universeId;
    const x = parsed.exportedAt;
    const data = parsed.data;
    const now = Date.now();
    const stats: ImportStats = {
      newRecords: 0,
      updatedRecords: 0,
      newDays: 0,
      betterDays: 0,
      snapshot: false,
    };

    const universes = tx.objectStore('universes');
    const existing = (await promisify(universes.get(u))) as UniverseRecord | undefined;
    const uni: UniverseRecord = existing || {
      id: u,
      slug: universeSlug(data.universeUrl, data.playerId),
      universeUrl: data.universeUrl,
      playerId: data.playerId,
      host: parsed.host,
      lang: parsed.lang,
      universe: parsed.universe,
      exportedAt: 0,
      firstImportAt: now,
      lastImportAt: now,
      importCount: 0,
      snapshot: data,
    };
    uni.importCount += 1;
    uni.lastImportAt = now;
    if (!existing || x >= existing.exportedAt) {
      uni.snapshot = data;
      uni.exportedAt = x;
      stats.snapshot = true;
    }
    universes.put(uni);

    const records = tx.objectStore('records');
    for (const k of RAW_KINDS) {
      const incoming = data[k];
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) continue;
      const current = (await promisify(records.index('uk').getAll([u, k]))) as StoredRecord[];
      const byId = new Map(current.map((r) => [r.id, r]));
      for (const [id, rec] of Object.entries(incoming as Record<string, RawRecord>)) {
        const old = byId.get(id);
        if (!old) stats.newRecords++;
        else if (!isNewerRecord(x, old.x) || sameData(old.d, rec)) continue;
        else stats.updatedRecords++;
        records.put({ u, k, id, d: rec, x } satisfies StoredRecord);
      }
    }

    const sums = tx.objectStore('sums');
    for (const k of SUM_KINDS) {
      const incoming = data[k];
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) continue;
      const current = (await promisify(sums.index('uk').getAll([u, k]))) as StoredSum[];
      const byDay = new Map(current.map((r) => [r.day, r]));
      for (const [day, sum] of Object.entries(incoming as Record<string, DaySum>)) {
        const old = byDay.get(day);
        if (old && !isBetterSum(k, sum, x, old.d, old.x)) continue;
        if (old && sameData(old.d, sum)) continue;
        if (old) stats.betterDays++;
        else stats.newDays++;
        sums.put({ u, k, day, d: sum, x } satisfies StoredSum);
      }
    }

    tx.objectStore('imports').add({
      u,
      fileName,
      hash,
      importedAt: now,
      exportedAt: x,
      stats,
    } satisfies ImportRecord);
    await finished;
    return stats;
  }

  /** Recalcula el listado de universos (señal `universes`). */
  async refresh(): Promise<UniverseSummary[]> {
    const db = await this.open();
    const tx = db.transaction(['universes', 'records', 'sums']);
    const all = (await promisify(tx.objectStore('universes').getAll())) as UniverseRecord[];
    const records = tx.objectStore('records').index('uk');
    const sums = tx.objectStore('sums').index('uk');
    const list: UniverseSummary[] = [];
    for (const { snapshot: _snapshot, ...uni } of all) {
      const days = new Set<string>();
      for (const k of ['expeditionSums', 'combatsSums', 'discoveriesSums']) {
        const keys = (await promisify(sums.getAllKeys([uni.id, k]))) as unknown as [
          string,
          string,
          string,
        ][];
        keys.forEach((key) => days.add(key[2]));
      }
      const sorted = sortDayKeys(days);
      list.push({
        ...uni,
        expeditions: await promisify(records.count([uni.id, 'expeditions'])),
        combats: await promisify(records.count([uni.id, 'combats'])),
        firstDay: sorted[0] ?? null,
        lastDay: sorted[sorted.length - 1] ?? null,
        days: sorted.length,
      });
    }
    list.sort((a, b) => a.host.localeCompare(b.host) || a.playerId - b.playerId);
    this.universes.set(list);
    this.ready.set(true);
    return list;
  }

  async listImports(u: string): Promise<ImportRecord[]> {
    const db = await this.open();
    const tx = db.transaction('imports');
    const all = (await promisify(tx.objectStore('imports').index('u').getAll(u))) as ImportRecord[];
    return all.sort((a, b) => b.importedAt - a.importedAt);
  }

  /** Carga todo lo necesario para mostrar o exportar un universo. */
  async loadUniverse(u: string): Promise<LoadedUniverse | null> {
    const db = await this.open();
    const tx = db.transaction(['universes', 'records', 'sums']);
    const universe = (await promisify(tx.objectStore('universes').get(u))) as
      UniverseRecord | undefined;
    if (!universe) return null;
    const raw: RawData = {};
    const recs = (await promisify(
      tx.objectStore('records').index('u').getAll(u),
    )) as StoredRecord[];
    for (const r of recs) (raw[r.k] = raw[r.k] || {})[r.id] = r.d;
    const bestSums: SumData = {};
    const sums = (await promisify(tx.objectStore('sums').index('u').getAll(u))) as StoredSum[];
    for (const s of sums) (bestSums[s.k] = bestSums[s.k] || {})[s.day] = s.d;
    return { universe, raw, bestSums };
  }

  async deleteUniverse(u: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([...STORES], 'readwrite');
    const finished = done(tx);
    tx.objectStore('universes').delete(u);
    for (const store of ['imports', 'records', 'sums'] as const) {
      const keys = await promisify(tx.objectStore(store).index('u').getAllKeys(u));
      for (const key of keys) tx.objectStore(store).delete(key);
    }
    await finished;
    await this.refresh();
  }

  async clearAll(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([...STORES], 'readwrite');
    const finished = done(tx);
    for (const store of STORES) tx.objectStore(store).clear();
    await finished;
    await this.refresh();
  }
}
