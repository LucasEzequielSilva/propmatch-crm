import { useState } from "react";
import { useStore } from "@/data/store";
import { MatchesSolidIcon } from "@/components/ui/icons";

/**
 * Inicio de sesión.
 *
 * Auth real contra el mismo Supabase que usa la app: la cuenta tiene que
 * existir ahí y estar vinculada a una inmobiliaria en `agency_members`, o no
 * entra. De eso dependen "a cargo de", el avatar del header y el ranking del
 * equipo, que siguen usando el perfil local del agente logueado.
 */
export default function LoginPage() {
  const { signIn, agency } = useStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const message = await signIn(email, password);
    setError(message);
    setBusy(false);
  }

  return (
    <div className="min-h-full flex" style={{ background: "#FDFCFF" }}>
      {/* Panel de marca */}
      <div
        className="hidden lg:flex w-[46%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: "var(--gradient-brand-wide)" }}
      >
        <div
          className="absolute -right-16 -top-16 w-72 h-72 rounded-full opacity-20"
          style={{ background: "white" }}
        />
        <div
          className="absolute right-24 bottom-10 w-40 h-40 rounded-full opacity-10"
          style={{ background: "white" }}
        />

        <div className="relative z-10 flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.2)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M3 12L12 3L21 12V21H15V15H9V21H3V12Z" fill="white" fillOpacity="0.9" />
              <circle cx="16" cy="8" r="3" fill="white" fillOpacity="0.7" />
            </svg>
          </div>
          <span className="text-white text-lg tracking-tight" style={{ fontWeight: 800 }}>
            PropMatch
          </span>
        </div>

        <div className="relative z-10 pm-enter">
          <h1 className="text-white text-4xl leading-tight tracking-tight" style={{ fontWeight: 800 }}>
            El CRM que entiende
            <br />a cada cliente.
          </h1>
          <p className="text-white text-base mt-4 max-w-md" style={{ opacity: 0.8 }}>
            Organizá tu cartera, seguí cada operación y encontrá qué propiedad encaja con quién,
            sin perder oportunidades por el camino.
          </p>
          <div className="flex items-center gap-2 mt-8">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.2)" }}
            >
              <MatchesSolidIcon size={18} />
            </div>
            <span className="text-white text-sm" style={{ opacity: 0.85, fontWeight: 500 }}>
              Compatibilidad calculada sobre datos reales
            </span>
          </div>
        </div>

        <p className="relative z-10 text-white text-xs" style={{ opacity: 0.6 }}>
          © {new Date().getFullYear()} PropMatch
        </p>
      </div>

      {/* Formulario */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm pm-enter">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "var(--gradient-brand)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M3 12L12 3L21 12V21H15V15H9V21H3V12Z" fill="white" fillOpacity="0.9" />
                <circle cx="16" cy="8" r="3" fill="white" fillOpacity="0.7" />
              </svg>
            </div>
            <div>
              <span className="text-lg tracking-tight" style={{ color: "#3B0764", fontWeight: 800 }}>
                Prop
              </span>
              <span className="text-lg tracking-tight text-gradient-brand-h" style={{ fontWeight: 800 }}>
                Match
              </span>
            </div>
          </div>

          <h2 className="text-2xl tracking-tight" style={{ color: "#1F0A3C", fontWeight: 800 }}>
            Entrá a PropMatch
          </h2>
          <p className="text-sm mt-1" style={{ color: "#7C6A99" }}>
            {agency.name}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="block text-xs mb-1.5" style={{ color: "#7C6A99", fontWeight: 600 }}>
                Email
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                placeholder="vos@propmatch.com"
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="block text-xs mb-1.5" style={{ color: "#7C6A99", fontWeight: 600 }}>
                Contraseña
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className={inputClass}
              />
            </label>

            {error && (
              <p
                className="pm-enter text-xs rounded-xl px-3 py-2.5"
                style={{ background: "#FFF1F2", color: "#E11D48", border: "1px solid #FECDD3" }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-xl text-sm text-white transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-60"
              style={{
                background: "var(--gradient-brand)",
                fontWeight: 600,
                boxShadow: "var(--shadow-cta)",
              }}
            >
              {busy ? "Un momento…" : "Ingresar"}
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full px-4 py-2.5 rounded-xl text-sm border outline-none transition-all " +
  "border-[#EDE9FE] bg-white text-[#1F0A3C] placeholder:text-[#C4B5FD] " +
  "focus:border-[#A78BFA] focus:ring-4 focus:ring-[#EDE9FE]";
