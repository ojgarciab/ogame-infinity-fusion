// Lógica pura de fusión de exportaciones de OGame Infinity (OGI).
// Sin dependencias del navegador: se usa tanto en la app como en los tests de Node.
// Se carga como script clásico (funciona abriendo index.html con file://) y
// expone sus funciones en globalThis.OGIMerge.
(function (global) {
  "use strict";

  // Claves con registros en bruto: mapas { idMensaje: registro }.
  const RAW_KINDS = ["expeditions", "combats", "harvests", "discoveries", "trades", "spies"];
  // Claves con agregados diarios: mapas { "DD.MM.YY": agregado }.
  const SUM_KINDS = ["expeditionSums", "combatsSums", "discoveriesSums", "tradesSums"];

  const DAY_MS = 24 * 60 * 60 * 1000;
  const EXPEDITION_POSITION = 16;
  const FOUND_RESULTS = { Metal: true, Crystal: true, Deuterium: true, AM: true };

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  // Igualdad estructural sin depender del orden de las claves.
  function sameData(a, b) {
    const norm = (v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, norm(v[k])]),
          )
        : Array.isArray(v)
          ? v.map(norm)
          : v;
    return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
  }

  // Hash no criptográfico (cyrb53) para detectar archivos ya importados.
  function hashText(text) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
  }

  // Clave de día igual que OGI: fecha local del navegador en formato DD.MM.YY.
  function dayKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    return [
      String(d.getDate()).padStart(2, "0"),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getFullYear()).slice(2),
    ].join(".");
  }

  function dayKeyToDate(key) {
    const [dd, mm, yy] = key.split(".").map(Number);
    return new Date(2000 + yy, mm - 1, dd);
  }

  function sortDayKeys(keys) {
    return [...keys].sort((a, b) => dayKeyToDate(a) - dayKeyToDate(b));
  }

  // Fecha de un registro en bruto (los combates guardan segundos Unix en texto).
  function recordDate(kind, record) {
    if (!record || typeof record !== "object") return null;
    let d = null;
    if (kind === "combats" && record.timestamp !== undefined) d = new Date(Number(record.timestamp) * 1000);
    else if (record.date) d = new Date(record.date);
    return d && !isNaN(d) ? d : null;
  }

  function sumValues(obj) {
    if (!obj) return 0;
    return Object.values(obj).reduce((acc, v) => acc + (Number(v) || 0), 0);
  }

  function sumAbs(arr) {
    if (!arr) return 0;
    return Object.values(arr).reduce((acc, v) => acc + Math.abs(Number(v) || 0), 0);
  }

  function addInto(target, source) {
    for (const [k, v] of Object.entries(source || {})) target[k] = (target[k] || 0) + (Number(v) || 0);
  }

  // Suma de valores absolutos de todos los números de una estructura (desempate).
  function magnitude(value) {
    if (typeof value === "number") return Math.abs(value);
    if (value && typeof value === "object") return Object.values(value).reduce((a, v) => a + magnitude(v), 0);
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Lectura de exportaciones
  // ---------------------------------------------------------------------------

  function universeIdOf(data) {
    return `${data.universeUrl}#${data.playerId}`;
  }

  // "https://s275-es.ogame.gameforge.com" -> { universe: "275", lang: "es" }
  function universeInfo(universeUrl) {
    let host = String(universeUrl || "");
    try {
      host = new URL(universeUrl).host;
    } catch (_) {
      /* se usa el texto tal cual */
    }
    const m = host.match(/^s(\d+)-([a-z]+)\./i);
    return {
      host,
      universe: m ? m[1] : host.split(".")[0].replace(/\D/g, ""),
      lang: m ? m[2].toLowerCase() : "xx",
    };
  }

  // Momento aproximado de la exportación: lo más reciente entre la última
  // actualización del imperio y la fecha del último registro en bruto.
  function exportTimestamp(data) {
    let best = 0;
    const t = Date.parse(data.lastEmpireUpdate);
    if (!isNaN(t)) best = t;
    for (const kind of RAW_KINDS) {
      for (const rec of Object.values(data[kind] || {})) {
        const d = recordDate(kind, rec);
        if (d && d.getTime() > best) best = d.getTime();
      }
    }
    return best;
  }

  function parseExport(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("El archivo no es un JSON válido.");
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || !data.universeUrl || data.playerId === undefined) {
      throw new Error("No parece una exportación de OGame Infinity (faltan universeUrl/playerId).");
    }
    return {
      data,
      universeId: universeIdOf(data),
      exportedAt: exportTimestamp(data),
      ...universeInfo(data.universeUrl),
    };
  }

  function exportFileName(universeUrl) {
    const { lang, universe } = universeInfo(universeUrl);
    return `oginfinity-${lang}-${universe}.data`;
  }

  // ---------------------------------------------------------------------------
  // Elección del agregado importado "más alto"
  // ---------------------------------------------------------------------------

  // Puntuación de un agregado diario: [nº de eventos contados, magnitud total].
  function sumScore(kind, sum) {
    if (!sum || typeof sum !== "object") return [0, 0];
    let events;
    if (kind === "combatsSums") events = Number(sum.count) || 0;
    else if (kind === "expeditionSums" || kind === "discoveriesSums") events = sumValues(sum.type);
    else events = JSON.stringify(sum).length;
    return [events, magnitude(sum)];
  }

  // ¿El candidato a (exportado en ax) es mejor que b (exportado en bx)?
  function isBetterSum(kind, a, ax, b, bx) {
    if (!b) return true;
    const [ae, am] = sumScore(kind, a);
    const [be, bm] = sumScore(kind, b);
    if (ae !== be) return ae > be;
    if (am !== bm) return am > bm;
    return (ax || 0) >= (bx || 0);
  }

  // ---------------------------------------------------------------------------
  // Fusión de registros en bruto
  // ---------------------------------------------------------------------------

  // ¿Debe el registro entrante (exportado en inX) sustituir al existente?
  function isNewerRecord(inX, existing) {
    return !existing || (inX || 0) >= (existing.x || 0);
  }

  // ---------------------------------------------------------------------------
  // Agregados calculados a partir de los registros en bruto
  // ---------------------------------------------------------------------------

  function emptyExpeditionSum() {
    return { found: [0, 0, 0, 0], harvest: [0, 0, 0], losses: {}, fleet: {}, type: {}, adjust: [0, 0, 0], fuel: 0 };
  }

  function emptyCombatSum() {
    return {
      loot: [0, 0, 0],
      harvest: [0, 0, 0],
      losses: {},
      fuel: 0,
      adjust: [0, 0, 0],
      topCombats: [],
      count: 0,
      wins: 0,
      draws: 0,
    };
  }

  function emptyDiscoverySum() {
    return { found: [0, 0, 0, 0], artefacts: 0, type: {} };
  }

  const EMPTY = { expeditionSums: emptyExpeditionSum, combatsSums: emptyCombatSum, discoveriesSums: emptyDiscoverySum };

  // Reproduce lo que OGI acumula al leer cada mensaje. Devuelve, por tipo y día,
  // "componentes" independientes: cada uno con sus campos y su peso (cuánta
  // información contiene) para compararlo con el agregado importado.
  //   raw: { expeditions: {id: rec}, combats: {...}, harvests: {...}, discoveries: {...} }
  function deriveSums(raw) {
    const out = { expeditionSums: {}, combatsSums: {}, discoveriesSums: {} };
    const comp = (kind, day, name, init) => {
      out[kind][day] = out[kind][day] || {};
      if (!out[kind][day][name]) out[kind][day][name] = init();
      return out[kind][day][name];
    };

    for (const rec of Object.values(raw.expeditions || {})) {
      const d = recordDate("expeditions", rec);
      if (!d || !rec.result) continue;
      const c = comp("expeditionSums", dayKey(d), "events", () => ({
        weight: 0,
        fields: { found: [0, 0, 0, 0], type: {} },
      }));
      c.fields.type[rec.result] = (c.fields.type[rec.result] || 0) + 1;
      c.weight += 1;
      if (FOUND_RESULTS[rec.result] && Array.isArray(rec.amount)) {
        rec.amount.slice(0, 4).forEach((v, i) => (c.fields.found[i] += Number(v) || 0));
      }
    }

    // Combates: se ordenan por fecha para deduplicar por hashcode como OGI.
    const combats = Object.values(raw.combats || {})
      .map((rec) => ({ rec, d: recordDate("combats", rec) }))
      .filter((x) => x.d)
      .sort((a, b) => a.d - b.d);
    const seenHash = new Set();
    for (const { rec, d } of combats) {
      const day = dayKey(d);
      if (rec.coordinates && Number(rec.coordinates.position) === EXPEDITION_POSITION) {
        const c = comp("expeditionSums", day, "losses", () => ({ weight: 0, fields: { losses: {} } }));
        addInto(c.fields.losses, rec.losses);
        c.weight += sumValues(rec.losses);
        continue;
      }
      if (rec.hashcode) {
        if (seenHash.has(rec.hashcode)) continue;
        seenHash.add(rec.hashcode);
      }
      if (rec.isProbes) continue;
      const c = comp("combatsSums", day, "combat", () => ({
        weight: 0,
        fields: { loot: [0, 0, 0], losses: {}, count: 0, wins: 0, draws: 0 },
      }));
      c.fields.count += 1;
      if (rec.win) c.fields.wins += 1;
      if (rec.draw) c.fields.draws += 1;
      (rec.loot || []).slice(0, 3).forEach((v, i) => (c.fields.loot[i] += Number(v) || 0));
      addInto(c.fields.losses, rec.losses);
      c.weight += 1;
    }

    for (const rec of Object.values(raw.harvests || {})) {
      const d = recordDate("harvests", rec);
      if (!d) continue;
      const pos = Number(String(rec.coords || "").split(":")[2]);
      const kind = pos === EXPEDITION_POSITION ? "expeditionSums" : "combatsSums";
      const c = comp(kind, dayKey(d), "harvest", () => ({ weight: 0, fields: { harvest: [0, 0, 0] } }));
      const res = [rec.metal, rec.crystal, rec.deuterium].map((v) => Number(v) || 0);
      res.forEach((v, i) => (c.fields.harvest[i] += v));
      c.weight += res[0] + res[1] + res[2];
    }

    for (const rec of Object.values(raw.discoveries || {})) {
      const d = recordDate("discoveries", rec);
      if (!d || !rec.result) continue;
      const c = comp("discoveriesSums", dayKey(d), "events", () => ({
        weight: 0,
        fields: { found: [0, 0, 0, 0], artefacts: 0, type: {} },
      }));
      c.fields.type[rec.result] = (c.fields.type[rec.result] || 0) + 1;
      c.weight += 1;
      const lf = String(rec.result).match(/^lifeform(\d)$/);
      if (lf) c.fields.found[Number(lf[1]) - 1] += Number(rec.amount) || 0;
      else if (rec.result === "artefacts") c.fields.artefacts += Number(rec.amount) || 0;
    }

    return out;
  }

  // Peso del mismo componente dentro de un agregado importado.
  function importedWeight(kind, name, sum) {
    if (!sum) return -1;
    if (name === "events") return sumValues(sum.type);
    if (name === "losses") return sumValues(sum.losses);
    if (name === "harvest") return sumAbs(sum.harvest);
    if (name === "combat") return Number(sum.count) || 0;
    return 0;
  }

  // Combina el mejor agregado importado con lo calculado desde los registros en
  // bruto: cada componente calculado sustituye al importado sólo si contiene al
  // menos la misma información (si OGI ya purgó parte del día, gana lo importado).
  // Los campos no reconstruibles (combustible, naves encontradas, agujeros
  // negros, top de combates, ajustes) se conservan del agregado importado.
  // Devuelve { sum, source } con source = "importado" | "bruto" | "mixto".
  function combineDaySum(kind, imported, derivedComponents) {
    if (!derivedComponents || !EMPTY[kind]) return { sum: clone(imported), source: "importado" };
    const result = imported ? clone(imported) : EMPTY[kind]();
    let usedRaw = 0;
    let usedImported = 0;
    for (const [name, c] of Object.entries(derivedComponents)) {
      if (c.weight >= importedWeight(kind, name, imported)) {
        Object.assign(result, clone(c.fields));
        usedRaw++;
      } else {
        usedImported++;
      }
    }
    let source;
    if (!imported) source = "bruto";
    else if (usedImported === 0 && usedRaw > 0) source = "bruto";
    else if (usedRaw === 0) source = "importado";
    else source = "mixto";
    return { sum: result, source };
  }

  // Agregados finales de un universo: unión de días importados y calculados.
  //   bestSums: { expeditionSums: {day: sum}, ... }   (mejor agregado importado)
  //   raw:      { expeditions: {id: rec}, ... }        (registros fusionados)
  // Devuelve { sums: {kind: {day: sum}}, sources: {kind: {day: source}} }.
  function computeFinalSums(bestSums, raw) {
    const derived = deriveSums(raw);
    const sums = {};
    const sources = {};
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

  // Misma retención que OGI (cleanupMessages) para no exceder su almacenamiento:
  // expediciones y descubrimientos no favoritos y recolecciones: 5 días.
  // OGI no llega a purgar combates (compara un texto de segundos como fecha).
  function keepForOgi(kind, rec, now) {
    if (kind !== "expeditions" && kind !== "discoveries" && kind !== "harvests") return true;
    if (kind !== "harvests" && rec && rec.favorited) return true;
    const d = recordDate(kind, rec);
    return !d || now - d.getTime() <= 5 * DAY_MS;
  }

  // snapshot: datos completos de la exportación más reciente.
  // raw: { kind: {id: rec} } fusionados.  bestSums: { kind: {day: sum} }.
  function buildMergedExport(snapshot, raw, bestSums, { fullHistory = false, now = Date.now() } = {}) {
    const data = clone(snapshot);
    for (const kind of RAW_KINDS) {
      if (!(kind in data) && !raw[kind]) continue;
      const entries = Object.entries(raw[kind] || {})
        .filter(([, rec]) => fullHistory || keepForOgi(kind, rec, now))
        .sort(([a], [b]) => (Number(a) || 0) - (Number(b) || 0) || String(a).localeCompare(String(b)));
      data[kind] = Object.fromEntries(entries);
    }
    const { sums } = computeFinalSums(bestSums, raw);
    for (const kind of SUM_KINDS) {
      if (!(kind in data) && Object.keys(sums[kind]).length === 0) continue;
      data[kind] = sums[kind];
    }
    return data;
  }

  global.OGIMerge = {
    RAW_KINDS,
    SUM_KINDS,
    clone,
    sameData,
    hashText,
    dayKey,
    dayKeyToDate,
    sortDayKeys,
    recordDate,
    universeIdOf,
    universeInfo,
    exportTimestamp,
    parseExport,
    exportFileName,
    sumScore,
    isBetterSum,
    isNewerRecord,
    deriveSums,
    combineDaySum,
    computeFinalSums,
    keepForOgi,
    buildMergedExport,
  };
})(globalThis);
