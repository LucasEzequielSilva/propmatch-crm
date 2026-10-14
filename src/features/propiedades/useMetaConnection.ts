import { useCallback, useEffect, useState } from "react";
import { launchPublishLogin, metaEnv, SignupCancelled } from "@/lib/inbox/metaSdk";
import { metaApi, type MetaPublishStatus } from "@/lib/metaPublish";
import { metaPublishErrorText } from "../../../shared/metaPublish";

export interface PageChoice {
  id: string;
  name: string;
  instagram: string | null;
}

/**
 * Conexión de publicación con Meta (una sola para Facebook e Instagram).
 *
 * - Sin VITE_META_PUBLISH_ENABLED=1: `approvalPending` (la UI dice "Requiere
 *   aprobación de Meta") y no se consulta nada.
 * - Si /api no responde (vite dev) o falta configuración: `configured: false`.
 */
export function useMetaConnection() {
  const approvalPending = !metaEnv.publishEnabled;
  const [loading, setLoading] = useState(!approvalPending);
  const [status, setStatus] = useState<MetaPublishStatus>({ configured: false, enabled: false, connected: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pages, setPages] = useState<PageChoice[] | null>(null);

  const refresh = useCallback(async () => {
    if (approvalPending) return;
    const r = await metaApi<MetaPublishStatus>("publish-status");
    setStatus(r.ok && r.data ? r.data : { configured: false, enabled: false, connected: false });
    setLoading(false);
  }, [approvalPending]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clientReady = !!metaEnv.appId;

  const connect = useCallback(
    async (pageId?: string) => {
      setError(null);
      setNotice(null);
      setBusy(true);
      try {
        const code = await launchPublishLogin();
        const r = await metaApi<{ ok: boolean; choosePage?: PageChoice[]; page?: { name: string }; instagram?: { username: string | null } | null; missingScopes?: string[] }>(
          "publish-connect",
          { method: "POST", body: { code, pageId } },
        );
        if (!r.ok || !r.data) {
          setError(metaPublishErrorText(r.error));
          return;
        }
        if (r.data.choosePage) {
          setPages(r.data.choosePage);
          return;
        }
        setPages(null);
        const ig = r.data.instagram?.username ? ` e Instagram @${r.data.instagram.username}` : "";
        const missing = r.data.missingScopes?.length ? " Ojo: no aceptaste todos los permisos; puede que no se pueda publicar en algún canal." : "";
        setNotice(`Conectaste la Página ${r.data.page?.name ?? ""}${ig}.${missing}`);
        await refresh();
      } catch (e) {
        if (!(e instanceof SignupCancelled)) setError("No pudimos abrir el inicio de sesión de Facebook. Revisá que el navegador no bloquee ventanas emergentes.");
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const disconnect = useCallback(async () => {
    setError(null);
    setBusy(true);
    const r = await metaApi("publish-disconnect", { method: "POST", body: {} });
    setBusy(false);
    if (!r.ok) {
      setError(metaPublishErrorText(r.error));
      return;
    }
    setNotice("Desconectaste Facebook e Instagram. Lo que ya publicaste sigue publicado.");
    await refresh();
  }, [refresh]);

  const connected = !approvalPending && status.enabled && status.connected;
  return {
    approvalPending,
    loading,
    configured: !approvalPending && status.configured && clientReady,
    connected,
    needsReauth: !!status.needsReauth,
    pageName: status.page?.name ?? null,
    instagramUsername: status.instagram?.username ?? null,
    hasInstagram: connected && !!status.instagram,
    isAdmin: !!status.isAdmin,
    busy,
    error,
    notice,
    pages,
    connect,
    disconnect,
    cancelPagePick: () => setPages(null),
    refresh,
  };
}

export type MetaConnection = ReturnType<typeof useMetaConnection>;
