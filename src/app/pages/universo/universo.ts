import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, resource } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DbService, ImportRecord, LoadedUniverse } from '../../core/db.service';
import { DaySum, SumSource, computeFinalSums, sortDayKeys } from '../../core/merge';
import { CompactPipe } from '../../shared/compact.pipe';

interface DayRow {
  day: string;
  expeditions: number | null;
  expSource?: SumSource;
  found: number[];
  combats: number | null;
  comSource?: SumSource;
  loot: number[];
  discoveries: number | null;
  disSource?: SumSource;
}

interface Detail {
  loaded: LoadedUniverse;
  imports: ImportRecord[];
  rows: DayRow[];
  totals: { expeditions: number; found: number[]; combats: number; loot: number[] };
}

const countTypes = (s: DaySum | undefined) =>
  s ? Object.values(s.type || {}).reduce((a, b) => a + (Number(b) || 0), 0) : null;

@Component({
  selector: 'app-universo',
  imports: [RouterLink, DatePipe, DecimalPipe, CompactPipe],
  templateUrl: './universo.html',
  styleUrl: './universo.scss',
})
export class Universo {
  private readonly db = inject(DbService);
  private readonly router = inject(Router);

  /** Parámetro de ruta :slug. */
  readonly slug = input.required<string>();

  protected readonly dbReady = this.db.ready;

  protected readonly summary = computed(() =>
    this.db.universes().find((u) => u.slug === this.slug()),
  );

  protected readonly detail = resource({
    params: () => this.summary(),
    loader: async ({ params: summary }): Promise<Detail | null> => {
      const loaded = await this.db.loadUniverse(summary.id);
      if (!loaded) return null;
      const imports = await this.db.listImports(summary.id);
      return { loaded, imports, ...this.buildRows(loaded) };
    },
  });

  protected readonly rawCounts = computed(() => {
    const raw = this.detail.value()?.loaded.raw ?? {};
    const n = (k: string) => Object.keys(raw[k] ?? {}).length;
    return {
      expeditions: n('expeditions'),
      combats: n('combats'),
      harvests: n('harvests'),
      discoveries: n('discoveries'),
    };
  });

  protected async remove(): Promise<void> {
    const s = this.summary();
    if (!s || !confirm(`¿Eliminar todos los datos de ${s.host} (jugador ${s.playerId})?`)) return;
    await this.db.deleteUniverse(s.id);
    await this.router.navigateByUrl('/');
  }

  private buildRows({ raw, bestSums }: LoadedUniverse): Pick<Detail, 'rows' | 'totals'> {
    const { sums, sources } = computeFinalSums(bestSums, raw);
    const exp = sums['expeditionSums'];
    const com = sums['combatsSums'];
    const dis = sums['discoveriesSums'];
    const totals = { expeditions: 0, found: [0, 0, 0, 0], combats: 0, loot: [0, 0, 0] };
    const days = sortDayKeys(
      new Set([...Object.keys(exp), ...Object.keys(com), ...Object.keys(dis)]),
    ).reverse();
    const rows = days.map((day): DayRow => {
      const e = exp[day];
      const c = com[day];
      const found = [0, 1, 2, 3].map((i) => Number(e?.found?.[i]) || 0);
      const loot = [0, 1, 2].map((i) => Number(c?.loot?.[i]) || 0);
      const expeditions = countTypes(e);
      totals.expeditions += expeditions ?? 0;
      totals.combats += Number(c?.count) || 0;
      found.forEach((v, i) => (totals.found[i] += v));
      loot.forEach((v, i) => (totals.loot[i] += v));
      return {
        day,
        expeditions,
        expSource: sources['expeditionSums'][day],
        found,
        combats: c ? Number(c.count) || 0 : null,
        comSource: sources['combatsSums'][day],
        loot,
        discoveries: countTypes(dis[day]),
        disSource: sources['discoveriesSums'][day],
      };
    });
    return { rows, totals };
  }
}
