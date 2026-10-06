/**
 * Marketing (email y WhatsApp): reglas puras compartidas entre el CRM
 * (navegador) y las funciones de Vercel (api/marketing).
 *
 * Sin dependencias: se importa desde src/ y desde api/ (y desde las pruebas
 * de scripts/marketing.test.ts).
 */

/* ── Canales ─────────────────────────────────────────────────────────────── */

export type MarketingChannel = "email" | "whatsapp";
/** Alcance de una baja: un canal o todos. */
export type UnsubscribeScope = MarketingChannel | "all";

export const CHANNEL_LABEL: Record<MarketingChannel, string> = { email: "Email", whatsapp: "WhatsApp" };
export const SCOPE_LABEL: Record<UnsubscribeScope, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  all: "Todos los canales",
};

/* ── Normalización de destinatarios ──────────────────────────────────────── */

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

/** Email en minúsculas y sin espacios, o null si no es válido. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}

/**
 * Teléfono en dígitos E.164 sin "+" (como lo usa WhatsApp: 5492214445566).
 * Celulares argentinos: 54 + 9 + área + abonado, sin 0 ni 15.
 * null si no hay dígitos suficientes.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length < 8) return null;
  let national: string;
  if (d.startsWith("54")) {
    national = d.slice(2);
    if (national.startsWith("9")) national = national.slice(1);
  } else if (d.length <= 13 && (d.startsWith("0") || d.length === 10 || d.length === 12)) {
    national = d;
  } else {
    return d.length <= 15 ? d : null; // otro país: tal cual
  }
  national = national.replace(/^0/, "");
  if (national.length === 12) {
    for (const areaLen of [2, 3, 4]) {
      if (national.slice(areaLen, areaLen + 2) === "15") {
        national = national.slice(0, areaLen) + national.slice(areaLen + 2);
        break;
      }
    }
  }
  if (national.length !== 10) return null;
  return `549${national}`;
}

/** Teléfonos ficticios de los datos de ejemplo (+54 221 555-01xx). Mismo criterio que src/lib/samples.ts. */
export function isSamplePhoneDigits(phone: string | null | undefined): boolean {
  if (!phone) return false;
  return /(?:^|54)9?0?2215550\d{3}$/.test(phone.replace(/\D/g, ""));
}

/** Dominios reservados para ejemplos (RFC 2606) y los que usa la semilla. */
export function isSampleEmail(email: string | null | undefined): boolean {
  const e = normalizeEmail(email);
  if (!e) return false;
  const domain = e.split("@")[1];
  return /(^|\.)(example\.(com|org|net)|test|invalid|localhost|ejemplo\.com)$/.test(domain);
}

/** Para mostrar sin exponer el dato completo: "ju***@gmail.com", "***5566". */
export function maskEmail(email: string | null | undefined): string {
  const e = normalizeEmail(email);
  if (!e) return "—";
  const [u, d] = e.split("@");
  return `${u.slice(0, 2)}***@${d}`;
}
export function maskPhoneDigits(phone: string | null | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length <= 4 ? "****" : `***${d.slice(-4)}`;
}

/* ── Variables ───────────────────────────────────────────────────────────── */

export interface MarketingVars {
  nombre: string;
  propiedad: string;
  link_propiedad: string;
  link_web: string;
  inmobiliaria: string;
  agente: string;
}

export const MARKETING_VARIABLES: { key: keyof MarketingVars; label: string }[] = [
  { key: "nombre", label: "Primer nombre del contacto" },
  { key: "propiedad", label: "Título de la propiedad recomendada" },
  { key: "link_propiedad", label: "Link a la ficha de esa propiedad" },
  { key: "link_web", label: "Link a la web de la inmobiliaria" },
  { key: "inmobiliaria", label: "Nombre de la inmobiliaria" },
  { key: "agente", label: "Tu nombre" },
];

/** Lo reemplaza el SERVIDOR al enviar (lleva un token firmado por destinatario). */
export const UNSUB_PLACEHOLDER = "{{link_baja}}";

/**
 * Reemplaza {{variable}}. Las desconocidas quedan vacías, salvo {{link_baja}}
 * que se deja intacta para el servidor.
 */
export function renderVars(template: string, vars: Partial<MarketingVars>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => {
    const k = key.toLowerCase();
    if (k === "link_baja") return whole;
    const v = (vars as Record<string, string | undefined>)[k];
    return v ?? "";
  });
}

