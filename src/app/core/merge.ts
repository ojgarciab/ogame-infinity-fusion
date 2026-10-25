// Lógica pura de fusión de exportaciones de OGame Infinity (OGI).
// No depende de Angular ni del navegador para poder probarse de forma aislada.

/** Exportación de OGI: JSON completo de un universo y un jugador. */
export interface OgiExport {
  playerId: number;
  universeUrl: string;
  lastEmpireUpdate?: string;
  [key: string]: unknown;
}

export interface Coordinates {
  galaxy?: number;
  system?: number;
  position?: number;
  planetType?: number;
}

/** Campos conocidos de los registros en bruto (expediciones, combates, ...). */
export interface RawRecord {
  date?: string;
  timestamp?: string | number;
  result?: string;
  amount?: number[] | number;
  size?: string | null;
  favorited?: boolean;
  hashcode?: string;
  coordinates?: Coordinates;
  coords?: string;
  win?: boolean;
  draw?: boolean;
  isProbes?: boolean;
  loot?: number[];
  losses?: Record<string, number>;
  metal?: number;
  crystal?: number;
  deuterium?: number;
  [key: string]: unknown;
}

/** Campos conocidos de los agregados diarios. */
export interface DaySum {
  found?: number[];
  harvest?: number[];
  losses?: Record<string, number>;
  fleet?: Record<string, number>;
  bhole?: Record<string, number>;
  type?: Record<string, number>;
  adjust?: number[];
  fuel?: number;
  loot?: number[];
  topCombats?: unknown[];
  count?: number;
  wins?: number;
  draws?: number;
  artefacts?: number;
  [key: string]: unknown;
}

export type RawKind = (typeof RAW_KINDS)[number];
export type SumKind = (typeof SUM_KINDS)[number];
export type RawData = Partial<Record<string, Record<string, RawRecord>>>;
export type SumData = Partial<Record<string, Record<string, DaySum>>>;
export type SumSource = 'bruto' | 'importado' | 'mixto';

export interface ParsedExport {
  data: OgiExport;
  universeId: string;
  exportedAt: number;
  host: string;
  universe: string;
  lang: string;
}

interface Component {
  weight: number;
  fields: DaySum;
}
type DerivedDay = Record<string, Component>;
export type DerivedSums = Record<
  'expeditionSums' | 'combatsSums' | 'discoveriesSums',
  Record<string, DerivedDay>
>;

/** Claves con registros en bruto: mapas { idMensaje: registro }. */
export const RAW_KINDS = [
  'expeditions',
  'combats',
  'harvests',
  'discoveries',
  'trades',
  'spies',
] as const;
/** Claves con agregados diarios: mapas { "DD.MM.YY": agregado }. */
export const SUM_KINDS = [
  'expeditionSums',
  'combatsSums',
  'discoveriesSums',
  'tradesSums',
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPEDITION_POSITION = 16;
const FOUND_RESULTS = new Set(['Metal', 'Crystal', 'Deuterium', 'AM']);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Igualdad estructural sin depender del orden de las claves. */
export function sameData(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(obj)
          .sort()
          .map((k) => [k, norm(obj[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** Hash no criptográfico (cyrb53) para detectar archivos ya importados. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Clave de día igual que OGI: fecha local del navegador en formato DD.MM.YY. */
export function dayKey(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getFullYear()).slice(2),
  ].join('.');
}

export function dayKeyToDate(key: string): Date {
  const [dd, mm, yy] = key.split('.').map(Number);
  return new Date(2000 + yy, mm - 1, dd);
}

export function sortDayKeys(keys: Iterable<string>): string[] {
  return [...keys].sort((a, b) => dayKeyToDate(a).getTime() - dayKeyToDate(b).getTime());
}

/** Fecha de un registro en bruto (los combates guardan segundos Unix en texto). */
export function recordDate(kind: string, record: RawRecord | undefined): Date | null {
  if (!record || typeof record !== 'object') return null;
  let d: Date | null = null;
  if (kind === 'combats' && record.timestamp !== undefined)
    d = new Date(Number(record.timestamp) * 1000);
  else if (record.date) d = new Date(record.date);
  return d && !isNaN(d.getTime()) ? d : null;
}

function sumValues(obj: Record<string, number> | number[] | undefined): number {
  if (!obj) return 0;
  return Object.values(obj).reduce((acc: number, v) => acc + (Number(v) || 0), 0);
}

function sumAbs(arr: number[] | undefined): number {
  if (!arr) return 0;
  return arr.reduce((acc, v) => acc + Math.abs(Number(v) || 0), 0);
}

function addInto(target: Record<string, number>, source: Record<string, number> | undefined): void {
  for (const [k, v] of Object.entries(source || {}))
    target[k] = (target[k] || 0) + (Number(v) || 0);
}

/** Suma de valores absolutos de todos los números de una estructura (desempate). */
function magnitude(value: unknown): number {
  if (typeof value === 'number') return Math.abs(value);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).reduce(
      (a: number, v) => a + magnitude(v),
      0,
    );
  }
  return 0;
}

function asMap<T>(value: unknown): Record<string, T> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, T>)
    : null;
}

