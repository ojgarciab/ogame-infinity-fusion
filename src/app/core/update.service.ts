import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

const EVERY_HALF_HOUR = 30 * 60_000;

/** Avisa cuando el service worker ha descargado una versión nueva de la aplicación. */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly sw = inject(SwUpdate);
  readonly available = signal(false);

  constructor() {
    if (!this.sw.isEnabled) return;
    this.sw.versionUpdates
      .pipe(
        filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.available.set(true));
    // Si la caché del service worker queda inservible, sólo queda recargar.
    this.sw.unrecoverable.pipe(takeUntilDestroyed()).subscribe(() => location.reload());

    // Una PWA instalada puede pasar días abierta: se comprueba al volver a ella y cada media hora.
    const check = () => {
      if (document.visibilityState === 'visible') this.sw.checkForUpdate().catch(() => undefined);
    };
    const interval = setInterval(check, EVERY_HALF_HOUR);
    document.addEventListener('visibilitychange', check);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', check);
    });
  }

  async update(): Promise<void> {
    try {
      await this.sw.activateUpdate();
    } finally {
      location.reload();
    }
  }
}
