import { useId, useRef, useState } from "react";
import { useStore } from "@/data/store";
import BrandPanel, { LogoMark } from "./BrandPanel";

/**
 * Acceso: ingresar, crear cuenta y continuar con Google.
 *
 * Auth real contra el mismo Supabase que usa la app. Una cuenta recién creada
 * (o de Google) entra aunque no pertenezca a ninguna inmobiliaria, en modo
 * local (ver `applySession` del store). Si hay que confirmar el email, se
 * muestran los pasos (`pendingLinkEmail` del store). El alta real de la
 * agencia es una decisión pendiente.
 */

type Mode = "login" | "signup";

export default function LoginPage() {
  const { signIn, signUp, signInWithGoogle, pendingLinkEmail, dismissPendingLink, enterDemo } = useStore();

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const tabRefs = useRef<Record<Mode, HTMLButtonElement | null>>({ login: null, signup: null });
  const uid = useId();

  const isSignup = mode === "signup";
  const strength = passwordStrength(password);
  const anyBusy = busy || googleBusy;

  function changeMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  function onTabKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next: Mode = e.key === "ArrowLeft" || e.key === "Home" ? "login" : "signup";
    changeMode(next);
    tabRefs.current[next]?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (anyBusy) return;
    setError(null);

    if (!isSignup) {
      setBusy(true);
      setError(await signIn(email, password));
      setBusy(false);
      return;
    }

    if (password.length < 8) {
      setError("La contraseña tiene que tener al menos 8 caracteres.");
      return;
    }
    if (!accepted) {
      setError("Aceptá los términos para crear tu cuenta.");
      return;
    }
    setBusy(true);
    const res = await signUp({ name, agencyName, email, password });
    setBusy(false);
    if (res.error) setError(res.error);
    else setNeedsConfirm(res.needsEmailConfirmation);
  }

  async function handleGoogle() {
    if (anyBusy) return;
    setError(null);
    setGoogleBusy(true);
    const message = await signInWithGoogle();
    // Si salió bien el navegador ya está yendo a Google: dejamos el estado de carga.
    if (message) {
      setError(message);
      setGoogleBusy(false);
    }
  }

  if (pendingLinkEmail !== null) {
    return (
      <Shell>
        <PendingLink
          email={pendingLinkEmail}
          needsConfirm={needsConfirm}
          onBack={() => {
            dismissPendingLink();
            setNeedsConfirm(false);
            setPassword("");
            setMode("login");
          }}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="lg:hidden flex items-center gap-3 mb-10">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: "var(--gradient-brand)" }}
        >
          <LogoMark size={18} />
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

      <h2 className="text-[1.75rem] leading-tight tracking-tight" style={{ color: "#1F0A3C", fontWeight: 800 }}>
        {isSignup ? "Creá tu cuenta" : "Entrá a PropMatch"}
      </h2>
      <p className="text-sm mt-1.5" style={{ color: "#7C6A99" }}>
        {isSignup
          ? "Empezá a ordenar tu cartera en un minuto."
          : "Qué bueno verte de nuevo."}
      </p>

      {/* Switch de pestañas */}
      <div
        role="tablist"
        aria-label="Acceso"
        onKeyDown={onTabKey}
        className="relative grid grid-cols-2 p-1 mt-7 rounded-xl"
        style={{ background: "#F5F3FF" }}
      >
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 left-1 rounded-lg bg-white"
          style={{
            width: "calc(50% - 4px)",
            transform: isSignup ? "translateX(100%)" : "none",
            transition: "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
            boxShadow: "0 1px 3px rgba(31,10,60,0.12), 0 0 0 1px #EDE9FE",
          }}
        />
        {(["login", "signup"] as const).map((m) => (
          <button
            key={m}
            ref={(el) => {
              tabRefs.current[m] = el;
            }}
            type="button"
            role="tab"
            id={`${uid}-tab-${m}`}
            aria-selected={mode === m}
            aria-controls={`${uid}-panel`}
            tabIndex={mode === m ? 0 : -1}
            onClick={() => changeMode(m)}
            className="relative z-10 py-2 text-sm rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]"
            style={{ color: mode === m ? "#1F0A3C" : "#7C6A99", fontWeight: 600 }}
          >
            {m === "login" ? "Ingresar" : "Crear cuenta"}
          </button>
        ))}
      </div>

      <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${mode}`} className="mt-6">
        <button
          type="button"
          onClick={handleGoogle}
          disabled={anyBusy}
          className="w-full flex items-center justify-center gap-3 py-2.5 rounded-xl text-sm bg-white border transition-all hover:bg-[#F8F9FA] active:scale-[0.99] disabled:opacity-60 outline-none focus-visible:ring-4 focus-visible:ring-[#EDE9FE] focus-visible:border-[#7C3AED]"
          style={{ borderColor: "#DADCE0", color: "#3C4043", fontWeight: 500 }}
        >
          {googleBusy ? <Spinner dark /> : <GoogleLogo />}
          Continuar con Google
        </button>

        <button
          type="button"
          onClick={enterDemo}
          disabled={anyBusy}
          className="mt-2.5 w-full py-2.5 rounded-xl text-sm border transition-all hover:bg-[#F5F3FF] active:scale-[0.99] disabled:opacity-60 outline-none focus-visible:ring-4 focus-visible:ring-[#EDE9FE] focus-visible:border-[#7C3AED]"
          style={{ borderColor: "#DDD6FE", color: "#6D28D9", fontWeight: 700 }}
        >
          Entrar a la demo
          <span className="block text-xs" style={{ color: "#7458C4", fontWeight: 500 }}>
            Sin cuenta, con datos de ejemplo
          </span>
        </button>

        <div className="flex items-center gap-3 my-5" aria-hidden="true">
          <span className="flex-1 h-px" style={{ background: "#EDE9FE" }} />
          <span className="text-xs" style={{ color: "#7458C4", fontWeight: 500 }}>
            o continuá con email
          </span>
          <span className="flex-1 h-px" style={{ background: "#EDE9FE" }} />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate={false}>
          {isSignup && (
            <div className="pm-enter space-y-4">
              <Field label="Nombre completo">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  placeholder="Tu nombre y apellido"
                  className={inputClass}
                />
              </Field>
              <Field label="Nombre de la inmobiliaria">
                <input
                  value={agencyName}
                  onChange={(e) => setAgencyName(e.target.value)}
                  required
                  autoComplete="organization"
                  placeholder="Cómo se llama tu inmobiliaria"
                  className={inputClass}
                />
              </Field>
            </div>
          )}

          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              placeholder="vos@inmobiliaria.com"
              className={inputClass}
            />
          </Field>

          <Field label="Contraseña">
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={isSignup ? 8 : undefined}
                autoComplete={isSignup ? "new-password" : "current-password"}
                placeholder={isSignup ? "Mínimo 8 caracteres" : "Tu contraseña"}
                className={inputClass + " pr-11"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-pressed={showPassword}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[#F5F3FF] outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]"
                style={{ color: "#7C6A99" }}
              >
                <EyeIcon off={showPassword} />
              </button>
            </div>
            {isSignup && password.length > 0 && <StrengthMeter level={strength} />}
          </Field>

          {isSignup && (
            <label className="pm-enter flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded flex-shrink-0 cursor-pointer"
                style={{ accentColor: "#7C3AED" }}
              />
              <span className="text-xs leading-relaxed" style={{ color: "#7C6A99" }}>
                Acepto los términos de uso y la política de privacidad de PropMatch.
              </span>
            </label>
          )}

          {error && (
            <p
              role="alert"
              className="pm-enter text-xs rounded-xl px-3 py-2.5"
              style={{ background: "#FFF1F2", color: "#E11D48", border: "1px solid #FECDD3" }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={anyBusy}
            className="w-full py-3 rounded-xl text-sm text-white transition-all hover:brightness-110 hover:-translate-y-px active:translate-y-0 active:scale-[0.99] disabled:opacity-60 disabled:hover:translate-y-0 flex items-center justify-center gap-2 outline-none focus-visible:ring-4 focus-visible:ring-[#DDD6FE]"
            style={{
              background: "var(--gradient-brand)",
              fontWeight: 600,
              boxShadow: "var(--shadow-cta)",
            }}
          >
            {busy && <Spinner />}
            {busy ? "Un momento…" : isSignup ? "Crear cuenta" : "Ingresar"}
          </button>
        </form>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full flex" style={{ background: "#FDFCFF" }}>
      <BrandPanel />
      <div className="flex-1 flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[400px] pm-enter">{children}</div>
      </div>
    </div>
  );
}

/** Cuenta creada pero sin inmobiliaria: estado de espera, no un error. */
function PendingLink({
  email,
  needsConfirm,
  onBack,
}: {
  email: string;
  needsConfirm: boolean;
  onBack: () => void;
}) {
  return (
    <div className="text-center lg:text-left" role="status">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto lg:mx-0"
        style={{ background: "var(--gradient-brand)", boxShadow: "var(--shadow-cta)" }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="text-[1.75rem] leading-tight tracking-tight mt-6" style={{ color: "#1F0A3C", fontWeight: 800 }}>
        Cuenta creada
      </h2>
      <p className="text-sm mt-2 leading-relaxed" style={{ color: "#7C6A99" }}>
        Confirmá tu email y ya podés ingresar.
      </p>

      <ul className="mt-6 space-y-3 text-left">
        {needsConfirm && (
          <Step
            title="Confirmá tu email"
            text={
              <>
                Te mandamos un mensaje a <strong style={{ color: "#1F0A3C" }}>{email}</strong>. Abrilo y
                tocá el enlace para activar la cuenta.
              </>
            }
          />
        )}
        <Step
          title="Ingresá"
          text={
            email ? (
              <>
                Volvé al inicio y entrá con <strong style={{ color: "#1F0A3C" }}>{email}</strong>.
              </>
            ) : (
              "Volvé al inicio y entrá con tu cuenta."
            )
          }
        />
      </ul>

      <button
        type="button"
        onClick={onBack}
        className="mt-8 w-full py-3 rounded-xl text-sm border bg-white transition-all hover:bg-[#F5F3FF] active:scale-[0.99] outline-none focus-visible:ring-4 focus-visible:ring-[#EDE9FE] focus-visible:border-[#7C3AED]"
        style={{ borderColor: "#EDE9FE", color: "#3B0764", fontWeight: 600 }}
      >
        Volver al inicio
      </button>
    </div>
  );
}

function Step({ title, text }: { title: string; text: React.ReactNode }) {
  return (
    <li className="flex gap-3 rounded-xl p-3.5" style={{ background: "#F5F3FF" }}>
      <span
        className="mt-1 w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: "var(--gradient-brand)" }}
        aria-hidden="true"
      />
      <div>
        <p className="text-sm" style={{ color: "#1F0A3C", fontWeight: 600 }}>{title}</p>
        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "#7C6A99" }}>{text}</p>
      </div>
    </li>
  );
}

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

/** 0 = vacía, 1 = débil, 2 = media, 3 = fuerte. Orientativo, no una política. */
function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  if (pw.length < 8) return 1;
  let extras = 0;
  if (pw.length >= 12) extras++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) extras++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) extras++;
  return extras >= 2 ? 3 : 2;
}

function StrengthMeter({ level }: { level: 0 | 1 | 2 | 3 }) {
  const labels = ["", "Débil", "Aceptable", "Fuerte"];
  const colors = ["", "#E11D48", "#D97706", "#16A34A"];
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1.5" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className="flex-1 h-1 rounded-full transition-colors duration-300"
            style={{ background: i <= level ? colors[level] : "#EDE9FE" }}
          />
        ))}
      </div>
      <p className="text-[11px] mt-1" style={{ color: colors[level], fontWeight: 600 }}>
        Seguridad: {labels[level]}
      </p>
    </div>
  );
}

function Spinner({ dark = false }: { dark?: boolean }) {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke={dark ? "#DADCE0" : "rgba(255,255,255,0.35)"} strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke={dark ? "#7C3AED" : "white"} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

/** Logo "G" de Google con sus colores de marca, según su guía de botones. */
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const inputClass =
  "w-full px-4 py-2.5 rounded-xl text-sm border outline-none transition-all " +
  "border-[#EDE9FE] bg-white text-[#1F0A3C] placeholder:text-[#7C6A99] " +
  "hover:border-[#DDD6FE] focus:border-[#7C3AED] focus:ring-4 focus:ring-[#EDE9FE]";
