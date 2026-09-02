/**
 * Pantalla que se muestra cuando faltan las credenciales de Supabase.
 * Evita el clásico "pantalla en blanco y a mirar la consola".
 */
export function SetupNotice() {
  return (
    <div className="h-full flex items-center justify-center p-8" style={{ background: "#FDFCFF" }}>
      <div className="max-w-lg w-full">
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "var(--gradient-brand)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
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

        <div
          className="rounded-2xl border p-6"
          style={{ background: "white", borderColor: "#EDE9FE", boxShadow: "var(--shadow-card)" }}
        >
          <h1 className="text-xl tracking-tight" style={{ color: "#1F0A3C", fontWeight: 800 }}>
            Falta conectar Supabase
          </h1>
          <p className="text-sm mt-2" style={{ color: "#7C6A99" }}>
            El proyecto está listo, pero todavía no tiene las credenciales de la base de datos.
          </p>

          <ol className="mt-5 space-y-3">
            {[
              "Creá un proyecto en supabase.com",
              "Corré supabase/migrations/0001_init.sql y 0002_matching.sql en el SQL Editor",
              "Copiá .env.example a .env y completá VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY",
              "Reiniciá el servidor de desarrollo",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs"
                  style={{ background: "#F5F3FF", color: "#7C3AED", fontWeight: 700 }}
                >
                  {i + 1}
                </span>
                <span className="text-sm" style={{ color: "#374151" }}>
                  {step}
                </span>
              </li>
            ))}
          </ol>

          <pre
            className="mt-5 rounded-xl p-4 text-xs overflow-x-auto"
            style={{ background: "#F9F7FF", border: "1px solid #EDE9FE", color: "#7C6A99" }}
          >
{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
          </pre>
        </div>
      </div>
    </div>
  );
}
