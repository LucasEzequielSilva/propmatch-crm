import { routeByAction } from "./_lib/router.js";
import status from "./_lib/routes/marketing/status.js";
import state from "./_lib/routes/marketing/state.js";
import consent from "./_lib/routes/marketing/consent.js";
import campaign from "./_lib/routes/marketing/campaign.js";
import dispatch from "./_lib/routes/marketing/dispatch.js";
import unsubscribe from "./_lib/routes/marketing/unsubscribe.js";
import resendWebhook from "./_lib/routes/marketing/resendWebhook.js";

/**
 * Una sola función para /api/marketing/* (campañas por email y WhatsApp, bajas
 * y consentimientos). `unsubscribe` y `resend-webhook` son públicas (token
 * firmado / firma Svix); el resto pide el JWT de la app.
 */
export default routeByAction("marketing", {
  status,
  state,
  consent,
  campaign,
  dispatch,
  unsubscribe,
  "resend-webhook": resendWebhook,
});
