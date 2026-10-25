# OGI Fusion

Aplicación web 100% local para fusionar exportaciones (`.data`) de
[OGame Infinity](https://github.com/ogame-infinity/web-extension) de uno o varios
universos, y volver a exportarlas como un `.data` por universo compatible con el
botón «Importar» de la extensión.

Todo se procesa en el navegador y se guarda en **IndexedDB**; ningún dato sale del
equipo.

## Uso

1. Abre `index.html` (con doble clic o desde GitHub Pages).
2. Arrastra uno o varios archivos `.data`. Se agrupan por universo y jugador
   (`universeUrl` + `playerId`). Un archivo ya importado se ignora.
3. En «Detalle» puedes ver los agregados diarios fusionados y de dónde sale cada uno.
4. Selecciona universos y pulsa «Exportar» para descargar `oginfinity-<idioma>-<universo>.data`.

Conviene importar una exportación al menos cada 4-5 días: OGI borra las
expediciones, descubrimientos y recolecciones en bruto con más de 5 días, y esta
aplicación las conserva.

## Qué contiene una exportación de OGI

Una exportación es siempre el JSON completo de un universo (las casillas de
«Gestión de datos» solo afectan a «Resetear»). Para fusionar interesan:

| Clave | Tipo | Retención en OGI |
| --- | --- | --- |
| `expeditions`, `discoveries`, `harvests` | registros en bruto por id de mensaje | 5 días |
| `combats` | registros en bruto por id de mensaje | sin límite efectivo |
| `expeditionSums`, `combatsSums`, `discoveriesSums` | agregados por día (`DD.MM.YY`, hora local) | permanentes |

## Reglas de fusión

- **Registros en bruto**: unión por id de mensaje; si un id aparece en varias
  exportaciones, gana la más reciente.
- **Agregados diarios**: para cada día se guarda el agregado importado «más alto»
  (más eventos contados; a igualdad, mayor magnitud; después, el más reciente).
  Al exportar, se recalcula desde los registros en bruto lo que OGI calcula a
  partir de ellos (recursos y tipos de expedición, pérdidas en expediciones,
  recolecciones, combates, botín y descubrimientos). Cada parte calculada
  sustituye a la importada solo si contiene al menos la misma información; si OGI
  ya purgó parte de ese día, se mantiene la importada. Los campos que no se pueden
  reconstruir (combustible, naves encontradas, agujeros negros, top de combates y
  ajustes manuales) se conservan del agregado importado.
- **Resto de datos** (imperio, opciones, etc.): de la exportación más reciente.

Al exportar, por defecto se aplica la misma retención que OGI, para no superar su
límite de 5 MB. Con «Incluir todo el histórico en bruto» se genera una copia de
seguridad completa, que también se puede volver a importar en esta aplicación.

## Desarrollo

```sh
npm test          # tests de la lógica de fusión (node:test, sin dependencias)
npm start         # servidor estático en http://localhost:8000
```

La lógica pura está en `js/merge.js`, el almacenamiento en `js/db.js` y la
interfaz en `js/app.js`. Son scripts clásicos (sin módulos ES) para que la
aplicación funcione también abriendo `index.html` desde `file://`.

## Despliegue

El workflow `.github/workflows/pages.yml` ejecuta los tests y publica la
aplicación en GitHub Pages en cada push a `master`. Para activarlo, en
*Settings → Pages → Build and deployment* selecciona **GitHub Actions** como
origen.
