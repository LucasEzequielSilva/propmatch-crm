import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import { MatchesSolidIcon } from "@/components/ui/icons";

type Mode = "login" | "signup";

export default function AuthPage() {
  const { needsOnboarding, refresh } = useAuth();
  // Si ya hay sesión pero falta la agencia, el único paso posible es crearla.
  const [mode, setMode] = useState<Mode>(needsOnboarding ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createAgency() {
    const { error: rpcError } = await supabase.rpc("signup_agency", {
      p_agency_name: agencyName,
      p_full_name: fullName,
    });
    if (rpcError) throw rpcError;
    await refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (needsOnboarding) {
        await createAgency();
        return;
      }

      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) throw signUpError;

      if (data.session) {
        await createAgency();
      } else {
        // El proyecto tiene confirmación de email activada.
        setNotice("Te enviamos un mail para confirmar la cuenta. Confirmala y volvé a entrar.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocurrió un error inesperado");
    } finally {
      setBusy(false);
    }
  }

  const isSignup = mode === "signup" || needsOnboarding;

  return (
    <div className="min-h-full flex" style={{ background: "#FDFCFF" }}>
      {/* ── Panel de marca ── */}
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

        <div className="relative z-10">
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
              className="w-9 h-9 rounded-xl flex items-center justify-center"
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

      {/* ── Formulario ── */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
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
            {needsOnboarding
              ? "Creá tu inmobiliaria"
              : isSignup
                ? "Creá tu cuenta"
                : "Entrá a PropMatch"}
          </h2>
          <p className="text-sm mt-1" style={{ color: "#7C6A99" }}>
            {needsOnboarding
              ? "Un último paso para empezar a cargar tu cartera."
              : isSignup
                ? "Empezá a gestionar tu cartera en minutos."
                : "Bienvenido de vuelta."}
          </p>

          {!needsOnboarding && (
            <div className="flex items-center gap-1 p-1 rounded-xl mt-6" style={{ background: "#F5F3FF" }}>
              {(["login", "signup"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setError(null);
                    setNotice(null);
                  }}
                  className="flex-1 px-4 py-1.5 rounded-lg text-sm transition-all"
                  style={
                    mode === m
                      ? {
                          background: "var(--gradient-brand)",
                          color: "white",
                          fontWeight: 600,
                          boxShadow: "0 2px 8px rgba(124,58,237,0.25)",
                        }
                      : { color: "#7C6A99", fontWeight: 500 }
                  }
                >
                  {m === "login" ? "Ingresar" : "Crear cuenta"}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {isSignup && (
              <>
                <Field label="Nombre de la inmobiliaria">
                  <input
                    value={agencyName}
                    onChange={(e) => setAgencyName(e.target.value)}
                    required
                    placeholder="Inmobiliaria Rodríguez"
                    className={inputClass}
                  />
                </Field>
                <Field label="Tu nombre">
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    placeholder="Valen Martínez"
                    className={inputClass}
                  />
                </Field>
              </>
            )}

            {!needsOnboarding && (
              <>
                <Field label="Email">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="vos@inmobiliaria.com"
                    className={inputClass}
                  />
                </Field>
                <Field label="Contraseña">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    placeholder="••••••••"
                    className={inputClass}
                  />
                </Field>
              </>
            )}

            {error && (
              <p
                className="text-xs rounded-xl px-3 py-2.5"
                style={{ background: "#FFF1F2", color: "#E11D48", border: "1px solid #FECDD3" }}
              >
                {error}
              </p>
            )}
            {notice && (
              <p
                className="text-xs rounded-xl px-3 py-2.5"
                style={{ background: "#F0FDF4", color: "#16A34A", border: "1px solid #BBF7D0" }}
              >
                {notice}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-xl text-sm text-white transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-60 disabled:active:scale-100"
              style={{
                background: "var(--gradient-brand)",
                fontWeight: 600,
                boxShadow: "var(--shadow-cta)",
              }}
            >
              {busy
                ? "Un momento…"
                : needsOnboarding
                  ? "Crear inmobiliaria"
                  : isSignup
                    ? "Crear cuenta"
                    : "Ingresar"}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs mb-1.5" style={{ color: "#7C6A99", fontWeight: 600 }}>
        {label}
      </span>
      {children}
    </label>
  );
}
