import { Injectable, inject, signal } from '@angular/core';
import { DbService } from './db.service';
import { hashText, parseExport, universeSlug } from './merge';

export interface ImportBatch {
  ok: number;
  skipped: number;
  failed: number;
}

export interface ImportLogEntry {
  level: 'ok' | 'warn' | 'err';
  file: string;
  message: string;
  slug?: string;
  time: number;
}

/** Importación global: acepta archivos de cualquier universo desde cualquier página. */
@Injectable({ providedIn: 'root' })
export class ImportService {
  private readonly db = inject(DbService);

  readonly busy = signal(false);
  readonly log = signal<ImportLogEntry[]>([]);
  /** Resumen de la última importación, para el aviso global. */
  readonly lastBatch = signal<ImportBatch | null>(null);
  private batchTimer?: ReturnType<typeof setTimeout>;

  async importFiles(files: Iterable<File>): Promise<ImportLogEntry[]> {
    const entries: ImportLogEntry[] = [];
    this.busy.set(true);
    try {
      for (const file of files) {
        const entry = await this.importFile(file);
        entries.push(entry);
        this.log.update((log) => [entry, ...log].slice(0, 50));
      }
      await this.db.refresh();
    } finally {
      this.busy.set(false);
    }
    this.showBatch({
      ok: entries.filter((e) => e.level === 'ok').length,
      skipped: entries.filter((e) => e.level === 'warn').length,
      failed: entries.filter((e) => e.level === 'err').length,
    });
    return entries;
  }

  dismissBatch(): void {
    clearTimeout(this.batchTimer);
    this.lastBatch.set(null);
  }

  private showBatch(batch: ImportBatch): void {
    clearTimeout(this.batchTimer);
    this.lastBatch.set(batch);
    this.batchTimer = setTimeout(() => this.lastBatch.set(null), 8000);
  }

  clearLog(): void {
    this.log.set([]);
  }

  private async importFile(file: File): Promise<ImportLogEntry> {
    const base = { file: file.name, time: Date.now() };
    try {
      const text = await file.text();
      const hash = hashText(text);
      if (await this.db.findImportByHash(hash)) {
        return { ...base, level: 'warn', message: 'Ya se había importado este archivo; se omite.' };
      }
      const parsed = parseExport(text);
      const s = await this.db.importExport(parsed, file.name, hash);
      return {
        ...base,
        level: 'ok',
        slug: universeSlug(parsed.data.universeUrl, parsed.data.playerId),
        message:
          `${parsed.host} (jugador ${parsed.data.playerId}): ${s.newRecords} registros nuevos, ` +
          `${s.updatedRecords} actualizados, ${s.newDays} días de agregados nuevos y ${s.betterDays} mejorados` +
          (s.snapshot
            ? '. Es la exportación más reciente.'
            : '. Ya había una exportación más reciente.'),
      };
    } catch (e) {
      console.error(e);
      return { ...base, level: 'err', message: e instanceof Error ? e.message : String(e) };
    }
  }
}
