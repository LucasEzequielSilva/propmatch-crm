import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Card, SectionHeader } from "@/components/ui/Card";
import { useStore } from "@/data/store";
import { agencyPatch, canPublishBrand, fetchPublishedBrand, processLogo, publishBrand } from "@/lib/branding";
import {
  EMPTY_BRAND,
  PROPMATCH_PRIMARY,
  PROPMATCH_SECONDARY,
  brandCssVars,
  checkContrast,
  isHexColor,
  resolveBrand,
  sanitizeBrand,
  textOn,
  type AgencyBrand,
} from "../../../shared/brand";

const INK = "#1F0A3C";
const SOFT = "#6B5A8E";

const inputClass =
  "w-full px-4 py-2.5 rounded-xl text-sm border outline-none transition-all bg-white " +
  "text-[#1F0A3C] placeholder:text-[#7C6A99] border-[#EDE9FE] focus:border-[#7C3AED] focus:ring-4 focus:ring-[#EDE9FE] " +
  "disabled:bg-[#FAFAFF] disabled:text-[#7C6A99] disabled:cursor-not-allowed";

/**
 * Configuración → «Marca de tu inmobiliaria». Logo, colores (con chequeo de
 * contraste AA y vista previa) y datos de contacto que salen en la ficha para
 * clientes, el PDF y la web pública. Se guarda en este navegador y, con la
 * cuenta de una inmobiliaria real, se publica en el Storage (ver
 * src/lib/branding.ts).
 */