/** Variables que usa un texto (para avisar si falta alguna en la vista previa). */
export function usedVars(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) out.add(m[1].toLowerCase());
  return [...out];
}

/* ── HTML del email ──────────────────────────────────────────────────────── */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Solo http(s). Cualquier otra cosa (javascript:, data:) se descarta. */
export function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  if (u === UNSUB_PLACEHOLDER) return u;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Branding del email. Punto de extensión: si existe el branding de la inmobiliaria, se mapea acá. */
export interface MarketingBrand {
  agencyName: string;
  logoUrl: string | null;
  /** Color principal en hex (#7C3AED). */
  primary: string;
  /** Texto sobre el color principal. */
  onPrimary: string;
}

export interface MarketingFooter {
  agencyName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  /** Texto legal (Ley 25.326). */
  legal: string;
}

export interface EmailPropertyBlock {
  title: string;
  subtitle: string;
  price: string;
  url: string | null;
  imageUrl: string | null;
}

export interface EmailContent {
  subject: string;
  preheader: string;
  /** Texto con párrafos separados por línea en blanco. Ya con variables reemplazadas. */
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  properties: EmailPropertyBlock[];
  propertiesTitle: string;
}

/**
 * Pie legal. Disposición DNPDP 4/2009, art. 1: aviso de retiro/bloqueo con el
 * mecanismo para ejercerlo y la transcripción del art. 27 inc. 3 de la Ley
 * 25.326 y del 3er párrafo del art. 27 del Decreto 1558/2001.
 * Revisarlo con un abogado antes de usarlo (ver docs/marketing-puesta-en-marcha.md).
 */
export const DEFAULT_LEGAL =
  "Recibís este mensaje porque nos diste tu consentimiento para recibir novedades. " +
  "Podés pedir el retiro o bloqueo de tus datos con el link «No quiero recibir más mensajes» o respondiendo a este mail. " +
  "Ley 25.326, art. 27, inc. 3: «El titular podrá en cualquier momento solicitar el retiro o bloqueo de su nombre de los bancos de datos a los que se refiere el presente artículo». " +
  "Decreto 1558/2001, art. 27, 3er párrafo: «En toda comunicación con fines de publicidad que se realice por correo, teléfono, correo electrónico, Internet u otro medio a distancia a conocer, " +
  "se deberá indicar, en forma expresa y destacada, la posibilidad del titular del dato de solicitar el retiro o bloqueo, total o parcial, de su nombre de la base de datos. " +
  "A pedido del interesado, se deberá informar el nombre del responsable o usuario del banco de datos que proveyó la información». " +
  "La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, órgano de control de la Ley 25.326, tiene la atribución de atender " +
  "las denuncias y reclamos que se interpongan con relación al incumplimiento de las normas sobre protección de datos personales.";

/** Disposición 4/2009, art. 2: la publicidad no solicitada lleva "Publicidad" en el asunto. */
export function withAdvertisingPrefix(subject: string, on: boolean): string {
  const s = subject.trim();
  if (!on || /^publicidad\b/i.test(s)) return s;
  return `Publicidad: ${s}`;
}

const hex = (c: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : fallback);

function paragraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * HTML responsive (tablas + estilos en línea: lo que entienden Gmail,
 * Outlook y Apple Mail). Todo el contenido variable va escapado. El link de
 * baja va como {{link_baja}} y lo completa el servidor.
 */
