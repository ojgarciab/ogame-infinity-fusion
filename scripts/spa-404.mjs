// GitHub Pages devuelve 404.html para cualquier ruta que no exista como archivo.
// Copiamos index.html a 404.html para que Angular resuelva las URL directas
// (por ejemplo /exportar o /universo/275-es-101348) con su propio router.
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist/ogame-infinity-fusion/browser';
const index = join(dir, 'index.html');
if (!existsSync(index)) {
  console.error(`No existe ${index}. Ejecuta antes "ng build".`);
  process.exit(1);
}
copyFileSync(index, join(dir, '404.html'));
console.log(`Creado ${join(dir, '404.html')}`);
