import type { PortalMeta } from "@/lib/integrations/registry";

/** Logo simple del portal (iniciales sobre su color de marca). */
export function PortalLogo({ meta, size = 44 }: { meta: Pick<PortalMeta, "short" | "color" | "ink">; size?: number }) {
  return (
    <span
      className="rounded-xl flex items-center justify-center flex-shrink-0 text-sm"
      style={{ width: size, height: size, background: meta.color, color: meta.ink, fontWeight: 800 }}
      aria-hidden="true"
    >
      {meta.short}
    </span>
  );
}
