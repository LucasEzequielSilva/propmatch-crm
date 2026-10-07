/**
 * Credenciales de integración de Argenprop: validación y enmascarado.
 *
 * Lo confirmado (fuentes en docs/integraciones-multitenant.md): Argenprop NO
 * usa OAuth; cada inmobiliaria pide la integración y Argenprop le manda por
 * mail un usuario de integración (termina en @api.com, distinto de su login),
 * una contraseña y sus identificadores (IdVendedor / IdAnunciante; algunos
 * CRMs piden además IdOrigen, que probablemente identifica al integrador).
 * No hay endpoint público documentado para verificar el login: por eso NO se
 * verifica (queda como "sin verificar").
 *
 * Archivo sin imports de runtime: lo usan las pruebas sin red.
 */

export interface ArgenpropCredentials {
  user: string;
  password: string;
  sellerId: string;
  originId: string | null;
}

export type CredentialsCheck =
  | { ok: true; value: ArgenpropCredentials }
  | { ok: false; field: "user" | "password" | "sellerId" | "originId"; message: string };

export function parseArgenpropCredentials(raw: unknown): CredentialsCheck {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const user = s(r.user).toLowerCase();
  const password = typeof r.password === "string" ? r.password : "";
  const sellerId = s(r.sellerId);
  const originId = s(r.originId);
  if (!/^[^@\s]{1,100}@api\.com$/.test(user))
    return {
      ok: false,
      field: "user",
      message: "El usuario de integración termina en «@api.com» y te lo manda Argenprop. No es el mail con el que entrás a Argenprop.",
    };
  if (password.length < 1 || password.length > 200) return { ok: false, field: "password", message: "Pegá la contraseña que te mandó Argenprop." };
  if (!/^\d{1,20}$/.test(sellerId)) return { ok: false, field: "sellerId", message: "El número de vendedor (IdVendedor) son solo números." };
  if (originId && !/^\d{1,20}$/.test(originId))
    return { ok: false, field: "originId", message: "El IdOrigen son solo números (si no te lo dieron, dejalo vacío)." };
  return { ok: true, value: { user, password, sellerId, originId: originId || null } };
}

/** "inmobiliaria@api.com" → "inm***@api.com" (para mostrar la cuenta sin exponerla entera). */
export function maskApiUser(user: string): string {
  const [local, domain] = user.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, Math.min(3, local.length))}***@${domain}`;
}
