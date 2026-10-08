/**
 * Cambio de email y de contraseña de la cuenta (Supabase Auth): validación,
 * mensajes de error y lectura del link de confirmación.
 *
 * Sin dependencias de `supabase` para poder probarlo con `npm run test:cuenta`.
 */

export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/** Lo mínimo de `AuthError` que usamos (así no dependemos del tipo de supabase-js). */
export type AuthErrorLike = { message?: string; code?: string; status?: number } | null | undefined;

const isRateLimit = (err: NonNullable<AuthErrorLike>) =>
  err.code === "over_email_send_rate_limit" ||
  err.code === "over_request_rate_limit" ||
  err.status === 429 ||
  /rate limit|security purposes|too many/i.test(err.message ?? "");

const isSessionGone = (err: NonNullable<AuthErrorLike>) =>
  err.code === "session_not_found" ||
  err.code === "session_expired" ||
  err.code === "refresh_token_not_found" ||
  err.code === "bad_jwt" ||
  /auth session missing|jwt|session.*(expired|not found)/i.test(err.message ?? "");

const SESSION_GONE = "Tu sesión venció. Cerrá sesión, volvé a entrar y probá de nuevo.";

/** Validación local antes de pedirle a Supabase el cambio de email. Devuelve el error o `null`. */
export function validateEmailChange(next: string, confirm: string, current: string | null): string | null {
  const a = next.trim();
  if (!a) return "Ingresá el email nuevo.";
  if (!isValidEmail(a)) return "Ese email no es válido. Revisá que esté bien escrito.";
  if (a.toLowerCase() !== confirm.trim().toLowerCase()) return "Los dos emails no coinciden.";
  if (current && a.toLowerCase() === current.trim().toLowerCase()) return "Ese ya es tu email actual.";
  return null;
}

/** Mensaje para un error de `updateUser({ email })`. */
export function emailChangeErrorMessage(err: AuthErrorLike): string {
  if (!err) return "No se pudo pedir el cambio de email. Probá de nuevo.";
  const msg = err.message ?? "";
  if (err.code === "email_exists" || err.code === "user_already_exists" || /already (been )?registered|already exists|already in use/i.test(msg)) {
    return "Ese email ya está en uso por otra cuenta.";
  }
  if (err.code === "email_address_invalid" || err.code === "validation_failed" || /invalid.*email|email.*invalid|unable to validate email/i.test(msg)) {
    return "Ese email no es válido. Revisá que esté bien escrito.";
  }
  if (err.code === "email_address_not_authorized") {
    return "Ahora no podemos mandar mails a esa dirección. Probá con otro email o escribinos.";
  }
  if (isRateLimit(err)) {
    return "Se mandaron demasiados mails en poco tiempo. Esperá unos minutos y probá de nuevo.";
  }
  if (isSessionGone(err)) return SESSION_GONE;
  return "No se pudo pedir el cambio de email. Probá de nuevo en unos minutos.";
}

/** Validación local de la contraseña nueva. Devuelve el error o `null`. */
export function validatePasswordChange(password: string, repeat: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Tiene que tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (password !== repeat) return "Las contraseñas no coinciden.";
  return null;
}

/**
 * Resultado de `updateUser({ password })`:
 * - `reauth`: Supabase pide confirmar con un código que manda por mail
 *   ("Secure password change": sesión de más de 24 h).
 * - `error`: mensaje para mostrar.
 */
export type PasswordChangeOutcome = { kind: "reauth" } | { kind: "error"; message: string };

export function passwordChangeOutcome(err: NonNullable<AuthErrorLike>): PasswordChangeOutcome {
  const msg = err.message ?? "";
  if (err.code === "reauthentication_needed" || err.code === "reauth_nonce_missing" || (/reauthenticat/i.test(msg) && !/invalid|not valid/i.test(msg))) {
    return { kind: "reauth" };
  }
  if (err.code === "reauthentication_not_valid" || /nonce|reauthentication.*(invalid|not valid)/i.test(msg)) {
    return { kind: "error", message: "El código no es correcto o venció. Pedí uno nuevo." };
  }
  if (err.code === "same_password" || /different from the old|same.*password/i.test(msg)) {
    return { kind: "error", message: "La contraseña nueva tiene que ser distinta de la actual." };
  }
  if (err.code === "weak_password" || /password.*(weak|short|at least|characters)/i.test(msg)) {
    return { kind: "error", message: "Esa contraseña es muy débil. Probá con una más larga, mezclando letras, números y símbolos." };
  }
  if (isRateLimit(err)) {
    return { kind: "error", message: "Demasiados intentos en poco tiempo. Esperá unos minutos y probá de nuevo." };
  }
  if (isSessionGone(err)) return { kind: "error", message: SESSION_GONE };
  return { kind: "error", message: "No se pudo cambiar la contraseña. Probá de nuevo en unos minutos." };
}

/**
 * Qué trae la URL al volver de un link de cambio de email:
 * - `changed`: el cambio quedó aplicado (`#access_token=...&type=email_change`).
 * - `partial`: con "Secure email change" activo, se confirmó uno de los dos
 *   links y falta el otro (`#message=Confirmation link accepted...`).
 * - `error`: el link venció o ya se usó (`#error=...&error_code=otp_expired`).
 *   Solo se reconoce como del cambio de email si viene con `type=email_change`;
 *   el resto lo maneja el login.
 */
export type EmailLinkResult = { kind: "changed" } | { kind: "partial" } | { kind: "error"; expired: boolean };

export function readEmailChangeHash(hash: string): EmailLinkResult | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const type = params.get("type");
  if (params.get("error") || params.get("error_code")) {
    if (type !== "email_change") return null;
    return { kind: "error", expired: params.get("error_code") === "otp_expired" };
  }
  if (type === "email_change" && params.get("access_token")) return { kind: "changed" };
  const message = params.get("message") ?? "";
  if (/confirmation link accepted|confirm link sent to the other email/i.test(message)) return { kind: "partial" };
  return null;
}