// ---------------------------------------------------------------------------
// Lectura de exportaciones
// ---------------------------------------------------------------------------

export function universeIdOf(data: OgiExport): string {
  return `${data.universeUrl}#${data.playerId}`;
}

/** "https://s275-es.ogame.gameforge.com" -> { universe: "275", lang: "es" } */
export function universeInfo(universeUrl: string): {
  host: string;
  universe: string;
  lang: string;
} {
  let host = String(universeUrl || '');
  try {
    host = new URL(universeUrl).host;
  } catch {
    // Se usa el texto tal cual.
  }
  const m = host.match(/^s(\d+)-([a-z]+)\./i);
  return {
    host,
    universe: m ? m[1] : host.split('.')[0].replace(/\D/g, ''),
    lang: m ? m[2].toLowerCase() : 'xx',
  };
}

/** Identificador apto para URL: "275-es-101348". */
export function universeSlug(universeUrl: string, playerId: number | string): string {
  const { universe, lang, host } = universeInfo(universeUrl);
  const base = universe ? `${universe}-${lang}` : host.replace(/[^a-z0-9]+/gi, '-');
  return `${base}-${playerId}`;
}

/**
 * Momento aproximado de la exportación: lo más reciente entre la última
 * actualización del imperio y la fecha del último registro en bruto.
 */
export function exportTimestamp(data: OgiExport): number {
  let best = 0;
  const t = Date.parse(String(data.lastEmpireUpdate));
  if (!isNaN(t)) best = t;
  for (const kind of RAW_KINDS) {
    for (const rec of Object.values(asMap<RawRecord>(data[kind]) || {})) {
      const d = recordDate(kind, rec);
      if (d && d.getTime() > best) best = d.getTime();
    }
  }
  return best;
}

export function parseExport(text: string): ParsedExport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  const obj = asMap<unknown>(data);
  if (!obj || !obj['universeUrl'] || obj['playerId'] === undefined) {
    throw new Error('No parece una exportación de OGame Infinity (faltan universeUrl/playerId).');
  }
  const ogi = obj as OgiExport;
  return {
    data: ogi,
    universeId: universeIdOf(ogi),
    exportedAt: exportTimestamp(ogi),
    ...universeInfo(ogi.universeUrl),
  };
}

/** Nombre de archivo que usa OGI al exportar. */
export function exportFileName(universeUrl: string): string {
  const { lang, universe } = universeInfo(universeUrl);
  return `oginfinity-${lang}-${universe}.data`;
}

// ---------------------------------------------------------------------------
// Elección del agregado importado "más alto"
// ---------------------------------------------------------------------------

/** Puntuación de un agregado diario: [nº de eventos contados, magnitud total]. */
export function sumScore(kind: string, sum: DaySum | undefined): [number, number] {
  if (!sum || typeof sum !== 'object') return [0, 0];
  let events: number;
  if (kind === 'combatsSums') events = Number(sum.count) || 0;
  else if (kind === 'expeditionSums' || kind === 'discoveriesSums') events = sumValues(sum.type);
  else events = JSON.stringify(sum).length;
  return [events, magnitude(sum)];
}

/** ¿El candidato a (exportado en ax) es mejor que b (exportado en bx)? */
export function isBetterSum(
  kind: string,
  a: DaySum,
  ax: number,
  b: DaySum | undefined,
  bx: number | undefined,
): boolean {
  if (!b) return true;
  const [ae, am] = sumScore(kind, a);
  const [be, bm] = sumScore(kind, b);
  if (ae !== be) return ae > be;
  if (am !== bm) return am > bm;
  return (ax || 0) >= (bx || 0);
}

/** ¿Debe el registro entrante (exportado en inX) sustituir al existente (exportado en oldX)? */
export function isNewerRecord(inX: number, oldX: number | undefined): boolean {
  return oldX === undefined || (inX || 0) >= (oldX || 0);
}

// ---------------------------------------------------------------------------
// Agregados calculados a partir de los registros en bruto
// ---------------------------------------------------------------------------

