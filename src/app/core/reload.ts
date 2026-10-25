const KEY = 'ogi-fusion-recargado';

/**
 * Tras un despliegue, quien tenga la aplicación abierta puede pedir archivos con hash
 * que ya no existen. En ese caso se recarga la página una sola vez para obtener la
 * versión nueva. Devuelve `true` si el error era de ese tipo.
 */
export function reloadIfChunkMissing(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error);
  if (
    !/dynamically imported module|ChunkLoadError|Importing a module script failed/i.test(message)
  ) {
    return false;
  }
  try {
    if (sessionStorage.getItem(KEY)) return true;
    sessionStorage.setItem(KEY, '1');
  } catch {
    // Sin almacenamiento: se recarga igualmente.
  }
  location.reload();
  return true;
}
