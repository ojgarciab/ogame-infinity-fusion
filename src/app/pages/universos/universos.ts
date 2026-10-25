import { DatePipe, DecimalPipe, UpperCasePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DbService } from '../../core/db.service';
import { ImportService } from '../../core/import.service';
import { InstallService } from '../../core/install.service';

@Component({
  selector: 'app-universos',
  imports: [RouterLink, DatePipe, DecimalPipe, UpperCasePipe],
  templateUrl: './universos.html',
  styleUrl: './universos.scss',
})
export class Universos {
  protected readonly db = inject(DbService);
  protected readonly importer = inject(ImportService);
  protected readonly installer = inject(InstallService);

  protected onFiles(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) this.importer.importFiles(files);
  }
}
