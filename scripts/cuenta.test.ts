/**
 * Mi cuenta: cambio de email y de contraseña (validación, errores de Supabase y link de vuelta).
 * Correr con: npm run test:cuenta   (Node >= 22.18 ejecuta TypeScript sin flags)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emailChangeErrorMessage,
  isValidEmail,
  passwordChangeOutcome,
  readEmailChangeHash,
  validateEmailChange,
  validatePasswordChange,
} from "../src/lib/accountAuth.ts";

test("valida el email nuevo antes de pedirlo", () => {
  assert.equal(isValidEmail("ana@inmo.com.ar"), true);
  assert.equal(isValidEmail("ana@inmo"), false);
  assert.equal(validateEmailChange("", "", "a@b.com"), "Ingresá el email nuevo.");
  assert.match(validateEmailChange("ana@", "ana@", "a@b.com") ?? "", /no es válido/);
  assert.equal(validateEmailChange("ana@x.com", "ana@y.com", "a@b.com"), "Los dos emails no coinciden.");
  assert.equal(validateEmailChange("A@B.com", "a@b.com", "a@b.com"), "Ese ya es tu email actual.");
  assert.equal(validateEmailChange(" Ana@X.com ", "ana@x.com", "a@b.com"), null);
});

test("traduce los errores del cambio de email", () => {
  assert.match(emailChangeErrorMessage({ code: "email_exists", message: "x" }), /ya está en uso/);
  assert.match(emailChangeErrorMessage({ message: "A user with this email address has already been registered" }), /ya está en uso/);
  assert.match(emailChangeErrorMessage({ code: "email_address_invalid", message: "x" }), /no es válido/);
  assert.match(emailChangeErrorMessage({ code: "over_email_send_rate_limit", message: "x", status: 429 }), /demasiados mails/);
  assert.match(emailChangeErrorMessage({ message: "For security purposes, you can only request this after 42 seconds." }), /demasiados mails/);
  assert.match(emailChangeErrorMessage({ message: "Auth session missing!" }), /sesión venció/);
  assert.match(emailChangeErrorMessage({ message: "boom" }), /No se pudo/);
});

test("valida la contraseña nueva", () => {
  assert.match(validatePasswordChange("corta", "corta") ?? "", /al menos 8/);
  assert.equal(validatePasswordChange("larguisima1", "larguisima2"), "Las contraseñas no coinciden.");
  assert.equal(validatePasswordChange("larguisima1", "larguisima1"), null);
});

test("detecta cuándo Supabase pide reautenticación", () => {
  assert.deepEqual(passwordChangeOutcome({ code: "reauthentication_needed", message: "x" }), { kind: "reauth" });
  assert.deepEqual(passwordChangeOutcome({ message: "Password update requires reauthentication" }), { kind: "reauth" });
  const bad = passwordChangeOutcome({ code: "reauthentication_not_valid", message: "Invalid nonce" });
  assert.equal(bad.kind, "error");
  assert.match(bad.kind === "error" ? bad.message : "", /código/);
  const same = passwordChangeOutcome({ code: "same_password", message: "x" });
  assert.match(same.kind === "error" ? same.message : "", /distinta/);
  const weak = passwordChangeOutcome({ code: "weak_password", message: "x" });
  assert.match(weak.kind === "error" ? weak.message : "", /débil/);
});

test("lee el link de vuelta del cambio de email", () => {
  assert.deepEqual(readEmailChangeHash("#access_token=abc&expires_in=3600&refresh_token=r&token_type=bearer&type=email_change"), { kind: "changed" });
  assert.deepEqual(
    readEmailChangeHash("#message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email"),
    { kind: "partial" },
  );
  assert.deepEqual(readEmailChangeHash("#error=access_denied&error_code=otp_expired&type=email_change"), { kind: "error", expired: true });
  // Errores sin type (confirmación de alta) los maneja el login.
  assert.equal(readEmailChangeHash("#error=access_denied&error_code=otp_expired"), null);
  assert.equal(readEmailChangeHash("#access_token=abc&type=recovery"), null);
  assert.equal(readEmailChangeHash(""), null);
});
