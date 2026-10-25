// Almacenamiento local en IndexedDB.
//   universes: un registro por universo+jugador con la exportación más reciente.
//   imports:   historial de archivos importados.
//   records:   registros en bruto fusionados  [u, k, id] -> { d: datos, x: fecha de exportación }
//   sums:      mejor agregado diario importado [u, k, day] -> { d: datos, x: fecha de exportación }
(function (global) {
  "use strict";

  const { RAW_KINDS, SUM_KINDS, isBetterSum, isNewerRecord, sameData } = global.OGIMerge;

  const DB_NAME = "ogi-fusion";
  const DB_VERSION = 1;

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("universes", { keyPath: "id" });
        const imports = db.createObjectStore("imports", { keyPath: "id", autoIncrement: true });
        imports.createIndex("u", "u");
        imports.createIndex("hash", "hash");
        const records = db.createObjectStore("records", { keyPath: ["u", "k", "id"] });
        records.createIndex("uk", ["u", "k"]);
        records.createIndex("u", "u");
        const sums = db.createObjectStore("sums", { keyPath: ["u", "k", "day"] });
        sums.createIndex("uk", ["u", "k"]);
        sums.createIndex("u", "u");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("La base de datos está bloqueada por otra pestaña."));
    });
    return dbPromise;
  }

  function promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transacción abortada"));
    });
  }

  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
    } catch (_) {
      /* no disponible */
    }
    return false;
  }

  async function storageEstimate() {
    try {
      if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
    } catch (_) {
      /* no disponible */
    }
    return null;
  }

  async function findImportByHash(hash) {
    const db = await openDb();
    const tx = db.transaction("imports");
    return promisify(tx.objectStore("imports").index("hash").get(hash));
  }

  // Integra una exportación ya analizada (resultado de parseExport).
  async function importExport(parsed, { fileName, hash }) {
    const db = await openDb();
    const tx = db.transaction(["universes", "imports", "records", "sums"], "readwrite");
    const finished = done(tx);
    const u = parsed.universeId;
    const x = parsed.exportedAt;
    const data = parsed.data;
    const stats = { newRecords: 0, updatedRecords: 0, newDays: 0, betterDays: 0, snapshot: false };

    const universes = tx.objectStore("universes");
    const existing = await promisify(universes.get(u));
    const now = Date.now();
    const uni = existing || {
      id: u,
      universeUrl: data.universeUrl,
      playerId: data.playerId,
      lang: parsed.lang,
      universe: parsed.universe,
      host: parsed.host,
      firstImportAt: now,
      importCount: 0,
      exportedAt: 0,
    };
    uni.importCount += 1;
    uni.lastImportAt = now;
    if (!existing || x >= existing.exportedAt) {
      uni.snapshot = data;
      uni.exportedAt = x;
      stats.snapshot = true;
    }
    universes.put(uni);

    const records = tx.objectStore("records");
    for (const k of RAW_KINDS) {
      const incoming = data[k];
      if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) continue;
      const current = await promisify(records.index("uk").getAll([u, k]));
      const byId = new Map(current.map((r) => [r.id, r]));
      for (const [id, rec] of Object.entries(incoming)) {
        const old = byId.get(id);
        if (!old) stats.newRecords++;
        else if (!isNewerRecord(x, old) || sameData(old.d, rec)) continue;
        else stats.updatedRecords++;
        records.put({ u, k, id, d: rec, x });
      }
    }

    const sums = tx.objectStore("sums");
    for (const k of SUM_KINDS) {
      const incoming = data[k];
      if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) continue;
      const current = await promisify(sums.index("uk").getAll([u, k]));
      const byDay = new Map(current.map((r) => [r.day, r]));
      for (const [day, sum] of Object.entries(incoming)) {
        const old = byDay.get(day);
        if (old && !isBetterSum(k, sum, x, old.d, old.x)) continue;
        if (old && sameData(old.d, sum)) continue;
        if (old) stats.betterDays++;
        else stats.newDays++;
        sums.put({ u, k, day, d: sum, x });
      }
    }

    tx.objectStore("imports").add({ u, fileName, hash, importedAt: now, exportedAt: x, stats });
    await finished;
    return stats;
  }

  async function listUniverses() {
    const db = await openDb();
    const tx = db.transaction("universes");
    const all = await promisify(tx.objectStore("universes").getAll());
    return all.sort((a, b) => String(a.host).localeCompare(String(b.host)) || a.playerId - b.playerId);
  }

  async function listImports(u) {
    const db = await openDb();
    const tx = db.transaction("imports");
    const all = await promisify(tx.objectStore("imports").index("u").getAll(u));
    return all.sort((a, b) => b.importedAt - a.importedAt);
  }

  // Carga todo lo necesario para exportar un universo.
  async function loadUniverse(u) {
    const db = await openDb();
    const tx = db.transaction(["universes", "records", "sums"]);
    const uni = await promisify(tx.objectStore("universes").get(u));
    const raw = {};
    const recs = await promisify(tx.objectStore("records").index("u").getAll(u));
    for (const r of recs) (raw[r.k] = raw[r.k] || {})[r.id] = r.d;
    const bestSums = {};
    const sums = await promisify(tx.objectStore("sums").index("u").getAll(u));
    for (const s of sums) (bestSums[s.k] = bestSums[s.k] || {})[s.day] = s.d;
    return { universe: uni, raw, bestSums };
  }

  async function deleteUniverse(u) {
    const db = await openDb();
    const tx = db.transaction(["universes", "imports", "records", "sums"], "readwrite");
    const finished = done(tx);
    tx.objectStore("universes").delete(u);
    for (const store of ["imports", "records", "sums"]) {
      const keys = await promisify(tx.objectStore(store).index("u").getAllKeys(u));
      for (const key of keys) tx.objectStore(store).delete(key);
    }
    await finished;
  }

  async function clearAll() {
    const db = await openDb();
    const tx = db.transaction(["universes", "imports", "records", "sums"], "readwrite");
    const finished = done(tx);
    for (const store of ["universes", "imports", "records", "sums"]) tx.objectStore(store).clear();
    await finished;
  }

  global.OGIDb = {
    openDb,
    requestPersistence,
    storageEstimate,
    findImportByHash,
    importExport,
    listUniverses,
    listImports,
    loadUniverse,
    deleteUniverse,
    clearAll,
  };
})(globalThis);
