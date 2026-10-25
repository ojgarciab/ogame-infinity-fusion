import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DbService } from '../../core/db.service';
import { ExportResult, ExportService } from '../../core/export.service';
import { BytesPipe } from '../../shared/bytes.pipe';

interface ExportLogEntry {
  level: 'ok' | 'warn' | 'err';
  text: string;
}

@Component({
  selector: 'app-exportar',
  imports: [RouterLink, DatePipe, DecimalPipe],
  templateUrl: './exportar.html',
  styleUrl: './exportar.scss',
})
export class Exportar {
  protected readonly db = inject(DbService);
  private readonly exporter = inject(ExportService);

  /** Parámetro ?u=slug para preseleccionar un universo. */
  readonly u = input<string>();

  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly fullHistory = signal(false);
  protected readonly busy = signal(false);
  protected readonly log = signal<ExportLogEntry[]>([]);

  protected readonly allSelected = computed(() => {
    const list = this.db.universes();
    return list.length > 0 && list.every((u) => this.selected().has(u.id));
  });

  constructor() {
    // Preselección desde la URL cuando el listado está disponible.
    effect(() => {
      const slug = this.u();
      const match = this.db.universes().find((x) => x.slug === slug);
      if (match) this.selected.update((s) => new Set(s).add(match.id));
    });
  }

  protected toggle(id: string, checked: boolean): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  protected toggleAll(checked: boolean): void {
    this.selected.set(new Set(checked ? this.db.universes().map((u) => u.id) : []));
  }

  protected async export(): Promise<void> {
    const ids = this.db
      .universes()
      .filter((u) => this.selected().has(u.id))
      .map((u) => u.id);
    this.busy.set(true);
    try {
      for (const id of ids) {
        try {
          this.addLog(this.describe(await this.exporter.exportUniverse(id, this.fullHistory())));
        } catch (e) {
          console.error(e);
          this.addLog({ level: 'err', text: `${id}: ${e instanceof Error ? e.message : e}` });
        }
        // Pausa breve para que el navegador no bloquee las descargas múltiples.
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      this.busy.set(false);
    }
  }

  private describe(r: ExportResult): ExportLogEntry {
    const size = new BytesPipe().transform(r.size);
    return r.tooBig
      ? {
          level: 'warn',
          text: `${r.fileName} (${r.host}, jugador ${r.playerId}): ${size}. Puede superar el límite de 5 MB de OGI.`,
        }
      : { level: 'ok', text: `${r.fileName} (${r.host}, jugador ${r.playerId}): ${size}.` };
  }

  private addLog(entry: ExportLogEntry): void {
    this.log.update((l) => [entry, ...l].slice(0, 50));
  }
}