export function buildEmailHtml(c: EmailContent, brand: MarketingBrand, footer: MarketingFooter): string {
  const primary = hex(brand.primary, "#7C3AED");
  const onPrimary = hex(brand.onPrimary, "#FFFFFF");
  const logo = safeUrl(brand.logoUrl);
  const cta = c.ctaLabel && safeUrl(c.ctaUrl);
  const body = paragraphs(c.body)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#1F2937;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  const cards = c.properties
    .slice(0, 6)
    .map((p) => {
      const url = safeUrl(p.url);
      const img = safeUrl(p.imageUrl);
      const open = url ? `<a href="${escapeHtml(url)}" style="color:inherit;text-decoration:none;">` : "";
      const close = url ? "</a>" : "";
      return `<tr><td style="padding:0 0 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
${img ? `<tr><td>${open}<img src="${escapeHtml(img)}" width="536" alt="${escapeHtml(p.title)}" style="display:block;width:100%;max-width:536px;height:auto;border:0;">${close}</td></tr>` : ""}
<tr><td style="padding:14px 16px;">
${open}<p style="margin:0;font-size:16px;font-weight:700;color:#111827;">${escapeHtml(p.title)}</p>${close}
<p style="margin:4px 0 0;font-size:14px;color:#6B7280;">${escapeHtml(p.subtitle)}</p>
<p style="margin:6px 0 0;font-size:15px;font-weight:700;color:${primary};">${escapeHtml(p.price)}</p>
${url ? `<p style="margin:10px 0 0;"><a href="${escapeHtml(url)}" style="font-size:14px;color:${primary};font-weight:600;">Ver ficha →</a></p>` : ""}
</td></tr></table></td></tr>`;
    })
    .join("");

  const contactLine = [footer.address, footer.phone, footer.email].filter(Boolean).map((x) => escapeHtml(x as string)).join(" · ");
  const web = safeUrl(footer.website);

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>${escapeHtml(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#F3F4F6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="background:${primary};padding:20px 32px;">
${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(brand.agencyName)}" height="40" style="display:block;height:40px;width:auto;border:0;">` : `<p style="margin:0;font-size:20px;font-weight:700;color:${onPrimary};">${escapeHtml(brand.agencyName)}</p>`}
</td></tr>
<tr><td style="padding:32px 32px 8px;">${body}
${cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="background:${primary};border-radius:10px;"><a href="${escapeHtml(cta)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:${onPrimary};text-decoration:none;">${escapeHtml(c.ctaLabel as string)}</a></td></tr></table>` : ""}
</td></tr>
${cards ? `<tr><td style="padding:0 32px 8px;"><p style="margin:0 0 12px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6B7280;">${escapeHtml(c.propertiesTitle)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards}</table></td></tr>` : ""}
<tr><td style="padding:24px 32px 28px;border-top:1px solid #E5E7EB;background:#FAFAFA;">
<p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#374151;">${escapeHtml(footer.agencyName)}</p>
${contactLine ? `<p style="margin:0 0 6px;font-size:12px;color:#6B7280;">${contactLine}</p>` : ""}
${web ? `<p style="margin:0 0 10px;font-size:12px;"><a href="${escapeHtml(web)}" style="color:#6B7280;">${escapeHtml(web)}</a></p>` : ""}
<p style="margin:0 0 10px;font-size:11px;line-height:1.5;color:#9CA3AF;">${escapeHtml(footer.legal)}</p>
<p style="margin:0;font-size:12px;"><a href="${UNSUB_PLACEHOLDER}" style="color:#6B7280;text-decoration:underline;">No quiero recibir más mensajes</a></p>
</td></tr></table></td></tr></table></body></html>`;
}

/** Versión texto plano (la piden los filtros de spam y algunos lectores). */
export function buildEmailText(c: EmailContent, footer: MarketingFooter): string {
  const lines: string[] = [paragraphs(c.body).join("\n\n")];
  if (c.ctaLabel && safeUrl(c.ctaUrl)) lines.push(`${c.ctaLabel}: ${c.ctaUrl}`);
  if (c.properties.length) {
    lines.push(c.propertiesTitle.toUpperCase());
    for (const p of c.properties.slice(0, 6)) lines.push(`- ${p.title} · ${p.subtitle} · ${p.price}${p.url ? `\n  ${p.url}` : ""}`);
  }
  lines.push(
    "--",
    footer.agencyName,
    [footer.address, footer.phone, footer.email].filter(Boolean).join(" · "),
    footer.legal,
    `Para no recibir más mensajes: ${UNSUB_PLACEHOLDER}`,
  );
  return lines.filter(Boolean).join("\n\n");
}

/** Reemplaza el link de baja en el HTML/texto ya renderizado (lo hace el servidor). */
export function fillUnsubscribe(content: string, url: string): string {
  return content.split(UNSUB_PLACEHOLDER).join(url);
}

/* ── WhatsApp: baja por respuesta ────────────────────────────────────────── */

/**
 * Texto del botón de respuesta rápida para las plantillas MARKETING.
 * Meta limita el texto de cada botón a 25 caracteres, por eso no entra
 * "No quiero recibir más mensajes" (30).
 */
export const WA_OPT_OUT_BUTTON = "No recibir más mensajes";
/** Payload del botón (lo manda Meta en el webhook). */
export const WA_OPT_OUT_PAYLOAD = "PM_MKT_BAJA";
/** Línea de pie para plantillas sin botón. */
export const WA_OPT_OUT_FOOTER = "Respondé BAJA para no recibir más mensajes";

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const EXACT = new Set([
  "baja",
  "stop",
  "dar de baja",
  "darme de baja",
  "de baja",
  "quiero la baja",
  "no recibir mas mensajes",
  "no quiero recibir mas mensajes",
  "no me escriban mas",
  "desuscribir",
  "desuscribirme",
  "unsubscribe",
  "no enviar mas",
  "basta",
]);

/**
 * ¿El mensaje entrante es un pedido de baja? Conservador para no dar de baja
 * a alguien que escribe "¿bajaron el precio?": palabra sola o frase clara.
 */
export function isOptOutMessage(text: string | null | undefined, payload?: string | null): boolean {
  if (payload && payload.trim() === WA_OPT_OUT_PAYLOAD) return true;
  if (!text) return false;
  const t = strip(text);
  if (!t || t.length > 60) return false;
  if (EXACT.has(t)) return true;
  if (t === strip(WA_OPT_OUT_BUTTON)) return true;
  return /\bno quiero recibir mas (mensajes|promociones|novedades)\b/.test(t) || /^(por favor )?(dame|darme|denme) de baja\b/.test(t);
}

/* ── Límites ─────────────────────────────────────────────────────────────── */

export interface SendLimits {
  /** Máximo de envíos por hora de esta campaña. */
  perHour: number;
  /** Máximo por día de esta campaña. */
  perDay: number;
  /** No mandar marketing al mismo contacto si ya recibió algo hace menos de N días. */
  minDaysBetween: number;
}

export const DEFAULT_LIMITS: SendLimits = { perHour: 100, perDay: 300, minDaysBetween: 7 };
export const LIMITS_MAX: SendLimits = { perHour: 1000, perDay: 5000, minDaysBetween: 60 };

export function clampLimits(l: Partial<SendLimits> | null | undefined): SendLimits {
  const n = (v: unknown, def: number, max: number, min = 1) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : def;
  return {
    perHour: n(l?.perHour, DEFAULT_LIMITS.perHour, LIMITS_MAX.perHour),
    perDay: n(l?.perDay, DEFAULT_LIMITS.perDay, LIMITS_MAX.perDay),
    minDaysBetween: n(l?.minDaysBetween, DEFAULT_LIMITS.minDaysBetween, LIMITS_MAX.minDaysBetween, 0),
  };
}

/* ── Estados de destinatario ─────────────────────────────────────────────── */

export type RecipientStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "replied"
  | "bounced"
  | "complained"
  | "unsubscribed"
  | "failed"
  | "skipped";

export const RECIPIENT_STATUS_LABEL: Record<RecipientStatus, string> = {
  queued: "En cola",
  sending: "Enviando",
  sent: "Enviado",
  delivered: "Entregado",
  opened: "Abierto",
  clicked: "Hizo click",
  replied: "Respondió",
  bounced: "Rebotó",
  complained: "Lo marcó como spam",
  unsubscribed: "Se dio de baja",
  failed: "Error",
  skipped: "Omitido",
};

/** Orden de "avance": un evento viejo no pisa uno más nuevo (p. ej. delivered después de opened). */
const RANK: Record<RecipientStatus, number> = {
  queued: 0,
  sending: 1,
  failed: 2,
  skipped: 2,
  sent: 3,
  delivered: 4,
  bounced: 5,
  opened: 6,
  clicked: 7,
  replied: 8,
  complained: 9,
  unsubscribed: 10,
};

export function advanceStatus(cur: RecipientStatus, next: RecipientStatus): RecipientStatus {
  return RANK[next] >= RANK[cur] ? next : cur;
}

/* ── Token de baja (formato; la firma la hace el servidor) ──────────────── */

/** `v1.<payload base64url>.<firma base64url>`. Solo valida la forma. */
export function looksLikeUnsubToken(t: string | null | undefined): t is string {
  return typeof t === "string" && t.length <= 400 && /^v1\.[A-Za-z0-9_-]{8,300}\.[A-Za-z0-9_-]{20,100}$/.test(t);
}