export function BrandingCard({ onSaved }: { onSaved: (msg: string) => void }) {
  const { agency, profile, updateAgency } = useStore();
  const canEdit = profile.role === "owner" || profile.role === "admin";
  const publishable = canPublishBrand(agency.id);
  const saved = agency.branding ?? null;
  const [form, setForm] = useState<AgencyBrand>(() => saved ?? { ...EMPTY_BRAND, phone: agency.phone, email: agency.email });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const id = useId();

  // Otro miembro de la agencia ya publicó la marca: se trae la publicada.
  const adoptedRef = useRef(false);
  useEffect(() => {
    if (!publishable || saved || adoptedRef.current) return;
    adoptedRef.current = true;
    fetchPublishedBrand(agency.id).then((b) => {
      if (!b) return;
      updateAgency(agencyPatch(agency, { branding: b }));
      setForm(b);
      setStatus("Trajimos la marca que ya estaba publicada para tu inmobiliaria.");
    });
  }, [publishable, saved, agency, updateAgency]);

  const set = <K extends keyof AgencyBrand>(k: K, v: AgencyBrand[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: keyof AgencyBrand) => ({
    value: (form[k] as string | null) ?? "",
    onChange: (e: { target: { value: string } }) => set(k, (e.target.value || null) as never),
    disabled: !canEdit,
    className: inputClass,
  });
  const dirty = JSON.stringify(form) !== JSON.stringify(saved ?? null);

  async function onLogo(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      set("logoUrl", await processLogo(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos leer el logo.");
    }
  }

  async function save() {
    if (!isHexColor(form.primary) || !isHexColor(form.secondary)) return setError("Los colores tienen que tener el formato #RRGGBB.");
    const clean = sanitizeBrand({ ...form, updatedAt: new Date().toISOString() }, { allowDataLogo: true });
    if (!clean) return setError("Revisá los datos.");
    if (form.email && !clean.email) return setError("Revisá el email.");
    if (form.website && !clean.website) return setError("Revisá la dirección de la web.");
    setError(null);
    updateAgency(agencyPatch(agency, { branding: clean }));
    setForm(clean);
    if (!publishable) {
      setStatus("Guardada en este navegador. Se publica en tu web cuando uses la cuenta de tu inmobiliaria.");
      onSaved("Marca guardada");
      return;
    }
    setBusy(true);
    setStatus("Publicando en tu web…");
    const r = await publishBrand(agency.id, clean);
    setBusy(false);
    if (r.ok) {
      updateAgency(agencyPatch(agency, { branding: r.brand }));
      setForm(r.brand);
      setStatus("Publicada: tu web y las fichas nuevas ya usan esta marca (puede tardar unos minutos en verse).");
      onSaved("Marca guardada y publicada");
    } else {
      setStatus(`Guardada en este navegador, pero no se publicó: ${r.error}`);
      onSaved("Marca guardada en este navegador");
    }
  }

  const resolved = resolveBrand(form, { name: agency.name, phone: agency.phone, email: agency.email });
  const btn = checkContrast(resolved.onPrimary, form.primary);
  const primaryText = checkContrast(form.primary, "#FFFFFF");
  const secondaryText = checkContrast(form.secondary, "#FFFFFF");

  return (
    <Card className="lg:col-span-2">
      <SectionHeader
        inCard
        title="Marca de tu inmobiliaria"
        subtitle={canEdit ? "Logo, colores y datos que ven tus clientes en la ficha, el PDF y tu web" : "Solo el dueño o un administrador puede editarla"}
      />
      <div className="p-5 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="grid gap-4 sm:grid-cols-2 content-start">
          {/* Logo */}
          <div className="sm:col-span-2 flex items-center gap-4">
            <div
              className="w-28 h-20 rounded-xl border flex items-center justify-center overflow-hidden flex-shrink-0"
              style={{ borderColor: "#EDE9FE", background: "repeating-conic-gradient(#F5F3FF 0% 25%, white 0% 50%) 50% / 16px 16px" }}
            >
              {form.logoUrl ? (
                <img src={form.logoUrl} alt="Logo actual" className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-xs" style={{ color: SOFT }}>Sin logo</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm" style={{ color: INK, fontWeight: 700 }}>Logo</p>
              <p className="text-xs" style={{ color: SOFT }}>PNG, JPG o SVG. Lo achicamos solo. Mejor con fondo transparente.</p>
              <div className="flex gap-2 mt-2">
                <input
                  ref={fileRef}
                  id={`${id}-logo`}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  className="sr-only"
                  disabled={!canEdit}
                  onChange={(e) => {
                    onLogo(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => fileRef.current?.click()}
                  className="min-h-9 px-3 rounded-lg text-xs border bg-white disabled:opacity-50"
                  style={{ borderColor: "#DDD6FE", color: "#5B21B6", fontWeight: 700 }}
                >
                  {form.logoUrl ? "Cambiar logo" : "Subir logo"}
                </button>
                {form.logoUrl && canEdit && (
                  <button type="button" onClick={() => set("logoUrl", null)} className="min-h-9 px-3 rounded-lg text-xs" style={{ color: "#BE123C", fontWeight: 700 }}>
                    Quitar
                  </button>
                )}
              </div>
            </div>
          </div>

          <ColorField
            label="Color principal"
            hint="Botones, títulos y detalles"
            value={form.primary}
            fallback={PROPMATCH_PRIMARY}
            disabled={!canEdit}
            onChange={(v) => set("primary", v)}
          />
          <ColorField
            label="Color secundario"
            hint="Degradés y acentos"
            value={form.secondary}
            fallback={PROPMATCH_SECONDARY}
            disabled={!canEdit}
            onChange={(v) => set("secondary", v)}
          />
          <div className="sm:col-span-2 rounded-xl p-3 text-xs grid gap-1" style={{ background: "#FAFAFF", color: INK }}>
            <ContrastLine ok={btn.aa} warn={btn.aaLarge} text={`Texto de los botones sobre el principal: ${btn.ratio}:1`} />
            <ContrastLine
              ok={primaryText.aa}
              warn={primaryText.aaLarge}
              adjusted
              text={
                primaryText.aa
                  ? `Principal sobre blanco: ${primaryText.ratio}:1`
                  : `Principal sobre blanco: ${primaryText.ratio}:1 — para los textos usamos un tono más oscuro (${resolved.accent})`
              }
            />
            <ContrastLine
              ok={secondaryText.aa}
              warn={secondaryText.aaLarge}
              adjusted
              text={
                secondaryText.aa
                  ? `Secundario sobre blanco: ${secondaryText.ratio}:1`
                  : `Secundario sobre blanco: ${secondaryText.ratio}:1 — para textos usamos ${resolved.accent2}`
              }
            />
            <p style={{ color: SOFT }}>AA pide 4,5:1 para texto normal y 3:1 para texto grande.</p>
          </div>

          <Field label="Nombre comercial" className="sm:col-span-2">
            <input {...text("displayName")} placeholder={agency.name} />
          </Field>
          <Field label="Teléfono">
            <input {...text("phone")} placeholder="011 4555-0000" />
          </Field>
          <Field label="WhatsApp (si es otro)">
            <input {...text("whatsapp")} placeholder="11 5555-0000" />
          </Field>
          <Field label="Email">
            <input {...text("email")} type="email" placeholder="hola@tuinmobiliaria.com" />
          </Field>
          <Field label="Matrícula (opcional)">
            <input {...text("license")} placeholder="CUCICBA 1234" />
          </Field>
          <Field label="Dirección" className="sm:col-span-2">
            <input {...text("address")} placeholder="Av. Cabildo 1234, Belgrano, CABA" />
          </Field>
          <Field label="Web">
            <input {...text("website")} placeholder="tuinmobiliaria.com.ar" />
          </Field>
          <Field label="Instagram">
            <input {...text("instagram")} placeholder="@tuinmobiliaria" />
          </Field>
          <Field label="Facebook">
            <input {...text("facebook")} placeholder="tuinmobiliaria" />
          </Field>
          <Field label="Texto al pie" className="sm:col-span-2">
            <textarea {...text("footer")} rows={2} placeholder="Ej: Más de 20 años en zona norte. Atendemos de lunes a sábados." />
          </Field>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm" style={{ color: INK }}>
            <input type="checkbox" checked={form.showPoweredBy} disabled={!canEdit} onChange={(e) => set("showPoweredBy", e.target.checked)} />
            Mostrar «Hecho con PropMatch» chiquito al pie
          </label>
        </div>

        {/* Vista previa */}
        <div>
          <p className="text-xs mb-2" style={{ color: SOFT, fontWeight: 700 }}>VISTA PREVIA</p>
          <BrandPreview brand={form} fallbackName={agency.name} fallbackPhone={agency.phone} fallbackEmail={agency.email} />
          <p className="text-xs mt-2" style={{ color: SOFT }}>
            {publishable
              ? "Al guardar se publica para tu web y para las fichas que mandes desde ahora."
              : "En la demo o sin inmobiliaria vinculada, la marca queda en este navegador (las fichas que mandes ya la usan)."}
          </p>
        </div>
      </div>
      {canEdit && (
        <div className="px-5 py-3.5 border-t flex flex-wrap items-center justify-end gap-3" style={{ borderColor: "#F3F0FF", background: "#FDFCFF" }}>
          {(error || status) && (
            <span role={error ? "alert" : "status"} className="mr-auto text-xs" style={{ color: error ? "#BE123C" : "#15803D", fontWeight: 600 }}>
              {error ?? status}
            </span>
          )}
          <button
            onClick={save}
            disabled={(!dirty && !!saved) || busy}
            className="px-5 py-2 rounded-xl text-sm text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "var(--gradient-brand)", fontWeight: 600 }}
          >
            {busy ? "Publicando…" : "Guardar marca"}
          </button>
        </div>
      )}
    </Card>
  );
}

function ContrastLine({ ok, warn, adjusted, text }: { ok: boolean; warn: boolean; adjusted?: boolean; text: string }) {
  return (
    <p className="flex items-start gap-1.5" style={{ color: ok ? "#15803D" : warn || adjusted ? "#B45309" : "#BE123C", fontWeight: 600 }}>
      <span aria-hidden="true">{ok ? "✓" : "!"}</span>
      <span>
        {ok ? "AA · " : adjusted ? "Ajustado · " : warn ? "Solo texto grande · " : "No llega a AA · "}
        {text}
      </span>
    </p>
  );
}

function ColorField({
  label,
  hint,
  value,
  fallback,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  fallback: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-xs mb-1.5" style={{ color: "#7C6A99", fontWeight: 600 }}>
        {label} <span style={{ fontWeight: 400 }}>· {hint}</span>
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: selector`}
          value={isHexColor(value) ? value : fallback}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="w-11 h-11 rounded-lg border cursor-pointer disabled:cursor-not-allowed"
          style={{ borderColor: "#EDE9FE", padding: 2, background: "white" }}
        />
        <input
          id={id}
          value={draft}
          disabled={disabled}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            setDraft(v);
            if (isHexColor(v)) onChange(v.toUpperCase());
          }}
          className={`${inputClass} font-mono uppercase`}
        />
      </div>
    </div>
  );
}

/** Mini ficha con la marca: encabezado, precio, botón y pie. */
export function BrandPreview({
  brand,
  fallbackName,
  fallbackPhone,
  fallbackEmail,
}: {
  brand: AgencyBrand;
  fallbackName: string;
  fallbackPhone: string | null;
  fallbackEmail: string | null;
}) {
  const r = resolveBrand(brand, { name: fallbackName, phone: fallbackPhone, email: fallbackEmail });
  return (
    <div className="rounded-2xl border overflow-hidden text-left" style={{ ...(brandCssVars(r) as CSSProperties), borderColor: r.border, background: "white" }}>
      <div className="px-4 py-3 flex items-center gap-2.5 border-b" style={{ borderColor: r.border }}>
        {r.logoUrl ? (
          <img src={r.logoUrl} alt="" className="h-8 max-w-[120px] object-contain" />
        ) : (
          <span className="w-8 h-8 rounded-lg flex items-center justify-center text-xs" style={{ background: r.gradient, color: textOn(r.primary), fontWeight: 800 }}>
            {r.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <span className="text-sm truncate" style={{ color: INK, fontWeight: 800 }}>{r.name}</span>
      </div>
      <div className="h-20" style={{ background: `linear-gradient(135deg, ${r.soft}, white)` }} />
      <div className="p-4">
        <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: r.soft, color: r.accent, fontWeight: 700 }}>Venta</span>
        <p className="text-sm mt-2" style={{ color: INK, fontWeight: 800 }}>Departamento 3 ambientes con balcón</p>
        <p className="text-lg mt-1" style={{ color: r.accent, fontWeight: 800 }}>USD 145.000</p>
        <span className="mt-3 inline-flex px-3 py-2 rounded-lg text-xs" style={{ background: r.primary, color: r.onPrimary, fontWeight: 700 }}>
          Consultar
        </span>
      </div>
      <div className="px-4 py-3 text-[11px] border-t" style={{ borderColor: r.border, color: SOFT }}>
        <p style={{ color: INK, fontWeight: 700 }}>{r.name}</p>
        <p>{[r.phone, r.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}</p>
        {r.address && <p>{r.address}</p>}
        {r.license && <p>Matrícula: {r.license}</p>}
        {r.footer && <p className="mt-1 whitespace-pre-line">{r.footer}</p>}
        {r.showPoweredBy && <p className="mt-1" style={{ fontSize: 10 }}>Hecho con PropMatch</p>}
      </div>
    </div>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs mb-1.5" style={{ color: "#7C6A99", fontWeight: 600 }}>
        {label}
      </span>
      {children}
    </label>
  );
}
