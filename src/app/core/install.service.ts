import { Injectable, signal } from '@angular/core';

/** Evento de Chromium para mostrar el diálogo de instalación cuando queramos. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    /** Lo guarda el script de index.html si el navegador lo emite antes de arrancar Angular. */
    ogiInstallPrompt?: InstallPromptEvent;
  }
}

/** Evento propio que avisa de que hay un `beforeinstallprompt` guardado. */
export const INSTALLABLE_EVENT = 'ogi-instalable';

/**
 * Instalación como aplicación (PWA): en Chrome, Edge y Samsung Internet con el diálogo
 * del navegador; en iPhone/iPad, con instrucciones (Safari no tiene diálogo propio).
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private event = window.ogiInstallPrompt;

  /** La aplicación ya se está ejecutando instalada. */
  readonly installed =
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  /** iPhone/iPad (los iPad recientes se presentan como Mac con pantalla táctil). */
  readonly isIos =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  /** Hay que mostrar el botón «Instalar». */
  readonly available = signal(!this.installed && (!!this.event || this.isIos));
  /** Instrucciones de instalación para Safari en iOS. */
  readonly showIosHelp = signal(false);

  constructor() {
    window.addEventListener(INSTALLABLE_EVENT, () => {
      this.event = window.ogiInstallPrompt;
      if (!this.installed) this.available.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.event = window.ogiInstallPrompt = undefined;
      this.available.set(false);
    });
  }

  /** Abre el diálogo del navegador o, si no existe (iOS), las instrucciones. */
  async install(): Promise<void> {
    if (!this.event) {
      if (this.isIos) this.showIosHelp.set(true);
      return;
    }
    await this.event.prompt();
    const { outcome } = await this.event.userChoice;
    // El evento sólo se puede usar una vez.
    this.event = window.ogiInstallPrompt = undefined;
    if (outcome === 'accepted') this.available.set(false);
  }
}
