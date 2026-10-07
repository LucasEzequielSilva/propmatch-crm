/**
 * A dónde vuelve el navegador después del OAuth de un portal.
 *
 * No se acepta una URL ni un path libre (sería una redirección abierta): el
 * cliente manda un NOMBRE de destino de esta lista, viaja cifrado en la cookie
 * del OAuth y el callback arma la URL con APP_URL + el path fijo.
 *
 * Archivo sin imports de runtime: lo usan las pruebas sin red.
 */

export const RETURN_TARGETS = {
  publicador: "/publicador",
  integraciones: "/configuracion/integraciones",
} as const;

export type ReturnTarget = keyof typeof RETURN_TARGETS;

/** Cualquier cosa que no sea un destino conocido → el de siempre (publicador). */
export function parseReturnTarget(v: unknown): ReturnTarget {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(RETURN_TARGETS, v) ? (v as ReturnTarget) : "publicador";
}

/**
 * URL final del callback. `param` es el nombre del portal en la query
 * (`meli` para Mercado Libre, igual que antes), `reason` un código corto.
 */
export function buildReturnUrl(appUrl: string, target: unknown, param: string, reason?: string): string {
  const base = appUrl.replace(/\/+$/, "");
  const path = RETURN_TARGETS[parseReturnTarget(target)];
  const safeReason = reason && /^[a-z_]{1,32}$/.test(reason) ? reason : reason ? "server" : undefined;
  const q = safeReason ? `${param}=error&reason=${safeReason}` : `${param}=connected`;
  return `${base}${path}?${q}`;
}
