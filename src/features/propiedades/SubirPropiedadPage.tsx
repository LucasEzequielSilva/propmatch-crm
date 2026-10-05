import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card } from "@/components/ui/Card";
import {
  CheckIcon,
  HomeIcon,
  MapPinIcon,
  MatchesSolidIcon,
  PlusIcon,
  StarIcon,
} from "@/components/ui/icons";
import { useStore, type NewPropertyInput } from "@/data/store";
import { FEATURE_CHIPS, ZONES } from "@/data/seed";
import { computeMatch, MATCH_THRESHOLD } from "@/lib/matching";
import { PROPERTY_STATUS_LABEL, PROPERTY_TYPE_LABEL, money } from "@/lib/format";
import type {
  CurrencyCode,
  OperationType,
  Property,
  PropertyStatus,
  PropertyType,
} from "@/types/db";
import { compressImage } from "@/lib/images";
import { isShortMapsLink, isValidLatLng, parseCoordinates } from "@/lib/geo";
import { AUTHORIZATION_LABEL, AUTHORIZATION_TONE_STYLE, authorizationState, dateInputFromNow } from "@/lib/authorization";
import type { AuthorizationType } from "@/types/db";

const PROP_TYPES = Object.keys(PROPERTY_TYPE_LABEL) as PropertyType[];
const STATUSES = Object.keys(PROPERTY_STATUS_LABEL) as PropertyStatus[];
const OPERATIONS: { value: OperationType; label: string }[] = [
  { value: "venta", label: "Venta" },
  { value: "alquiler", label: "Alquiler" },
  { value: "alquiler_temporal", label: "Temporal" },
];

const MAX_PHOTO_MB = 10;

/**
 * Alta y edición de una propiedad.
 *
 * Es el mismo formulario para las dos cosas: con `:propertyId` en la ruta
 * arranca precargado y guarda sobre la propiedad existente. Duplicar la
 * pantalla habría significado mantener dos veces los seis bloques y la
 * validación.
 */
