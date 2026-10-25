import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'bytes' })
export class BytesPipe implements PipeTransform {
  transform(n: number | null | undefined): string {
    const v = Number(n) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1).replace('.', ',')} KB`;
    return `${(v / 1024 / 1024).toFixed(2).replace('.', ',')} MB`;
  }
}
