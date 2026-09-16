/**
 * Links de WhatsApp.
 *
 * `wa.me` necesita el número en formato internacional sin símbolos. Los
 * celulares argentinos llevan un 9 después del 54 y NO llevan el 0 del área ni
 * el 15: "0221 15 444-5566" es 5492214445566. Si el número llega mal formado,
 * WhatsApp abre pero dice "el número no está en WhatsApp", que es lo peor que
 * le puede pasar a un agente delante de un cliente.
 */

/** Largo de un número argentino sin 54 ni 9: área + abonado. */
const AR_NATIONAL_LENGTH = 10;

/** Número listo para `wa.me`, o `null` si no hay dígitos suficientes. */
export function normalizeWhatsappNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length < 8) return null;

  let national: string;
  if (digits.startsWith("54")) {
    national = digits.slice(2);
    if (national.startsWith("9")) national = national.slice(1);
  } else if (digits.length <= 13 && (digits.startsWith("0") || digits.length === AR_NATIONAL_LENGTH || digits.length === 12)) {
    national = digits;
  } else {
    // Número de otro país: se deja como vino.
    return digits;
  }

  national = national.replace(/^0/, "");

  // El 15 va después del código de área (2 a 4 dígitos): se saca si con eso
  // el número queda del largo correcto.
  if (national.length === AR_NATIONAL_LENGTH + 2) {
    for (const areaLen of [2, 3, 4]) {
      if (national.slice(areaLen, areaLen + 2) === "15") {
        national = national.slice(0, areaLen) + national.slice(areaLen + 2);
        break;
      }
    }
  }

  return national.length === AR_NATIONAL_LENGTH ? `549${national}` : `54${national}`;
}

/** Link que abre el chat con el mensaje escrito. Sin número, abre el selector de contactos. */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const number = normalizeWhatsappNumber(phone);
  const query = `text=${encodeURIComponent(text)}`;
  return number ? `https://wa.me/${number}?${query}` : `https://wa.me/?${query}`;
}

/** Primer nombre, para que el mensaje no suene a formulario. */
export const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? fullName;
