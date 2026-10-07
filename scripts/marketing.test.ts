/**
 * Reglas puras de marketing (bajas, normalización, plantillas, firmas).
 * Correr con: npm run test:marketing   (Node >= 22.18 ejecuta TypeScript sin flags)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  advanceStatus,
  buildEmailHtml,
  buildEmailText,
  clampLimits,
  DEFAULT_LEGAL,
  fillUnsubscribe,
  isOptOutMessage,
  isSampleEmail,
  isSamplePhoneDigits,
  looksLikeUnsubToken,
  normalizeEmail,
  normalizePhone,
  renderVars,
  UNSUB_PLACEHOLDER,
  WA_OPT_OUT_BUTTON,
  WA_OPT_OUT_PAYLOAD,
  withAdvertisingPrefix,
} from "../shared/marketing.ts";
import { signUnsubTokenWith, verifySvix, verifyUnsubTokenWith } from "../shared/marketingCrypto.ts";

test("normaliza teléfonos argentinos al formato de WhatsApp", () => {
  assert.equal(normalizePhone("0221 15 444-5566"), "5492214445566");
  assert.equal(normalizePhone("+54 9 221 444-5566"), "5492214445566");
  assert.equal(normalizePhone("11 4444-5555"), "5491144445555");
  assert.equal(normalizePhone("123"), null);
});

test("normaliza emails y descarta inválidos", () => {
  assert.equal(normalizeEmail("  Juan.Perez@Gmail.com "), "juan.perez@gmail.com");
  assert.equal(normalizeEmail("juan@"), null);
  assert.equal(normalizeEmail("a b@c.com"), null);
});

test("reconoce datos de ejemplo", () => {
  assert.equal(isSamplePhoneDigits("+54 221 555-0123"), true);
  assert.equal(isSamplePhoneDigits("+54 221 444-5566"), false);
  assert.equal(isSampleEmail("maria@example.com"), true);
  assert.equal(isSampleEmail("maria@gmail.com"), false);
});

test("variables: reemplaza y deja {{link_baja}} para el servidor", () => {
  const out = renderVars("Hola {{nombre}}! Mirá {{ propiedad }}. {{desconocida}}Baja: {{link_baja}}", { nombre: "Ana", propiedad: "PH en Tolosa" });
  assert.equal(out, "Hola Ana! Mirá PH en Tolosa. Baja: {{link_baja}}");
});

test("pedido de baja por WhatsApp: conservador", () => {
  for (const t of ["BAJA", "baja.", "Stop", "No quiero recibir más mensajes", "darme de baja por favor", WA_OPT_OUT_BUTTON]) {
    assert.equal(isOptOutMessage(t), true, t);
  }
  for (const t of ["¿Bajaron el precio?", "la baja de expensas cuánto es", "hola", "", null]) {
    assert.equal(isOptOutMessage(t), false, String(t));
  }
  assert.equal(isOptOutMessage("cualquier cosa", WA_OPT_OUT_PAYLOAD), true);
  assert.ok(WA_OPT_OUT_BUTTON.length <= 25, "Meta limita el texto del botón a 25 caracteres");
});

test("HTML del email: escapa, lleva pie legal y link de baja", () => {
  const html = buildEmailHtml(
    {
      subject: "Novedades",
      preheader: "x",
      body: "Hola <script>alert(1)</script>\n\nSegundo párrafo",
      ctaLabel: "Ver",
      ctaUrl: "javascript:alert(1)",
      properties: [{ title: "Casa \"linda\"", subtitle: "Venta · Tolosa", price: "USD 100.000", url: "https://x.com/p/1", imageUrl: null }],
      propertiesTitle: "Para vos",
    },
    { agencyName: "Inmo", logoUrl: null, primary: "#123456", onPrimary: "#ffffff" },
    { agencyName: "Inmo", address: "Calle 1", phone: null, email: null, website: null, legal: DEFAULT_LEGAL },
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(html.includes(UNSUB_PLACEHOLDER));
  assert.ok(html.includes("Ley 25.326"));
  const filled = fillUnsubscribe(html, "https://crm/baja/abc");
  assert.ok(!filled.includes(UNSUB_PLACEHOLDER) && filled.includes("https://crm/baja/abc"));
  const text = buildEmailText(
    { subject: "s", preheader: "", body: "Hola", ctaLabel: null, ctaUrl: null, properties: [], propertiesTitle: "" },
    { agencyName: "Inmo", address: null, phone: null, email: null, website: null, legal: "L" },
  );
  assert.ok(text.includes(UNSUB_PLACEHOLDER));
});

test("asunto con 'Publicidad' (Disp. 4/2009) sin duplicar", () => {
  assert.equal(withAdvertisingPrefix("Nuevas casas", true), "Publicidad: Nuevas casas");
  assert.equal(withAdvertisingPrefix("Publicidad: x", true), "Publicidad: x");
  assert.equal(withAdvertisingPrefix("Nuevas casas", false), "Nuevas casas");
});

test("límites: se acotan", () => {
  assert.deepEqual(clampLimits({ perHour: 99999, perDay: -3, minDaysBetween: 0 }), { perHour: 1000, perDay: 1, minDaysBetween: 0 });
});

test("estados: un evento viejo no pisa uno nuevo", () => {
  assert.equal(advanceStatus("opened", "delivered"), "opened");
  assert.equal(advanceStatus("delivered", "clicked"), "clicked");
});

test("token de baja: firma, verifica y rechaza manipulados", () => {
  const secret = "s3cret-s3cret-s3cret-s3cret";
  const id = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const t = signUnsubTokenWith(id, secret);
  assert.ok(looksLikeUnsubToken(t));
  assert.equal(verifyUnsubTokenWith(t, secret), id);
  assert.equal(verifyUnsubTokenWith(t, "otro-secreto-otro-secreto"), null);
  const [v, p, s] = t.split(".");
  const other = Buffer.from(JSON.stringify({ r: "00000000-0000-4000-8000-000000000000" })).toString("base64url");
  assert.equal(verifyUnsubTokenWith(`${v}.${other}.${s}`, secret), null);
  assert.equal(verifyUnsubTokenWith(`${v}.${p}`, secret), null);
  assert.ok(!t.includes(id), "el token no expone el id en claro");
});

test("Svix: firma (algoritmo de la doc manual), varias firmas y tolerancia de tiempo", () => {
  // https://docs.svix.com/receiving/verifying-payloads/how-manual
  const secret = "whsec_plJ3nmyCDGBKInavdOK15jsl";
  const id = "msg_loFOjxBNrRLzqYUf";
  const ts = "1731705121";
  const body = Buffer.from('{"type":"email.delivered"}');
  const sig = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.`).update(body).digest("base64");
  assert.equal(verifySvix(body, { id, timestamp: ts, signature: `v0,xxx v1,${sig}` }, secret, Number(ts) + 10), true);
  assert.equal(verifySvix(body, { id, timestamp: ts, signature: `v1,${sig}` }, secret, Number(ts) + 3600), false);
  assert.equal(verifySvix(Buffer.from("{}"), { id, timestamp: ts, signature: `v1,${sig}` }, secret, Number(ts)), false);
});
