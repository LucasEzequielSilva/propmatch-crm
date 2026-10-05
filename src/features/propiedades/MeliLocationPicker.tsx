/**
 * Selector de ubicación en el árbol de Mercado Libre (provincia/zona → ciudad
 * → barrio). Lee la API pública `classified_locations`, que permite CORS y no
 * usa credenciales (https://developers.mercadolibre.com.ar/en_us/locate-property).
 *
 * El CRM guarda localidad y provincia como texto libre; Mercado Libre usa sus
 * propios ids (y parte "Buenos Aires" en GBA Norte/Oeste/Sur, Interior y
 * Costa Atlántica). Se sugiere por nombre cuando hay coincidencia y el resto
 * lo elige la persona.
 */
import { useEffect, useState } from "react";

const API = "https://api.mercadolibre.com/classified_locations";

interface Node {
  id: string;
  name: string;
}

export interface MeliLocationValue {
  stateId?: string | null;
  cityId?: string | null;
  neighborhoodId?: string | null;
  /** Texto para mostrar ("Tolosa, La Plata"). */
  label?: string | null;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Coincidencia por nombre: igual, o uno contiene al otro como palabra completa. */
function bestMatch(nodes: Node[], ...hints: (string | null | undefined)[]): Node | undefined {
  const hs = hints.filter((h): h is string => !!h && !!h.trim()).map(norm);
  for (const h of hs) {
    const exact = nodes.find((n) => norm(n.name) === h);
    if (exact) return exact;
  }
  for (const h of hs) {
    const contained = nodes.filter((n) => {
      const nn = norm(n.name);
      return nn.length > 3 && (` ${h} `.includes(` ${nn} `) || ` ${nn} `.includes(` ${h} `));
    });
    if (contained.length === 1) return contained[0];
  }
  return undefined;
}

const CABA = ["capital federal", "caba", "ciudad autonoma de buenos aires", "ciudad de buenos aires"];

async function children(path: string, key: "states" | "cities" | "neighborhoods"): Promise<Node[]> {
  const r = await fetch(`${API}/${path}`);
  if (!r.ok) throw new Error(String(r.status));
  const j = (await r.json()) as Record<string, unknown>;
  const list = (j[key] ?? []) as Node[];
  return [...list].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function MeliLocationPicker({
  value,
  onChange,
  hints,
  onNeighborhoodCount,
}: {
  value: MeliLocationValue | null;
  onChange: (v: MeliLocationValue) => void;
  hints: { province: string | null; locality: string | null; zone: string | null };
  /** Cuántos barrios tiene la ciudad elegida (null = todavía no se sabe). */
  onNeighborhoodCount?: (n: number | null) => void;
}) {
  const [states, setStates] = useState<Node[]>([]);
  const [cities, setCities] = useState<Node[]>([]);
  const [hoods, setHoods] = useState<Node[]>([]);
  const [error, setError] = useState<string | null>(null);

  const stateId = value?.stateId ?? "";
  const cityId = value?.cityId ?? "";
  const hoodId = value?.neighborhoodId ?? "";

  useEffect(() => {
    let off = false;
    children("countries/AR", "states")
      .then((list) => {
        if (off) return;
        setStates(list);
        if (!value?.stateId) {
          const prov = norm(hints.province ?? "");
          const s = CABA.includes(prov) ? list.find((n) => norm(n.name) === "capital federal") : bestMatch(list, hints.province);
          if (s) onChange({ stateId: s.id, label: s.name });
        }
      })
      .catch(() => !off && setError("No pudimos cargar las ubicaciones de Mercado Libre."));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!stateId) {
      setCities([]);
      return;
    }
    let off = false;
    children(`states/${encodeURIComponent(stateId)}`, "cities")
      .then((list) => {
        if (off) return;
        setCities(list);
        if (!value?.cityId) {
          const c = bestMatch(list, hints.locality, hints.zone) ?? (list.length === 1 ? list[0] : undefined);
          if (c) onChange({ stateId, cityId: c.id, label: c.name });
        }
      })
      .catch(() => !off && setError("No pudimos cargar las ciudades."));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateId]);

  useEffect(() => {
    setHoods([]);
    onNeighborhoodCount?.(null);
    if (!cityId) return;
    let off = false;
    children(`cities/${encodeURIComponent(cityId)}`, "neighborhoods")
      .then((list) => {
        if (off) return;
        setHoods(list);
        onNeighborhoodCount?.(list.length);
        if (!value?.neighborhoodId) {
          const n = bestMatch(list, hints.zone, hints.locality);
          const city = cities.find((c) => c.id === cityId)?.name;
          if (n) onChange({ stateId, cityId, neighborhoodId: n.id, label: city ? `${n.name}, ${city}` : n.name });
        }
      })
      .catch(() => !off && setError("No pudimos cargar los barrios."));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId]);

  const select = "w-full min-h-[44px] px-3 rounded-xl border text-sm bg-white";
  const border = { borderColor: "#DDD6FE", color: "#1F0A3C" };
  const nameOf = (list: Node[], id: string) => list.find((n) => n.id === id)?.name ?? "";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <label className="text-xs" style={{ color: "#6B5A8E", fontWeight: 600 }}>
        Provincia / zona
        <select
          className={select}
          style={border}
          value={stateId}
          onChange={(e) => onChange({ stateId: e.target.value || null, label: nameOf(states, e.target.value) })}
        >
          <option value="">Elegí…</option>
          {states.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <label className="text-xs" style={{ color: "#6B5A8E", fontWeight: 600 }}>
        Ciudad / partido
        <select
          className={select}
          style={border}
          value={cityId}
          disabled={!stateId}
          onChange={(e) => onChange({ stateId, cityId: e.target.value || null, label: nameOf(cities, e.target.value) })}
        >
          <option value="">Elegí…</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <label className="text-xs" style={{ color: "#6B5A8E", fontWeight: 600 }}>
        Barrio {cityId && hoods.length === 0 ? "(esta ciudad no tiene)" : ""}
        <select
          className={select}
          style={border}
          value={hoodId}
          disabled={!cityId || hoods.length === 0}
          onChange={(e) => {
            const city = nameOf(cities, cityId);
            const hood = nameOf(hoods, e.target.value);
            onChange({ stateId, cityId, neighborhoodId: e.target.value || null, label: hood ? `${hood}, ${city}` : city });
          }}
        >
          <option value="">Elegí…</option>
          {hoods.map((n) => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </select>
      </label>
      {error && <p role="alert" className="sm:col-span-3 text-xs" style={{ color: "#BE123C" }}>{error}</p>}
    </div>
  );
}
