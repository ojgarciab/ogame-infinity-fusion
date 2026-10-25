import { Pipe, PipeTransform } from '@angular/core';

const formatter = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });

/** Número abreviado: 1,2 M, 3,4 mil M... */
@Pipe({ name: 'compact' })
export class CompactPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatter.format(Number(value) || 0);
  }
}
