import { useState } from "react";
import { Link } from "react-router-dom";
import { MatchesSolidIcon } from "@/components/ui/icons";

export default function RegistroPage() {
  const [agencyName, setAgencyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/saas/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agencyName, fullName, email, password }),
      });
      const body = await res.json();
      if (res.ok) {
        setDone(true);
      } else if (res.status === 409) {
        setError("email_exists");
      } else if (body?.error === "password_too_short") {
        setError("La contraseña tiene que tener al menos 8 caracteres.");
      } else {
        setError("Algo salió mal. Intentá de nuevo en unos segundos.");
      }
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex" style={{ background: "#FDFCFF" }}>
      {/* Panel de marca */}
      <div
        className="hidden lg:flex w-[46%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: "var(--gradient-brand-wide)" }}
      >
        <div className="absolute -right-16 -top-16 w-72 h-72 rounded-full opacity-20" style={{ background: "white" }} />
        <div className="absolute right-24 bottom-10 w-40 h-40 rounded-full opacity-10" style={{ background: "white" }} />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.2)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M3 12L12 3L21 12V21H15V15H9V21H3V12Z" fill="white" fillOpacity="0.9" />
              <circle cx="16" cy="8" r="3" fill="white" fillOpacity="0.7" />
            </svg>
          </div>
          <span className="text-white text-lg tracking-tight" style={{ fontWeight: 800 }}>PropMatch</span>
        </div>

        <div className="relative z-10 pm-enter">
          <h1 className="text-white text-4xl leading-tight tracking-tight" style={{ fontWeight: 800 }}>
            Tu inmobiliaria
            <br />lista en minutos.
          </h1>
          <p className="text-white text-base mt-4 max-w-md" style={{ opacity: 0.8 }}>
            Creá tu cuenta, cargá tus propiedades y empezá a cruzarlas con los clientes que ya
            estás buscando.
          </p>
          <div className="flex items-center gap-2 mt-8">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.2)" }}>
              <MatchesSolidIcon size={18} />
            </div>
            <span className="text-white text-sm" style={{ opacity: 0.85, fontWeight: 500 }}>
              Sin tarjeta de crédito para empezar
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
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--gradient-brand)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M3 12L12 3L21 12V21H15V15H9V21H3V12Z" fill="white" fillOpacity="0.9" />
                <circle cx="16" cy="8" r="3" fill="white" fillOpacity="0.7" />
              </svg>
            </div>
            <div>
              <span className="text-lg tracking-tight" style={{ color: "#3B0764", fontWeight: 800 }}>Prop</span>
              <span className="text-lg tracking-tight text-gradient-brand-h" style={{ fontWeight: 800 }}>Match</span>
            </div>
          </div>

          {done ? (
            <div className="pm-enter">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
                style={{ background: "var(--gradient-brand)" }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M5 13l4 4L19 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h2 className="text-2xl tracking-tight" style={{ color: "#1F0A3C", fontWeight: 800 }}>¡Listo!</h2>
              <p className="text-sm mt-2 leading-relaxed" style={{ color: "#7C6A99" }}>
                Tu cuenta está lista. Ya podés ingresar con tu email y contraseña.
              </p>
              <Link
                to="/login"
                className="mt-6 block w-full py-3 rounded-xl text-sm text-white text-center transition-all hover:opacity-90"
                style={{ background: "var(--gradient-brand)", fontWeight: 600, boxShadow: "var(--shadow-cta)" }}
              >
                Ir al login
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-2xl tracking-tight" style={{ color: "#1F0A3C", fontWeight: 800 }}>
                Crear inmobiliaria
              </h2>
              <p className="text-sm mt-1" style={{ color: "#7C6A99" }}>
                Es gratis para empezar.
              </p>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <label className="block">
                  <span className="block text-xs mb-1.5" style={{ color: "#7C6A99", fontWeight: 600 }}>
                    Nombre de la inmobiliaria
                  </span>
                  <input
                    type="text"
                    value={agencyName}
                    onChange={(e) => setAgencyName(e.target.value)}
                    required
                    placeholder="Ej: García Propiedades"
                    className={inputClass}
                  />
                </label>

                <label className="block">
                  <span className="block text-xs mb-1.5" style={{ color: "#7C6A99", fontWeight: 600 }}>
                    Tu nombre completo
                  </span>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    placeholder="Ej: Carlos García"
                    className={inputClass}
                  />
                </label>

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
                    placeholder="vos@ejemplo.com"
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
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="Mínimo 8 caracteres"
                    className={inputClass}
                  />
                </label>

                {error === "email_exists" ? (
                  <p
                    className="pm-enter text-xs rounded-xl px-3 py-2.5"
                    style={{ background: "#FFF1F2", color: "#E11D48", border: "1px solid #FECDD3" }}
                  >
                    Ese email ya tiene una cuenta.{" "}
                    <Link to="/login" style={{ color: "#E11D48", fontWeight: 700 }}>
                      ¿Querés iniciar sesión?
                    </Link>
                  </p>
                ) : error ? (
                  <p
                    className="pm-enter text-xs rounded-xl px-3 py-2.5"
                    style={{ background: "#FFF1F2", color: "#E11D48", border: "1px solid #FECDD3" }}
                  >
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-3 rounded-xl text-sm text-white transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-60"
                  style={{ background: "var(--gradient-brand)", fontWeight: 600, boxShadow: "var(--shadow-cta)" }}
                >
                  {busy ? "Creando…" : "Crear mi cuenta gratis"}
                </button>
              </form>

              <p className="text-sm mt-6 text-center" style={{ color: "#7C6A99" }}>
                ¿Ya tenés cuenta?{" "}
                <Link to="/login" style={{ color: "#7C3AED", fontWeight: 600 }}>
                  Ingresar
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full px-4 py-2.5 rounded-xl text-sm border outline-none transition-all " +
  "border-[#EDE9FE] bg-white text-[#1F0A3C] placeholder:text-[#C4B5FD] " +
  "focus:border-[#A78BFA] focus:ring-4 focus:ring-[#EDE9FE]";
