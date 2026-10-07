import { useMarketingCtx } from "./useMarketingCtx";
import { Notice } from "./ui";

/** Qué falta para enviar de verdad. Nunca dice qué variable exacta (eso está en la doc). */
export function ReadinessBanner() {
  const { m, store } = useMarketingCtx();
  const s = m.status;
  if (store.isDemo) {
    return (
      <Notice tone="info">
        Estás en la demo: podés armar audiencias, plantillas y campañas para ver cómo funciona, pero <b>no se envía nada</b>. Los
        contactos de ejemplo siempre quedan afuera de cualquier envío.
      </Notice>
    );
  }
  if (!s.checkedAt) return null;
  if (!s.reachable || !s.configured.db) {
    return (
      <Notice tone="warn">
        <b>Modo preparación.</b> Podés armar segmentos, plantillas y campañas, y registrar consentimientos y bajas en este
        navegador. Para enviar falta el servidor de marketing: el Supabase propio del CRM con la migración de marketing aplicada,
        el secreto de los links de baja y la URL pública del CRM. Ver <code>docs/marketing-puesta-en-marcha.md</code>.
      </Notice>
    );
  }
  const missing: string[] = [];
  if (!s.configured.email) missing.push("email (cuenta y dominio verificado en Resend)");
  if (!s.configured.whatsapp) missing.push("WhatsApp (app de Meta / Cloud API)");
  else if (s.whatsapp && !s.whatsapp.connected) missing.push("WhatsApp (conectá un número desde el Inbox)");
  return (
    <div className="space-y-2">
      {missing.length > 0 && <Notice tone="warn">Para enviar por {missing.join(" y por ")} falta configuración. El resto ya funciona.</Notice>}
      {!s.configured.sendEnabled && (
        <Notice tone="info">
          Los envíos reales están <b>apagados</b> por seguridad (MARKETING_SEND_ENABLED). Se encienden después de probar con un
          envío de prueba.
        </Notice>
      )}
      {!s.isAdmin && <Notice tone="info">Solo un administrador de la inmobiliaria puede enviar o programar campañas.</Notice>}
    </div>
  );
}
