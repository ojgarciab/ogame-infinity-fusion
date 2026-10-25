# OGI Fusion

Aplicación web (Angular, instalable como PWA) que fusiona exportaciones `.data` de
[OGame Infinity](https://github.com/ogame-infinity/web-extension) de uno o varios
universos, y las vuelve a exportar como un `.data` por universo, compatible con el
botón «Importar» de la extensión.

Todo se procesa en el navegador y se guarda en **IndexedDB**: ningún dato sale del
equipo. Una vez instalada, funciona sin conexión.

## Uso

El diseño es mobile-first: la prioridad es usarla en el móvil, con navegación
inferior (Universos · Importar · Exportar), botones táctiles de al menos 44 px,
listas en tarjetas y la acción principal fija al alcance del pulgar. En pantallas
anchas, la navegación pasa a la cabecera y los agregados diarios se ven en tabla.

- **Importar**: botón central de la barra inferior (o «Importar» en la cabecera, en escritorio), o arrastrar archivos `.data` a
  cualquier parte de la ventana, desde cualquier página. Se aceptan varios archivos
  a la vez, de uno o varios universos; se agrupan por universo y jugador
  (`universeUrl` + `playerId`). Si un archivo ya se importó, se ignora.
- **Universos**: listado de universos con datos y detalle con los agregados
  diarios fusionados y el origen de cada uno.
- **Exportar**: se eligen los universos en un listado y se descarga un
  `oginfinity-<idioma>-<universo>.data` por cada uno.
- **Tema** claro u oscuro: por defecto, el del sistema; si se cambia, se recuerda.
- **Instalar**: el botón aparece cuando el navegador permite instalar la aplicación.

Conviene importar una exportación al menos cada 4 o 5 días: OGI borra las
expediciones, descubrimientos y recolecciones en bruto de más de 5 días, y esta
aplicación los conserva.

## Qué contiene una exportación de OGI

Una exportación es siempre el JSON completo de un universo. Las casillas de
«Gestión de datos» solo afectan a «Resetear». Para la fusión interesan:

| Clave                                              | Tipo                                       | Retención en OGI    |
| -------------------------------------------------- | ------------------------------------------ | ------------------- |
| `expeditions`, `discoveries`, `harvests`           | registros en bruto por id de mensaje       | 5 días              |
| `combats`                                          | registros en bruto por id de mensaje       | sin límite efectivo |
| `expeditionSums`, `combatsSums`, `discoveriesSums` | agregados por día (`DD.MM.YY`, hora local) | permanentes         |

## Reglas de fusión

- **Registros en bruto**: se unen por id de mensaje. Si un id aparece en varias
  exportaciones, se queda el de la más reciente.
- **Agregados diarios**: de cada día se guarda el agregado importado «más alto»
  (el que cuenta más eventos; si empatan, el de mayor magnitud; después, el más
  reciente). Al exportar, se recalcula desde los registros en bruto todo lo que
  OGI calcula a partir de ellos: recursos y tipos de expedición, pérdidas en
  expediciones, recolecciones, combates, botín y descubrimientos. Cada parte
  recalculada sustituye a la importada solo si contiene al menos la misma
  información; si OGI ya purgó parte de ese día, se mantiene la importada. Los
  campos que no se pueden reconstruir (combustible, naves encontradas, agujeros
  negros, top de combates y ajustes manuales) se toman del agregado importado.
- **Resto de datos** (imperio, opciones, etc.): de la exportación más reciente.

Por defecto, la exportación aplica la misma retención que OGI para no superar su
límite de 5 MB. Con «Incluir todo el histórico en bruto» se genera una copia de
seguridad completa, que también se puede volver a importar en esta aplicación.

## Desarrollo

Requiere Node.js 22.22.3+ o 24.15+.

```sh
npm ci
npm start              # servidor de desarrollo en http://localhost:4200
npm test               # tests unitarios (Vitest)
npm run format:check   # formato (Prettier)
npm run build:pages    # build de producción para GitHub Pages, con 404.html
```

Estructura:

- `src/app/core/merge.ts`: lógica pura de fusión, sin dependencias de Angular.
- `src/app/core/db.service.ts`: almacenamiento en IndexedDB.
- `src/app/core/*.service.ts`: importación, exportación, tema y PWA.
- `src/app/pages/`: páginas `universos`, `universo/:slug` y `exportar`.

## Despliegue en GitHub Pages

El workflow `.github/workflows/pages.yml` comprueba el formato, ejecuta los tests,
compila con `--base-href /<repositorio>/` y publica en GitHub Pages en cada push a
`master`. En los pull requests solo compila y ejecuta los tests.

Para que funcione el acceso directo a cualquier URL de Angular (por ejemplo
`/exportar`), el build copia `index.html` a `404.html`: GitHub Pages sirve ese
archivo para las rutas que no existen y el router de Angular resuelve la ruta.
Una vez instalado el service worker, las navegaciones se sirven desde la caché.

Configuración necesaria en el repositorio: _Settings → Pages → Build and
deployment → Source: **GitHub Actions**_.
