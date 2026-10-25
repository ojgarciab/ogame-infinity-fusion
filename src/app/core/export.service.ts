import { Injectable, inject } from '@angular/core';
import { DbService } from './db.service';
import { buildMergedExport, exportFileName } from './merge';

/** Límite aproximado del almacenamiento que usa OGI (localStorage). */
export const OGI_LIMIT_BYTES = 5 * 1024 * 1024;

export interface ExportResult {
  id: string;
  host: string;
  playerId: number;
  fileName: string;
  size: number;
  tooBig: boolean;
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly db = inject(DbService);

  /** Genera el .data fusionado de un universo y lo descarga. */
  async exportUniverse(id: string, fullHistory: boolean): Promise<ExportResult> {
    const loaded = await this.db.loadUniverse(id);
    if (!loaded) throw new Error('No hay datos de ese universo.');
    const { universe, raw, bestSums } = loaded;
    const text = JSON.stringify(
      buildMergedExport(universe.snapshot, raw, bestSums, { fullHistory }),
    );
    const fileName = exportFileName(universe.universeUrl);
    const blob = new Blob([text], { type: 'text/plain' });
    this.download(blob, fileName);
    return {
      id,
      host: universe.host,
      playerId: universe.playerId,
      fileName,
      size: blob.size,
      tooBig: blob.size > OGI_LIMIT_BYTES * 0.9,
    };
  }

  private download(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