const EMPTY: Record<string, () => DaySum> = {
  expeditionSums: () => ({
    found: [0, 0, 0, 0],
    harvest: [0, 0, 0],
    losses: {},
    fleet: {},
    type: {},
    adjust: [0, 0, 0],
    fuel: 0,
  }),
  combatsSums: () => ({
    loot: [0, 0, 0],
    harvest: [0, 0, 0],
    losses: {},
    fuel: 0,
    adjust: [0, 0, 0],
    topCombats: [],
    count: 0,
    wins: 0,
    draws: 0,
  }),
  discoveriesSums: () => ({ found: [0, 0, 0, 0], artefacts: 0, type: {} }),
};

/**
 * Reproduce lo que OGI acumula al leer cada mensaje. Devuelve, por tipo y día,
 * "componentes" independientes, cada uno con sus campos y su peso (cuánta
 * información contiene) para compararlo con el agregado importado.
 */
export function deriveSums(raw: RawData): DerivedSums {
  const out: DerivedSums = { expeditionSums: {}, combatsSums: {}, discoveriesSums: {} };
  const comp = (
    kind: keyof DerivedSums,
    day: string,
    name: string,
    init: () => DaySum,
  ): Component => {
    const days = out[kind];
    days[day] = days[day] || {};
    if (!days[day][name]) days[day][name] = { weight: 0, fields: init() };
    return days[day][name];
  };

  for (const rec of Object.values(raw['expeditions'] || {})) {
    const d = recordDate('expeditions', rec);
    if (!d || !rec.result) continue;
    const c = comp('expeditionSums', dayKey(d), 'events', () => ({
      found: [0, 0, 0, 0],
      type: {},
    }));
    const type = c.fields.type!;
    type[rec.result] = (type[rec.result] || 0) + 1;
    c.weight += 1;
    if (FOUND_RESULTS.has(rec.result) && Array.isArray(rec.amount)) {
      const found = c.fields.found!;
      rec.amount.slice(0, 4).forEach((v, i) => (found[i] += Number(v) || 0));
    }
  }

  // Combates: se ordenan por fecha para deduplicar por hashcode como OGI.
  const combats = Object.values(raw['combats'] || {})
    .map((rec) => ({ rec, d: recordDate('combats', rec) }))
    .filter((x): x is { rec: RawRecord; d: Date } => x.d !== null)
    .sort((a, b) => a.d.getTime() - b.d.getTime());
  const seenHash = new Set<string>();
  for (const { rec, d } of combats) {
    const day = dayKey(d);
    if (rec.coordinates && Number(rec.coordinates.position) === EXPEDITION_POSITION) {
      const c = comp('expeditionSums', day, 'losses', () => ({ losses: {} }));
      addInto(c.fields.losses!, rec.losses);
      c.weight += sumValues(rec.losses);
      continue;
    }
    if (rec.hashcode) {
      if (seenHash.has(rec.hashcode)) continue;
      seenHash.add(rec.hashcode);
    }
    if (rec.isProbes) continue;
    const c = comp('combatsSums', day, 'combat', () => ({
      loot: [0, 0, 0],
      losses: {},
      count: 0,
      wins: 0,
      draws: 0,
    }));
    const f = c.fields;
    f.count! += 1;
    if (rec.win) f.wins! += 1;
    if (rec.draw) f.draws! += 1;
    (rec.loot || []).slice(0, 3).forEach((v, i) => (f.loot![i] += Number(v) || 0));
    addInto(f.losses!, rec.losses);
    c.weight += 1;
  }

  for (const rec of Object.values(raw['harvests'] || {})) {
    const d = recordDate('harvests', rec);
    if (!d) continue;
    const pos = Number(String(rec.coords || '').split(':')[2]);
    const kind = pos === EXPEDITION_POSITION ? 'expeditionSums' : 'combatsSums';
    const c = comp(kind, dayKey(d), 'harvest', () => ({ harvest: [0, 0, 0] }));
    const res = [rec.metal, rec.crystal, rec.deuterium].map((v) => Number(v) || 0);
    res.forEach((v, i) => (c.fields.harvest![i] += v));
    c.weight += res[0] + res[1] + res[2];
  }

  for (const rec of Object.values(raw['discoveries'] || {})) {
    const d = recordDate('discoveries', rec);
    if (!d || !rec.result) continue;
    const c = comp('discoveriesSums', dayKey(d), 'events', () => ({
      found: [0, 0, 0, 0],
      artefacts: 0,
      type: {},
    }));
    const f = c.fields;
    f.type![rec.result] = (f.type![rec.result] || 0) + 1;
    c.weight += 1;
    const lf = String(rec.result).match(/^lifeform(\d)$/);
    if (lf) f.found![Number(lf[1]) - 1] += Number(rec.amount) || 0;
    else if (rec.result === 'artefacts') f.artefacts! += Number(rec.amount) || 0;
  }

  return out;
}

