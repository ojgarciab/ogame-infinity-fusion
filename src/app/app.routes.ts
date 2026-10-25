import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Universos · OGI Fusion',
    loadComponent: () => import('./pages/universos/universos').then((m) => m.Universos),
  },
  {
    path: 'universo/:slug',
    title: 'Universo · OGI Fusion',
    loadComponent: () => import('./pages/universo/universo').then((m) => m.Universo),
  },
  {
    path: 'exportar',
    title: 'Exportar · OGI Fusion',
    loadComponent: () => import('./pages/exportar/exportar').then((m) => m.Exportar),
  },
  { path: '**', redirectTo: '' },
];