export default function SubirPropiedadPage() {
  const navigate = useNavigate();
  const { propertyId } = useParams();
  const [searchParams] = useSearchParams();
  const {
    addProperty,
    savePropertyEdit,
    propertyById,
    photos: allPhotos,
    profiles,
    profile,
    requirements,
    contacts,
    addContact,
  } = useStore();

  const editing = propertyById(propertyId);
  // Viene del Multipublicador: al guardar se sigue a elegir canales, no al listado.
  const publishAfter = !editing && searchParams.get("publicar") === "1";
  const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

  // Bloque 1 — información principal
  const [type, setType] = useState<PropertyType>(editing?.type ?? "casa");
  const [operation, setOperation] = useState<OperationType>(editing?.operation ?? "venta");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");

  // Bloque 2 — ubicación
  const [street, setStreet] = useState(editing?.street ?? "");
  const [streetNumber, setStreetNumber] = useState(editing?.street_number ?? "");
  // El campo edita la ZONA, que es lo que consume el motor de matching. Se
  // precarga con la zona guardada (la localidad puede ser más amplia: la
  // propiedad está en "La Plata" pero su zona es "La Plata Centro").
  const [locality, setLocality] = useState(editing?.zone ?? editing?.locality ?? "City Bell");
  const [province, setProvince] = useState(editing?.province ?? "Buenos Aires");
  const [lat, setLat] = useState(num(editing?.lat));
  const [lng, setLng] = useState(num(editing?.lng));
  const [mapsLink, setMapsLink] = useState("");
  const [mapsMsg, setMapsMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Bloque 3 — características
  const [price, setPrice] = useState(num(editing?.price));
  const [currency, setCurrency] = useState<CurrencyCode>(editing?.currency ?? "USD");
  const [surfaceTotal, setSurfaceTotal] = useState(num(editing?.surface_total));
  const [surfaceCovered, setSurfaceCovered] = useState(num(editing?.surface_covered));
  const [bedrooms, setBedrooms] = useState(editing?.bedrooms ?? 3);
  // Vacío = se sugiere dormitorios + 1 (estar). Un monoambiente o un
  // departamento con escritorio no siguen esa regla: se puede pisar.
  const [rooms, setRooms] = useState(num(editing?.rooms));
  const [bathrooms, setBathrooms] = useState(editing?.bathrooms ?? 2);
  const [garages, setGarages] = useState(editing?.garages ?? 1);
  const [age, setAge] = useState(num(editing?.age_years));

  // Bloque 4 — fotos
  const [photos, setPhotos] = useState<string[]>(editing ? (allPhotos[editing.id] ?? []) : []);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Bloque 5 — comercial
  const [expenses, setExpenses] = useState(num(editing?.expenses));
  const [taxes, setTaxes] = useState(num(editing?.taxes));
  const [commission, setCommission] = useState(editing ? num(editing.commission_pct) : "3");
  const [status, setStatus] = useState<PropertyStatus>(editing?.status ?? "disponible");
  const [agentId, setAgentId] = useState(editing?.owner_agent_id ?? profile.id);

  // Bloque 5b — propietario y autorización
  const [ownerId, setOwnerId] = useState(editing?.owner_contact_id ?? "");
  const [authType, setAuthType] = useState<AuthorizationType | "">(editing?.authorization_type ?? "");
  const [authExpires, setAuthExpires] = useState(editing?.authorization_expires_at ?? "");
  /** `null` mientras no se está cargando un propietario nuevo. */
  const [newOwner, setNewOwner] = useState<{ name: string; phone: string } | null>(null);

  // Bloque 6 — preferencias de match
  const [features, setFeatures] = useState<Set<string>>(
    new Set(editing?.features ?? ["Jardín", "Cochera"]),
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [showExit, setShowExit] = useState(false);

  /**
   * "Cambios sin guardar" comparando contra el estado inicial. En alta eso es
   * el formulario vacío; en edición, la propiedad tal como estaba.
   */
  const snapshot = JSON.stringify([
    type, operation, title, description, street, streetNumber, locality, province, lat, lng,
    price, currency, surfaceTotal, surfaceCovered, rooms, bedrooms, bathrooms, garages, age,
    photos, expenses, taxes, commission, status, agentId, [...features].sort(),
    ownerId, authType, authExpires,
  ]);
  const initialSnapshot = useRef(snapshot);
  const touched = snapshot !== initialSnapshot.current;

  /** Cancelar vuelve a la ficha si se estaba editando, o al listado si es alta. */
  const cancelTarget = editing ? `/propiedades/${editing.id}` : "/propiedades";

  /**
   * Si la propiedad tiene una zona que no está en la lista fija, se agrega:
   * un <select> cuyo value no existe entre sus opciones muestra la primera y
   * al guardar reescribiría la zona sin que nadie lo pida.
   */
  const zoneOptions = ZONES.includes(locality) ? ZONES : [locality, ...ZONES];

  /**
   * Potencial de match en vivo.
   *
   * En el prototipo este bloque decía "Alto · podría coincidir con 18 contactos"
   * como texto fijo. Acá corre el mismo motor que usa la pantalla de Matches
   * contra los requerimientos reales, mientras se completa el formulario.
   */
  const roomsValue = rooms ? Number(rooms) : bedrooms + 1;
  /** Las dos o ninguna: media coordenada no sirve para nada. */
  const coords = (() => {
    if (!lat.trim() || !lng.trim()) return null;
    const la = Number(lat);
    const ln = Number(lng);
    return isValidLatLng(la, ln) ? { lat: la, lng: ln } : null;
  })();

  function applyMapsLink(text: string) {
    setMapsLink(text);
    if (!text.trim()) return setMapsMsg(null);
    const found = parseCoordinates(text);
    if (found) {
      setLat(String(found.lat));
      setLng(String(found.lng));
      setMapsMsg({ kind: "ok", text: "Listo: tomamos las coordenadas del link." });
    } else if (isShortMapsLink(text)) {
      setMapsMsg({
        kind: "error",
        text: "Los links cortos (maps.app.goo.gl) no traen coordenadas. Abrilo en el navegador y copiá la dirección larga de la barra.",
      });
    } else {
      setMapsMsg({ kind: "error", text: "No encontramos coordenadas en ese texto." });
    }
  }

  const potential = useMemo(() => {
    const priceNum = Number(price) || null;
    if (!priceNum) return null;

    const draft: Property = {
      id: "draft",
      agency_id: "",
      owner_agent_id: agentId,
      owner_contact_id: ownerId || null,
      authorization_type: authType || null,
      authorization_expires_at: authExpires || null,
      title,
      description,
      type,
      operation,
      status: "disponible",
      street,
      street_number: streetNumber,
      locality,
      province,
      zone: locality,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      price: priceNum,
      currency,
      expenses: null,
      taxes: null,
      commission_pct: null,
      surface_total: Number(surfaceTotal) || null,
      surface_covered: Number(surfaceCovered) || null,
      rooms: roomsValue,
      bedrooms,
      bathrooms,
      garages,
      age_years: null,
      features: [...features],
      is_featured: false,
      published_to_marketplace: false,
      published_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const hits = requirements
      .filter((r) => r.is_active && r.operation === operation)
      .map((r) => computeMatch(r, draft).score)
      .filter((s) => s >= MATCH_THRESHOLD);

    return {
      count: hits.length,
      best: hits.length ? Math.max(...hits) : 0,
      level: hits.length >= 6 ? "Alto" : hits.length >= 3 ? "Medio" : hits.length ? "Bajo" : "Sin coincidencias",
    };
  }, [
    price, currency, type, operation, locality, province, street, streetNumber,
    surfaceTotal, surfaceCovered, bedrooms, bathrooms, garages, features,
    requirements, title, description, agentId, roomsValue,
  ]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "El título es obligatorio";
    if (!price.trim()) e.price = "El precio es obligatorio";
    else if (Number.isNaN(Number(price))) e.price = "El precio debe ser un número";
    if (!street.trim()) e.street = "La dirección es obligatoria";
    if ((lat.trim() || lng.trim()) && !coords) e.coords = "Revisá las coordenadas: latitud entre -90 y 90, longitud entre -180 y 180";
    if (authType && !authExpires) e.authExpires = "Poné hasta cuándo vale la autorización";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSave() {
    if (!validate()) {
      setToast({ kind: "error", text: "Revisá los campos marcados e intentá nuevamente." });
      return;
    }

    const input: NewPropertyInput = {
      title: title.trim(),
      description: description.trim() || null,
      type,
      operation,
      status,
      street: street.trim() || null,
      street_number: streetNumber.trim() || null,
      locality,
      province,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      price: Number(price),
      currency,
      expenses: expenses ? Number(expenses) : null,
      taxes: taxes ? Number(taxes) : null,
      commission_pct: commission ? Number(commission) : null,
      surface_total: surfaceTotal ? Number(surfaceTotal) : null,
      surface_covered: surfaceCovered ? Number(surfaceCovered) : null,
      rooms: roomsValue,
      bedrooms,
      bathrooms,
      garages,
      age_years: age ? Number(age) : null,
      features: [...features],
      owner_agent_id: agentId,
      owner_contact_id: ownerId || null,
      authorization_type: authType || null,
      authorization_expires_at: authType ? authExpires || null : null,
      photos,
    };

    if (editing) {
      savePropertyEdit(editing.id, input);
      initialSnapshot.current = snapshot;
      setToast({ kind: "ok", text: "Los cambios fueron guardados." });
      setTimeout(() => navigate(`/propiedades/${editing.id}`), 900);
    } else {
      const created = addProperty(input);
      const count = potential?.count ?? 0;
      if (publishAfter) {
        setToast({ kind: "ok", text: "Propiedad guardada. Ahora elegí dónde publicarla." });
        setTimeout(() => navigate(`/publicador/${created.id}`), 900);
      } else if (count > 0) {
        setToast({
          kind: "ok",
          text: `Propiedad agregada. Coincide con ${count} ${count === 1 ? "cliente" : "clientes"}: avisales por WhatsApp.`,
        });
        setTimeout(() => navigate(`/propiedades/${created.id}?compartir=1`), 1100);
      } else {
        setToast({ kind: "ok", text: "La propiedad fue agregada correctamente." });
        setTimeout(() => navigate("/propiedades"), 900);
      }
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const accepted: string[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
        setToast({ kind: "error", text: `"${file.name}" supera los ${MAX_PHOTO_MB} MB.` });
        continue;
      }
      try {
        accepted.push(await compressImage(file));
      } catch {
        setToast({ kind: "error", text: `No pudimos leer "${file.name}".` });
      }
    }
    if (accepted.length) setPhotos((prev) => [...prev, ...accepted]);
  }

  return (
    <>
      <AppHeader
        title={editing ? "Editar propiedad" : "Subir propiedad"}
        breadcrumb={["Propiedades", editing ? editing.title : "Nueva propiedad"]}
        subtitle={
          editing
            ? "Los matches se recalculan solos al guardar."
            : "Agregá una nueva propiedad a tu cartera."
        }
        compact
      >
        <button
          onClick={() => (touched ? setShowExit(true) : navigate(cancelTarget))}
          className="px-5 py-2.5 rounded-xl text-sm border transition-all hover:border-violet-300"
          style={{ borderColor: "#EDE9FE", color: "#7C6A99", fontWeight: 600, background: "white" }}
        >
          Cancelar
        </button>
        <button
          onClick={handleSave}
          className="px-5 py-2.5 rounded-xl text-sm text-white transition-all hover:opacity-90 active:scale-95"
          style={{ background: "var(--gradient-brand)", fontWeight: 600, boxShadow: "var(--shadow-cta)" }}
        >
          {editing ? "Guardar cambios" : "Guardar propiedad"}
        </button>
      </AppHeader>

      <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-28">
        {publishAfter && (
          <ol
            aria-label="Pasos para publicar"
            className="mt-6 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 rounded-2xl border px-4 py-3 text-sm"
            style={{ background: "#F5F3FF", borderColor: "#EDE9FE" }}
          >
            <li aria-current="step" className="flex items-center gap-2" style={{ color: "#1F0A3C", fontWeight: 700 }}>
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white" style={{ background: "#7C3AED" }}>1</span>
              Paso 1 de 2 · Cargá la propiedad
            </li>
            <li className="flex items-center gap-2" style={{ color: "#6B5A8E", fontWeight: 600 }}>
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs border" style={{ borderColor: "#C4B5FD", color: "#6B5A8E" }}>2</span>
              Paso 2 · Elegí dónde publicar
            </li>
          </ol>
        )}
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
          <div className="space-y-6 min-w-0">
            {/* Bloque 1 */}
            <Section title="Información de la propiedad" icon={<HomeIcon size={16} color="#7C3AED" />}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tipo de propiedad">
                  <select value={type} onChange={(e) => setType(e.target.value as PropertyType)} className={selectClass}>
                    {PROP_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {PROPERTY_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Operación">
                  <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: "#F5F3FF" }}>
                    {OPERATIONS.map((op) => (
                      <button
                        key={op.value}
                        type="button"
                        onClick={() => setOperation(op.value)}
                        className="flex-1 px-3 py-1.5 rounded-lg text-sm transition-all"
                        style={
                          operation === op.value
                            ? {
                                background: "var(--gradient-brand)",
                                color: "white",
                                fontWeight: 600,
                                boxShadow: "0 2px 8px rgba(124,58,237,0.25)",
                              }
                            : { color: "#7C6A99", fontWeight: 500 }
                        }
                      >
                        {op.label}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>

              <Field label="Título de la propiedad" error={errors.title}>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Casa moderna con jardín en City Bell"
                  className={inputClass(!!errors.title)}
                />
              </Field>

              <Field label="Descripción">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Describí las principales características de la propiedad…"
                  className={`${inputClass(false)} resize-none`}
                />
              </Field>
            </Section>

            {/* Bloque 2 */}
            <Section title="Ubicación" icon={<MapPinIcon size={16} color="#7C3AED" />}>
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="sm:col-span-3">
                  <Field label="Dirección" error={errors.street}>
                    <input
                      value={street}
                      onChange={(e) => setStreet(e.target.value)}
                      placeholder="Calle 13"
                      className={inputClass(!!errors.street)}
                    />
                  </Field>
                </div>
                <Field label="Número">
                  <input
                    value={streetNumber}
                    onChange={(e) => setStreetNumber(e.target.value)}
                    placeholder="450"
                    className={inputClass(false)}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Zona">
                  <select value={locality} onChange={(e) => setLocality(e.target.value)} className={selectClass}>
                    {zoneOptions.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Provincia">
                  <input
                    value={province}
                    onChange={(e) => setProvince(e.target.value)}
                    className={inputClass(false)}
                  />
                </Field>
              </div>

              <div className="rounded-xl p-4 space-y-3" style={{ background: "#FAFAFF", border: "1px solid #EDE9FE" }}>
                <Field label="Pegá un link de Google Maps (opcional)">
                  <input
                    value={mapsLink}
                    onChange={(e) => applyMapsLink(e.target.value)}
                    placeholder="https://www.google.com/maps/place/…/@-34.87,-58.04,17z"
                    className={inputClass(false)}
                  />
                </Field>
                {mapsMsg && (
                  <p className="text-xs" role="status" style={{ color: mapsMsg.kind === "ok" ? "#15803D" : "#B45309", fontWeight: 600 }}>
                    {mapsMsg.text}
                  </p>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Latitud" error={errors.coords}>
                    <input
                      value={lat}
                      onChange={(e) => setLat(e.target.value.replace(/[^\d.-]/g, ""))}
                      inputMode="decimal"
                      placeholder="-34.8712"
                      className={inputClass(!!errors.coords)}
                    />
                  </Field>
                  <Field label="Longitud">
                    <input
                      value={lng}
                      onChange={(e) => setLng(e.target.value.replace(/[^\d.-]/g, ""))}
                      inputMode="decimal"
                      placeholder="-58.0456"
                      className={inputClass(!!errors.coords)}
                    />
                  </Field>
                </div>
                <p className="text-xs" style={{ color: "#7458C4" }}>
                  Quedan guardadas en el CRM. Todavía no se mandan a la app.
                  {coords && (
                    <>
                      {" "}
                      <a
                        href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#7C3AED", fontWeight: 600 }}
                      >
                        Ver en Google Maps
                      </a>
                    </>
                  )}
                </p>
              </div>
            </Section>

            {/* Bloque 3 */}
            <Section title="Características" icon={<HomeIcon size={16} color="#7C3AED" />}>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Field label="Precio" error={errors.price}>
                    <input
                      value={price}
                      onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
                      inputMode="numeric"
                      placeholder="185000"
                      className={inputClass(!!errors.price)}
                    />
                  </Field>
                </div>
                <Field label="Moneda">
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                    className={selectClass}
                  >
                    <option value="USD">USD</option>
                    <option value="ARS">ARS</option>
                  </select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Superficie total (m²)">
                  <input
                    value={surfaceTotal}
                    onChange={(e) => setSurfaceTotal(e.target.value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                    placeholder="220"
                    className={inputClass(false)}
                  />
                </Field>
                <Field label="Superficie cubierta (m²)">
                  <input
                    value={surfaceCovered}
                    onChange={(e) => setSurfaceCovered(e.target.value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                    placeholder="180"
                    className={inputClass(false)}
                  />
                </Field>
                <Field label="Antigüedad (años)">
                  <input
                    value={age}
                    onChange={(e) => setAge(e.target.value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                    placeholder="0"
                    className={inputClass(false)}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Ambientes">
                  <input
                    value={rooms}
                    onChange={(e) => setRooms(e.target.value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                    placeholder={`${bedrooms + 1} (sugerido)`}
                    className={inputClass(false)}
                  />
                </Field>
                <Stepper label="Dormitorios" value={bedrooms} onChange={setBedrooms} />
                <Stepper label="Baños" value={bathrooms} onChange={setBathrooms} />
                <Stepper label="Cocheras" value={garages} onChange={setGarages} />
              </div>
            </Section>

            {/* Bloque 4 */}
            <Section title="Fotos de la propiedad" icon={<StarIcon size={16} color="#7C3AED" />}>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  addFiles(e.dataTransfer.files);
                }}
                onClick={() => fileInput.current?.click()}
                className="rounded-xl border-2 border-dashed p-8 flex flex-col items-center justify-center cursor-pointer transition-all"
                style={{
                  borderColor: dragOver ? "#7C3AED" : "#DDD6FE",
                  background: dragOver ? "#F5F3FF" : "#FDFCFF",
                }}
              >
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  hidden
                  onChange={(e) => addFiles(e.target.files)}
                />
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
                  style={{ background: "var(--gradient-soft)", border: "1px solid #EDE9FE" }}
                >
                  <StarIcon size={20} color="#7C3AED" />
                </div>
                <p className="text-sm" style={{ color: "#1F0A3C", fontWeight: 700 }}>
                  Arrastrá las fotos acá
                </p>
                <p className="text-xs mt-1" style={{ color: "#7C6A99" }}>
                  o <span style={{ color: "#7C3AED", fontWeight: 600 }}>seleccionar archivos</span>
                </p>
                <p className="text-xs mt-2" style={{ color: "#7C6A99" }}>
                  JPG, PNG o WEBP · Máximo {MAX_PHOTO_MB} MB
                </p>
              </div>

              {photos.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                  {photos.map((url, idx) => (
                    <div
                      key={url}
                      className="relative rounded-xl overflow-hidden group"
                      style={{ aspectRatio: "3/2", background: "#F5F3FF" }}
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      {idx === 0 && (
                        <span
                          className="absolute top-2 left-2 text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: "var(--gradient-brand)",
                            color: "white",
                            fontWeight: 700,
                            fontSize: 10,
                          }}
                        >
                          Portada
                        </span>
                      )}
                      <div className="absolute inset-x-2 bottom-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {idx !== 0 && (
                          <button
                            onClick={() =>
                              setPhotos((prev) => [prev[idx], ...prev.filter((_, i) => i !== idx)])
                            }
                            className="flex-1 py-1 rounded-lg text-xs backdrop-blur-sm"
                            style={{ background: "rgba(255,255,255,0.9)", color: "#7C3AED", fontWeight: 600 }}
                          >
                            Portada
                          </button>
                        )}
                        <button
                          onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                          className="flex-1 py-1 rounded-lg text-xs backdrop-blur-sm"
                          style={{ background: "rgba(255,255,255,0.9)", color: "#E11D48", fontWeight: 600 }}
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Bloque 5 */}
            <Section title="Información comercial" icon={<HomeIcon size={16} color="#7C3AED" />}>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Expensas">
                  <input
                    value={expenses}
                    onChange={(e) => setExpenses(e.target.value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                    placeholder="45000"
                    className={inputClass(false)}
                  />
                </Field>
                <Field label="Impuestos">
                  <input
                    value={taxes}
                    onChange={(e) => setTaxes(e.target.value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                    placeholder="12000"
                    className={inputClass(false)}
                  />
                </Field>
                <Field label="Comisión (%)">
                  <input
                    value={commission}
                    onChange={(e) => setCommission(e.target.value.replace(/[^\d.]/g, ""))}
                    inputMode="decimal"
                    className={inputClass(false)}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Estado de la propiedad">
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as PropertyStatus)}
                    className={selectClass}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {PROPERTY_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Agente responsable">
                  <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={selectClass}>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </Section>

            {/* Bloque 5b */}
            <Section
              title="Propietario y autorización"
              subtitle="Nunca se muestra en la ficha que recibe el cliente"
              icon={<StarIcon size={16} color="#7C3AED" />}
            >
              {newOwner ? (
                <div className="rounded-xl p-4 space-y-3" style={{ background: "#FAFAFF", border: "1px solid #EDE9FE" }}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Nombre del propietario">
                      <input
                        autoFocus
                        value={newOwner.name}
                        onChange={(e) => setNewOwner({ ...newOwner, name: e.target.value })}
                        placeholder="Graciela Benítez"
                        className={inputClass(false)}
                      />
                    </Field>
                    <Field label="Teléfono">
                      <input
                        value={newOwner.phone}
                        onChange={(e) => setNewOwner({ ...newOwner, phone: e.target.value })}
                        placeholder="+54 221 520 1144"
                        className={inputClass(false)}
                      />
                    </Field>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setNewOwner(null)}
                      className="px-4 py-2 rounded-xl text-xs"
                      style={{ color: "#7C6A99", fontWeight: 600 }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={!newOwner.name.trim()}
                      onClick={() => {
                        const c = addContact({
                          full_name: newOwner.name.trim(),
                          phone: newOwner.phone.trim() || null,
                          email: null,
                          kind: "propietario",
                          status: "activo",
                          profile_type: null,
                          notes: null,
                          owner_id: agentId,
                          requirement: null,
                        });
                        setOwnerId(c.id);
                        setNewOwner(null);
                      }}
                      className="px-4 py-2 rounded-xl text-xs text-white disabled:opacity-50"
                      style={{ background: "var(--gradient-brand)", fontWeight: 600 }}
                    >
                      Agregar propietario
                    </button>
                  </div>
                </div>
              ) : (
                <Field label="Propietario">
                  <div className="flex gap-2">
                    <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={selectClass}>
                      <option value="">Sin propietario cargado</option>
                      <optgroup label="Propietarios">
                        {contacts
                          .filter((c) => c.kind === "propietario")
                          .sort((a, b) => a.full_name.localeCompare(b.full_name))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.full_name}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Otros contactos">
                        {contacts
                          .filter((c) => c.kind !== "propietario")
                          .sort((a, b) => a.full_name.localeCompare(b.full_name))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.full_name}
                            </option>
                          ))}
                      </optgroup>
                    </select>
                    <button
                      type="button"
                      onClick={() => setNewOwner({ name: "", phone: "" })}
                      className="px-3.5 rounded-xl text-xs border whitespace-nowrap transition-all hover:bg-violet-50"
                      style={{ borderColor: "#EDE9FE", color: "#7C3AED", fontWeight: 600, background: "white" }}
                    >
                      + Nuevo
                    </button>
                  </div>
                </Field>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Autorización">
                  <select
                    value={authType}
                    onChange={(e) => {
                      const value = e.target.value as AuthorizationType | "";
                      setAuthType(value);
                      // Lo más común: 90 días. Se propone solo si no había fecha.
                      if (value && !authExpires) setAuthExpires(dateInputFromNow(90));
                    }}
                    className={selectClass}
                  >
                    <option value="">Sin autorización firmada</option>
                    {(Object.keys(AUTHORIZATION_LABEL) as AuthorizationType[]).map((t) => (
                      <option key={t} value={t}>
                        {AUTHORIZATION_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Vence el" error={errors.authExpires}>
                  <input
                    type="date"
                    value={authType ? authExpires : ""}
                    disabled={!authType}
                    onChange={(e) => setAuthExpires(e.target.value)}
                    className={inputClass(!!errors.authExpires) + " disabled:opacity-50"}
                  />
                </Field>
              </div>
              {authType && authExpires && (() => {
                const st = authorizationState(authType, authExpires);
                const style = AUTHORIZATION_TONE_STYLE[st.tone];
                return (
                  <p
                    className="text-xs px-3 py-2 rounded-lg inline-block"
                    style={{ background: style.bg, color: style.text, border: `1px solid ${style.border}`, fontWeight: 600 }}
                  >
                    {st.label}
                  </p>
                );
              })()}
            </Section>
          </div>

          {/* Columna derecha: preferencias de match */}
          <div className="space-y-6 lg:sticky lg:top-0">
            <Section
              title="Preferencias para Match"
              icon={<MatchesSolidIcon size={16} color="#7C3AED" />}
              subtitle="Lo que tiene la propiedad: se compara con lo que busca cada contacto."
            >
              <Field label="Características de la propiedad">
                <div className="flex flex-wrap gap-2">
                  {FEATURE_CHIPS.map((f) => (
                    <Chip
                      key={f}
                      label={f}
                      active={features.has(f)}
                      onClick={() =>
                        setFeatures((prev) => {
                          const next = new Set(prev);
                          if (next.has(f)) next.delete(f);
                          else next.add(f);
                          return next;
                        })
                      }
                    />
                  ))}
                </div>
              </Field>

              {/* Potencial de match en vivo */}
              <div
                className="rounded-xl p-4"
                style={{ background: "var(--gradient-soft)", border: "1px solid #EDE9FE" }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--gradient-brand)" }}
                  >
                    <MatchesSolidIcon size={14} />
                  </div>
                  <div>
                    <p
                      className="text-xs uppercase"
                      style={{ color: "#7458C4", fontWeight: 700, letterSpacing: "0.08em" }}
                    >
                      Potencial de match
                    </p>
                    <p className="text-sm text-gradient-brand-h" style={{ fontWeight: 800 }}>
                      {potential?.level ?? "Cargá el precio"}
                    </p>
                  </div>
                </div>
                <p className="text-xs" style={{ color: "#7C6A99" }}>
                  {potential === null
                    ? "Completá el precio para calcular con quién podría encajar."
                    : potential.count === 0
                      ? "Todavía ningún contacto de tu cartera encaja con estos datos."
                      : `Coincide con ${potential.count} ${potential.count === 1 ? "contacto" : "contactos"} de tu cartera. Mejor compatibilidad: ${potential.best}%.`}
                </p>
                {potential && potential.count > 0 && (
                  <button
                    onClick={() => navigate("/matches")}
                    className="w-full mt-3 py-2 rounded-lg text-xs text-white transition-all hover:opacity-90"
                    style={{ background: "var(--gradient-brand)", fontWeight: 600 }}
                  >
                    Ver matches
                  </button>
                )}
              </div>
            </Section>

            {/* Resumen */}
            <Card padded>
              <p
                className="text-xs uppercase mb-3"
                style={{ color: "#7458C4", fontWeight: 700, letterSpacing: "0.1em" }}
              >
                Resumen
              </p>
              <div className="space-y-2">
                <SummaryRow label="Tipo" value={PROPERTY_TYPE_LABEL[type]} />
                <SummaryRow label="Operación" value={OPERATIONS.find((o) => o.value === operation)!.label} />
                <SummaryRow label="Precio" value={price ? money(Number(price), currency) : "—"} />
                <SummaryRow label="Ubicación" value={locality} />
                <SummaryRow label="Ambientes" value={`${roomsValue}`} />
                <SummaryRow label="Fotos" value={`${photos.length}`} />
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Footer fijo */}
      <div
        className="flex-shrink-0 flex items-center justify-between gap-4 px-4 md:px-8 py-4 border-t"
        style={{ borderColor: "#EDE9FE", background: "#FDFCFF" }}
      >
        <span className="text-xs" style={{ color: "#7458C4" }}>
          {touched
            ? "Cambios sin guardar"
            : editing
              ? "Sin cambios"
              : "Completá los campos obligatorios"}
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => (touched ? setShowExit(true) : navigate(cancelTarget))}
            className="px-5 py-2.5 rounded-xl text-sm border transition-all hover:border-violet-300"
            style={{ borderColor: "#EDE9FE", color: "#7C6A99", fontWeight: 600, background: "white" }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2.5 rounded-xl text-sm text-white transition-all hover:opacity-90 active:scale-95"
            style={{ background: "var(--gradient-brand)", fontWeight: 600, boxShadow: "var(--shadow-cta)" }}
          >
            {editing ? "Guardar cambios" : "Guardar propiedad"}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="pm-toast fixed bottom-6 right-6 z-50 rounded-2xl px-5 py-4 flex items-start gap-3 max-w-sm"
          style={{
            background: "white",
            border: `1px solid ${toast.kind === "ok" ? "#BBF7D0" : "#FECDD3"}`,
            boxShadow: "var(--shadow-pop)",
          }}
          role="status"
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: toast.kind === "ok" ? "#F0FDF4" : "#FFF1F2" }}
          >
            {toast.kind === "ok" ? (
              <CheckIcon size={14} color="#16A34A" />
            ) : (
              <span style={{ color: "#E11D48", fontWeight: 700 }}>!</span>
            )}
          </div>
          <div>
            <p className="text-sm" style={{ color: "#1F0A3C", fontWeight: 700 }}>
              {toast.kind === "ok"
                ? editing
                  ? "Cambios guardados"
                  : "Propiedad guardada"
                : "No pudimos guardar la propiedad"}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "#7C6A99" }}>
              {toast.text}
            </p>
          </div>
          <button
            onClick={() => setToast(null)}
            aria-label="Cerrar"
            style={{ color: "#7C6A99", lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Confirmación de salida */}
      {showExit && (
        <div
          className="pm-backdrop fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(31,10,60,0.35)" }}
          onClick={() => setShowExit(false)}
        >
          <div
            className="pm-modal rounded-2xl p-6 max-w-sm w-full"
            style={{ background: "white", boxShadow: "var(--shadow-pop)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-lg" style={{ color: "#1F0A3C", fontWeight: 800 }}>
              ¿Salir sin guardar?
            </p>
            <p className="text-sm mt-1.5" style={{ color: "#7C6A99" }}>
              Los cambios realizados todavía no fueron guardados.
            </p>
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={() => setShowExit(false)}
                className="flex-1 py-2.5 rounded-xl text-sm border transition-all hover:border-violet-300"
                style={{ borderColor: "#EDE9FE", color: "#7C3AED", fontWeight: 600 }}
              >
                Seguir editando
              </button>
              <button
                onClick={() => navigate(cancelTarget)}
                className="flex-1 py-2.5 rounded-xl text-sm text-white transition-all hover:opacity-90"
                style={{ background: "var(--gradient-brand)", fontWeight: 600 }}
              >
                Salir sin guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Piezas del formulario ───────────────────────────────────────────────── */

const inputClass = (hasError: boolean) =>
  "w-full px-4 py-2.5 rounded-xl text-sm border outline-none transition-all bg-white " +
  "text-[#1F0A3C] placeholder:text-[#7C6A99] focus:ring-4 focus:ring-[#EDE9FE] " +
  (hasError ? "border-[#FECDD3] focus:border-[#FB7185]" : "border-[#EDE9FE] focus:border-[#7C3AED]");

const selectClass =
  "w-full px-4 py-2.5 rounded-xl text-sm border outline-none transition-all bg-white " +
  "text-[#1F0A3C] border-[#EDE9FE] focus:border-[#7C3AED] focus:ring-4 focus:ring-[#EDE9FE]";

function Section({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="px-5 py-4 border-b flex items-center gap-3" style={{ borderColor: "#F3F0FF" }}>
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "#F5F3FF" }}
        >
          {icon}
        </div>
        <div>
          <p className="text-sm" style={{ color: "#1F0A3C", fontWeight: 700 }}>
            {title}
          </p>
          {subtitle && (
            <p className="text-xs mt-0.5" style={{ color: "#7458C4" }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </Card>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs mb-1.5" style={{ color: "#7C6A99", fontWeight: 600 }}>
        {label}
      </span>
      {children}
      {error && (
        <span className="block text-xs mt-1.5" style={{ color: "#E11D48", fontWeight: 500 }}>
          {error}
        </span>
      )}
    </label>
  );
}

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <span className="block text-xs mb-1.5" style={{ color: "#7C6A99", fontWeight: 600 }}>
        {label}
      </span>
      <div
        className="flex items-center justify-between px-2 py-1.5 rounded-xl border"
        style={{ borderColor: "#EDE9FE", background: "white" }}
      >
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          aria-label={`Restar ${label}`}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-violet-50"
          style={{ background: "#F5F3FF", color: "#7C3AED", fontWeight: 700 }}
        >
          −
        </button>
        <span className="text-sm" style={{ color: "#1F0A3C", fontWeight: 700 }}>
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          aria-label={`Sumar ${label}`}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-violet-50"
          style={{ background: "#F5F3FF" }}
        >
          <PlusIcon size={12} color="#7C3AED" />
        </button>
      </div>
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs px-3 py-1.5 rounded-full transition-all border"
      style={
        active
          ? {
              background: "var(--gradient-brand)",
              color: "white",
              borderColor: "transparent",
              fontWeight: 600,
            }
          : { background: "white", color: "#7C6A99", borderColor: "#EDE9FE", fontWeight: 500 }
      }
    >
      {active && "✓ "}
      {label}
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs" style={{ color: "#7458C4" }}>
        {label}
      </span>
      <span className="text-xs truncate" style={{ color: "#1F0A3C", fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}
