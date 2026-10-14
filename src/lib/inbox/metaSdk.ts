/**
 * Facebook JS SDK para Embedded Signup (WhatsApp) y Facebook Login for
 * Business (Messenger/Instagram). Solo se carga cuando el admin toca "Conectar".
 *
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
 */

interface FbLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}

interface FbSdk {
  init(opts: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }): void;
  login(cb: (r: FbLoginResponse) => void, opts: Record<string, unknown>): void;
}

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

/** Misma versión que el servidor (api/_lib/inbox/graph.ts). */
export const SDK_GRAPH_VERSION = "v25.0";

export const metaEnv = {
  appId: (import.meta.env.VITE_META_APP_ID as string | undefined) ?? "",
  waConfigId: (import.meta.env.VITE_META_WA_CONFIG_ID as string | undefined) ?? "",
  messagingConfigId: (import.meta.env.VITE_META_MESSAGING_CONFIG_ID as string | undefined) ?? "",
  /** IG/Messenger: apagado hasta que Meta apruebe los permisos. */
  messagingEnabled: import.meta.env.VITE_META_MESSAGING_ENABLED === "1",
  /** Configuración de Facebook Login for Business para PUBLICAR (Página + Instagram). */
  publishConfigId: (import.meta.env.VITE_META_PUBLISH_CONFIG_ID as string | undefined) ?? "",
  /** Publicar en Facebook/Instagram: apagado hasta que Meta apruebe los permisos. */
  publishEnabled: import.meta.env.VITE_META_PUBLISH_ENABLED === "1",
};

let loading: Promise<FbSdk> | null = null;

export function loadFacebookSdk(appId: string): Promise<FbSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  if (loading) return loading;
  loading = new Promise<FbSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: SDK_GRAPH_VERSION });
      resolve(window.FB!);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/es_LA/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => {
      loading = null;
      reject(new Error("sdk"));
    };
    document.body.appendChild(s);
  });
  return loading;
}

export interface WaSignupResult {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  businessId: string | null;
  coexistence: boolean;
}

export class SignupCancelled extends Error {}

/**
 * Lanza el Embedded Signup. `coexistence` = onboarding de usuarios de la app
 * WhatsApp Business (siguen usando el número en el celular).
 *
 * El `code` llega por el callback de FB.login y los ids por un postMessage
 * `WA_EMBEDDED_SIGNUP` desde facebook.com: esperamos los dos.
 */
export async function launchWhatsAppSignup(opts: { coexistence: boolean }): Promise<WaSignupResult> {
  const FB = await loadFacebookSdk(metaEnv.appId);

  return new Promise<WaSignupResult>((resolve, reject) => {
    let code: string | null = null;
    let session: { wabaId: string; phoneNumberId: string; businessId: string | null; coexistence: boolean } | null = null;
    let settled = false;

    const done = (err?: Error) => {
      if (settled) return;
      if (err) {
        settled = true;
        window.removeEventListener("message", onMessage);
        return reject(err);
      }
      if (code && session) {
        settled = true;
        window.removeEventListener("message", onMessage);
        resolve({ code, ...session });
      }
    };

    function onMessage(ev: MessageEvent) {
      let host = "";
      try {
        host = new URL(ev.origin).hostname;
      } catch {
        return;
      }
      if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return;
      let data: { type?: string; event?: string; data?: Record<string, unknown> };
      try {
        data = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      } catch {
        return;
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      const d = data.data ?? {};
      if (data.event === "CANCEL") return done(new SignupCancelled(String(d.current_step ?? d.error_message ?? "cancel")));
      if (typeof data.event === "string" && data.event.startsWith("FINISH")) {
        const wabaId = String(d.waba_id ?? "");
        const phoneNumberId = String(d.phone_number_id ?? "");
        if (!wabaId || !phoneNumberId) return done(new Error("missing_ids"));
        session = {
          wabaId,
          phoneNumberId,
          businessId: d.business_id ? String(d.business_id) : null,
          coexistence: data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" || opts.coexistence,
        };
        done();
      }
    }

    window.addEventListener("message", onMessage);

    const extras: Record<string, unknown> = { setup: {} };
    if (opts.coexistence) extras.featureType = "whatsapp_business_app_onboarding";

    FB.login(
      (r) => {
        const c = r.authResponse?.code;
        if (!c) return done(new SignupCancelled("login"));
        code = c;
        // Si el evento de sesión no llega en 15 s, no dejamos la UI colgada.
        setTimeout(() => done(new Error("no_session_info")), 15_000);
        done();
      },
      {
        config_id: metaEnv.waConfigId,
        response_type: "code",
        override_default_response_type: true,
        extras,
      },
    );
  });
}

/** Facebook Login for Business con permisos de mensajería → code. */
export async function launchMessagingLogin(): Promise<string> {
  const FB = await loadFacebookSdk(metaEnv.appId);
  return new Promise<string>((resolve, reject) => {
    FB.login(
      (r) => {
        const c = r.authResponse?.code;
        if (c) resolve(c);
        else reject(new SignupCancelled("login"));
      },
      { config_id: metaEnv.messagingConfigId, response_type: "code", override_default_response_type: true },
    );
  });
}

/**
 * OAuth estándar de Facebook para publicación (Página + Instagram).
 * Abre un popup al diálogo de OAuth de Facebook y escucha el code por postMessage
 * desde la página de callback (/oauth/meta/callback). No requiere config_id.
 */
export interface PublishLoginResult {
  code: string;
  redirectUri?: string;
}

export async function launchPublishLogin(): Promise<PublishLoginResult> {
  if (metaEnv.publishConfigId) {
    // Si hay config_id configurado, usar el flujo FB.login for Business.
    const FB = await loadFacebookSdk(metaEnv.appId);
    return new Promise<PublishLoginResult>((resolve, reject) => {
      FB.login(
        (r) => {
          const c = r.authResponse?.code;
          if (c) resolve({ code: c });
          else reject(new SignupCancelled("login"));
        },
        { config_id: metaEnv.publishConfigId, response_type: "code", override_default_response_type: true },
      );
    });
  }

  // Fallback: popup OAuth estándar (no requiere config_id).
  const redirectUri = `${window.location.origin}/oauth/meta/callback`;
  return new Promise<PublishLoginResult>((resolve, reject) => {
    const state = crypto.randomUUID();
    const params = new URLSearchParams({
      client_id: metaEnv.appId,
      redirect_uri: redirectUri,
      scope: "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management",
      response_type: "code",
      state,
    });
    const popup = window.open(
      `https://www.facebook.com/v25.0/dialog/oauth?${params}`,
      "meta_publish_login",
      "width=600,height=700,left=400,top=100",
    );
    if (!popup) return reject(new SignupCancelled("popup_blocked"));

    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.type !== "META_OAUTH_CODE") return;
      window.removeEventListener("message", onMessage);
      clearInterval(pollClosed);
      if (ev.data.code) resolve({ code: ev.data.code, redirectUri });
      else reject(new SignupCancelled("cancelled"));
    }
    window.addEventListener("message", onMessage);

    const pollClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(pollClosed);
        window.removeEventListener("message", onMessage);
        reject(new SignupCancelled("popup_closed"));
      }
    }, 500);
  });
}
