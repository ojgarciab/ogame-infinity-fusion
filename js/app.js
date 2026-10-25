// Interfaz de OGI Fusion.
(function (global) {
  "use strict";

  const { buildMergedExport, computeFinalSums, exportFileName, hashText, parseExport, sortDayKeys } = global.OGIMerge;
  const {
    clearAll,
    deleteUniverse,
    findImportByHash,
    importExport,
    listImports,
    listUniverses,
    loadUniverse,
    requestPersistence,
    storageEstimate,
  } = global.OGIDb;

  const OGI_LIMIT_BYTES = 5 * 1024 * 1024;

  const $ = (sel) => document.querySelector(sel);
  const fmt = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
  const fmtCompact = new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 });
  const fmtDate = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" });
  const selected = new Set();

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v !== false && v !== undefined && v !== null) node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c);
    return node;
  }

  function log(listSel, cls, text) {
    $(listSel).prepend(el("li", { class: cls }, text));
  }

  function bytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function compact(n) {
    const s = fmtCompact.format(n);
    return n < 0 ? el("span", { class: "neg" }, s) : s;
  }

  // ---------------------------------------------------------------------------
  // Importación
  // ---------------------------------------------------------------------------

  async function importFiles(files) {
    for (const file of files) {
      try {
        const text = await file.text();
        const hash = hashText(text);
        if (await findImportByHash(hash)) {
          log("#log", "warn", `${file.name}: ya importado anteriormente, se omite.`);
          continue;
        }
        const parsed = parseExport(text);
        const s = await importExport(parsed, { fileName: file.name, hash });
        log(
          "#log",
          "ok",
          `${file.name} → ${parsed.host} (jugador ${parsed.data.playerId}): ` +
            `${s.newRecords} registros nuevos, ${s.updatedRecords} actualizados, ` +
            `${s.newDays} días de agregados nuevos, ${s.betterDays} mejorados` +
            (s.snapshot ? "; es la exportación más reciente." : "; hay una exportación más reciente."),
        );
      } catch (e) {
        console.error(e);
        log("#log", "err", `${file.name}: ${e.message}`);
      }
    }
    await render();
  }

  function setupImport() {
    const input = $("#file");
    const drop = $("#drop");
    input.addEventListener("change", async () => {
      const files = [...input.files];
      input.value = "";
      await importFiles(files);
    });
    for (const ev of ["dragenter", "dragover"]) {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add("over");
      });
    }
    for (const ev of ["dragleave", "drop"]) {
      drop.addEventListener(ev, () => drop.classList.remove("over"));
    }
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      importFiles([...e.dataTransfer.files]);
    });
  }

  // ---------------------------------------------------------------------------
  // Listado de universos
  // ---------------------------------------------------------------------------

  function dayRange(map) {
    const days = sortDayKeys(Object.keys(map || {}));
    return days.length ? `${days[0]} – ${days[days.length - 1]} (${days.length})` : "—";
  }

  async function render() {
    const universes = await listUniverses();
    const tbody = $("#universes tbody");
    tbody.replaceChildren();
    $("#empty").hidden = universes.length > 0;
    for (const id of [...selected]) if (!universes.some((u) => u.id === id)) selected.delete(id);

    for (const uni of universes) {
      const { raw, bestSums } = await loadUniverse(uni.id);
      const days = new Set([
        ...Object.keys(bestSums.expeditionSums || {}),
        ...Object.keys(bestSums.combatsSums || {}),
        ...Object.keys(bestSums.discoveriesSums || {}),
      ]);
      const cb = el("input", {
        type: "checkbox",
        checked: selected.has(uni.id),
        onchange: (e) => {
          if (e.target.checked) selected.add(uni.id);
          else selected.delete(uni.id);
          updateButtons(universes);
        },
      });
      tbody.append(
        el(
          "tr",
          {},
          el("td", {}, cb),
          el("td", {}, uni.host),
          el("td", {}, String(uni.playerId)),
          el("td", {}, uni.exportedAt ? fmtDate.format(new Date(uni.exportedAt)) : "—"),
          el("td", { class: "num" }, String(uni.importCount)),
          el("td", { class: "num" }, fmt.format(Object.keys(raw.expeditions || {}).length)),
          el("td", { class: "num" }, fmt.format(Object.keys(raw.combats || {}).length)),
          el("td", {}, dayRange(Object.fromEntries([...days].map((d) => [d, 1])))),
          el(
            "td",
            {},
            el(
              "div",
              { class: "actions" },
              el("button", { class: "btn small", type: "button", onclick: () => showDetail(uni.id) }, "Detalle"),
              el(
                "button",
                { class: "btn small", type: "button", onclick: () => exportUniverses([uni.id]) },
                "Exportar",
              ),
              el(
                "button",
                {
                  class: "btn small danger",
                  type: "button",
                  onclick: async () => {
                    if (!confirm(`¿Eliminar todos los datos de ${uni.host} (jugador ${uni.playerId})?`)) return;
                    await deleteUniverse(uni.id);
                    selected.delete(uni.id);
                    $("#detail").hidden = true;
                    await render();
                  },
                },
                "Eliminar",
              ),
            ),
          ),
        ),
      );
    }
    updateButtons(universes);
    await renderStorage();
  }

  function updateButtons(universes) {
    $("#export").disabled = selected.size === 0;
    const all = $("#select-all");
    all.checked = universes.length > 0 && selected.size === universes.length;
    all.indeterminate = selected.size > 0 && selected.size < universes.length;
  }

  async function renderStorage() {
    const est = await storageEstimate();
    $("#storage").textContent = est ? `Almacenamiento usado: ${bytes(est.usage || 0)}` : "";
  }

  // ---------------------------------------------------------------------------
  // Exportación
  // ---------------------------------------------------------------------------

  function download(text, fileName) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = el("a", { href: url, download: fileName });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function exportUniverses(ids) {
    const fullHistory = $("#full-history").checked;
    for (const id of ids) {
      try {
        const { universe, raw, bestSums } = await loadUniverse(id);
        const data = buildMergedExport(universe.snapshot, raw, bestSums, { fullHistory });
        const text = JSON.stringify(data);
        const name = exportFileName(universe.universeUrl);
        download(text, name);
        const size = new Blob([text]).size;
        const tooBig = size > OGI_LIMIT_BYTES * 0.9;
        log(
          "#export-log",
          tooBig ? "warn" : "ok",
          `${name} (${universe.host}, jugador ${universe.playerId}): ${bytes(size)}` +
            (tooBig ? " — puede superar el límite de almacenamiento de OGI." : ""),
        );
        // Pequeña pausa para que el navegador no bloquee descargas múltiples.
        await new Promise((r) => setTimeout(r, 400));
      } catch (e) {
        console.error(e);
        log("#export-log", "err", `${id}: ${e.message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Detalle de un universo
  // ---------------------------------------------------------------------------

  function stat(label, value) {
    return el("div", { class: "stat" }, el("b", {}, value), el("span", {}, label));
  }

  function sourceTag(source) {
    return source ? el("span", { class: `tag ${source}` }, source) : "";
  }

  async function showDetail(id) {
    const { universe, raw, bestSums } = await loadUniverse(id);
    const imports = await listImports(id);
    const { sums, sources } = computeFinalSums(bestSums, raw);
    const exp = sums.expeditionSums;
    const com = sums.combatsSums;
    const dis = sums.discoveriesSums;
    const days = sortDayKeys(new Set([...Object.keys(exp), ...Object.keys(com), ...Object.keys(dis)])).reverse();

    const totals = { exps: 0, found: [0, 0, 0, 0], combats: 0, loot: [0, 0, 0] };
    for (const s of Object.values(exp)) {
      totals.exps += Object.values(s.type || {}).reduce((a, b) => a + b, 0);
      (s.found || []).forEach((v, i) => (totals.found[i] += v || 0));
    }
    for (const s of Object.values(com)) {
      totals.combats += s.count || 0;
      (s.loot || []).forEach((v, i) => (totals.loot[i] += v || 0));
    }

    const rows = days.map((day) => {
      const e = exp[day];
      const c = com[day];
      const d = dis[day];
      const expCount = e ? Object.values(e.type || {}).reduce((a, b) => a + b, 0) : 0;
      const f = (e && e.found) || [0, 0, 0, 0];
      const l = (c && c.loot) || [0, 0, 0];
      const disCount = d ? Object.values(d.type || {}).reduce((a, b) => a + b, 0) : 0;
      return el(
        "tr",
        {},
        el("td", {}, day),
        el("td", { class: "num" }, e ? fmt.format(expCount) : "—"),
        el("td", {}, sourceTag(sources.expeditionSums[day])),
        el("td", { class: "num" }, compact(f[0])),
        el("td", { class: "num" }, compact(f[1])),
        el("td", { class: "num" }, compact(f[2])),
        el("td", { class: "num" }, compact(f[3] || 0)),
        el("td", { class: "num" }, c ? fmt.format(c.count || 0) : "—"),
        el("td", {}, sourceTag(sources.combatsSums[day])),
        el("td", { class: "num" }, compact(l[0])),
        el("td", { class: "num" }, compact(l[1])),
        el("td", { class: "num" }, compact(l[2])),
        el("td", { class: "num" }, d ? fmt.format(disCount) : "—"),
        el("td", {}, sourceTag(sources.discoveriesSums[day])),
      );
    });

    $("#detail-title").textContent = `${universe.host} · jugador ${universe.playerId}`;
    $("#detail-body").replaceChildren(
      el(
        "div",
        { class: "stats" },
        stat("Expediciones (agregado)", fmt.format(totals.exps)),
        stat(
          "Metal / Cristal / Deut. encontrados",
          `${fmtCompact.format(totals.found[0])} / ${fmtCompact.format(totals.found[1])} / ${fmtCompact.format(totals.found[2])}`,
        ),
        stat("Materia oscura encontrada", fmt.format(totals.found[3])),
        stat("Combates (agregado)", fmt.format(totals.combats)),
        stat(
          "Botín M / C / D",
          `${fmtCompact.format(totals.loot[0])} / ${fmtCompact.format(totals.loot[1])} / ${fmtCompact.format(totals.loot[2])}`,
        ),
        stat("Expediciones en bruto", fmt.format(Object.keys(raw.expeditions || {}).length)),
        stat("Combates en bruto", fmt.format(Object.keys(raw.combats || {}).length)),
        stat("Recolecciones en bruto", fmt.format(Object.keys(raw.harvests || {}).length)),
      ),
      el("h3", {}, "Agregados diarios fusionados"),
      el(
        "div",
        { class: "table-wrap scroll" },
        el(
          "table",
          {},
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              ...[
                "Día",
                "Exped.",
                "Origen",
                "Metal",
                "Cristal",
                "Deut.",
                "MO",
                "Combates",
                "Origen",
                "Botín M",
                "Botín C",
                "Botín D",
                "Descubr.",
                "Origen",
              ].map((h, i) => el("th", { class: [1, 3, 4, 5, 6, 7, 9, 10, 11, 12].includes(i) ? "num" : "" }, h)),
            ),
          ),
          el("tbody", {}, rows),
        ),
      ),
      el("h3", {}, "Archivos importados"),
      el(
        "div",
        { class: "table-wrap" },
        el(
          "table",
          {},
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              el("th", {}, "Archivo"),
              el("th", {}, "Importado"),
              el("th", {}, "Exportado (aprox.)"),
              el("th", {}, "Aportó"),
            ),
          ),
          el(
            "tbody",
            {},
            imports.map((imp) =>
              el(
                "tr",
                {},
                el("td", {}, imp.fileName),
                el("td", {}, fmtDate.format(new Date(imp.importedAt))),
                el("td", {}, imp.exportedAt ? fmtDate.format(new Date(imp.exportedAt)) : "—"),
                el(
                  "td",
                  {},
                  `${imp.stats.newRecords} nuevos, ${imp.stats.updatedRecords} actualizados, ` +
                    `${imp.stats.newDays + imp.stats.betterDays} días de agregados`,
                ),
              ),
            ),
          ),
        ),
      ),
    );
    $("#detail").hidden = false;
    $("#detail").scrollIntoView({ behavior: "smooth" });
  }

  // ---------------------------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------------------------

  async function init() {
    if (!("indexedDB" in window)) {
      log("#log", "err", "Este navegador no soporta IndexedDB.");
      return;
    }
    setupImport();
    $("#export").addEventListener("click", () => exportUniverses([...selected]));
    $("#select-all").addEventListener("change", async (e) => {
      const universes = await listUniverses();
      selected.clear();
      if (e.target.checked) universes.forEach((u) => selected.add(u.id));
      await render();
    });
    $("#detail-close").addEventListener("click", () => ($("#detail").hidden = true));
    $("#clear").addEventListener("click", async () => {
      if (!confirm("¿Borrar todos los datos almacenados en este navegador?")) return;
      await clearAll();
      selected.clear();
      $("#detail").hidden = true;
      await render();
    });
    requestPersistence();
    await render();
  }

  init().catch((e) => {
    console.error(e);
    log("#log", "err", e.message);
  });
})(globalThis);