/** Peso del mismo componente dentro de un agregado importado. */
function importedWeight(name: string, sum: DaySum | undefined): number {
  if (!sum) return -1;
  if (name === 'events') return sumValues(sum.type);
  if (name === 'losses') return sumValues(sum.losses);
  if (name === 'harvest') return sumAbs(sum.harvest);
  if (name === 'combat') return Number(sum.count) || 0;
  return 0;
}

/**
 * Combina el mejor agregado importado con lo calculado desde los registros en
 * bruto: cada componente calculado sustituye al importado sólo si contiene al
 * menos la misma información (si OGI ya purgó parte del día, gana lo importado).
 * Los campos no reconstruibles (combustible, naves encontradas, agujeros
 * negros, top de combates, ajustes) se conservan del agregado importado.
 */
export function combineDaySum(
  kind: string,
  imported: DaySum | undefined,
  derived: DerivedDay | undefined,
): { sum: DaySum; source: SumSource } {
  if (!derived || !EMPTY[kind]) return { sum: clone(imported) as DaySum, source: 'importado' };
  const result = imported ? clone(imported) : EMPTY[kind]();
  let usedRaw = 0;
  let usedImported = 0;
  for (const [name, c] of Object.entries(derived)) {
    if (c.weight >= importedWeight(name, imported)) {
      Object.assign(result, clone(c.fields));
      usedRaw++;
    } else {
      usedImported++;
    }
  }
  let source: SumSource;
  if (!imported || (usedImported === 0 && usedRaw > 0)) source = 'bruto';
  else if (usedRaw === 0) source = 'importado';
  else source = 'mixto';
  return { sum: result, source };
}

export interface FinalSums {
  sums: Record<string, Record<string, DaySum>>;
  sources: Record<string, Record<string, SumSource>>;
}

/** Agregados finales de un universo: unión de días importados y calculados. */
export function computeFinalSums(bestSums: SumData, raw: RawData): FinalSums {
  const derived = deriveSums(raw) as Record<string, Record<string, DerivedDay>>;
  const sums: FinalSums['sums'] = {};
  const sources: FinalSums['sources'] = {};
  for (const kind of SUM_KINDS) {
    const imported = bestSums[kind] || {};
    const der = derived[kind] || {};
    const days = sortDayKeys(new Set([...Object.keys(imported), ...Object.keys(der)]));
    sums[kind] = {};
    sources[kind] = {};
    for (const day of days) {
      const { sum, source } = combineDaySum(kind, imported[day], der[day]);
      sums[kind][day] = sum;
      sources[kind][day] = source;
    }
  }
  return { sums, sources };
}

// ---------------------------------------------------------------------------
// Construcción del .data fusionado
// ---------------------------------------------------------------------------

/**
 * Misma retención que OGI (cleanupMessages) para no exceder su almacenamiento:
 * expediciones y descubrimientos no favoritos y recolecciones, 5 días.
 * OGI no llega a purgar combates (compara un texto de segundos como fecha).
 */
export function keepForOgi(kind: string, rec: RawRecord, now: number): boolean {
  if (kind !== 'expeditions' && kind !== 'discoveries' && kind !== 'harvests') return true;
  if (kind !== 'harvests' && rec && rec.favorited) return true;
  const d = recordDate(kind, rec);
  return !d || now - d.getTime() <= 5 * DAY_MS;
}

export interface BuildOptions {
  /** Incluir todos los registros en bruto, no sólo los que conserva OGI. */
  fullHistory?: boolean;
  now?: number;
}

/**
 * Genera el .data fusionado de un universo.
 * @param snapshot datos completos de la exportación más reciente.
 * @param raw registros en bruto fusionados.
 * @param bestSums mejor agregado importado de cada día.
 */
export function buildMergedExport(
  snapshot: OgiExport,
  raw: RawData,
  bestSums: SumData,
  { fullHistory = false, now = Date.now() }: BuildOptions = {},
): OgiExport {
  const data = clone(snapshot);
  for (const kind of RAW_KINDS) {
    if (!(kind in data) && !raw[kind]) continue;
    const entries = Object.entries(raw[kind] || {})
      .filter(([, rec]) => fullHistory || keepForOgi(kind, rec, now))
      .sort(([a], [b]) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));
    data[kind] = Object.fromEntries(entries);
  }
  const { sums } = computeFinalSums(bestSums, raw);
  for (const kind of SUM_KINDS) {
    if (!(kind in data) && Object.keys(sums[kind]).length === 0) continue;
    data[kind] = sums[kind];
  }
  return data;
}
