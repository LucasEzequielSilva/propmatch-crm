/**
 * Configuración → Integraciones: tarjeta de Google Calendar. A diferencia de
 * los portales (una cuenta por inmobiliaria), acá cada agente conecta lo suyo.
 * Reusa las mismas piezas que la Agenda (src/features/agenda/GoogleCalendarDialog).
 */
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/Card";
import { CalendarIcon } from "@/components/ui/icons";
import { useGoogleCalendar } from "@/lib/gcal/GoogleCalendarProvider";
import { FeedSection } from "@/features/agenda/GoogleCalendarDialog";

export function GoogleCalendarCard() {
  const { feed } = useGoogleCalendar();
  return (
    <Card padded>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#EFF6FF" }} aria-hidden>
          <CalendarIcon size={20} color="#2563EB" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm" style={{ color: "#1F0A3C", fontWeight: 700 }}>Google Calendar</h2>
          <p className="text-xs mt-0.5" style={{ color: "#6B5A8E" }}>
            Tu agenda del CRM en tu calendario de Google. Es personal: cada agente conecta su propia cuenta. También lo encontrás en{" "}
            <Link to="/agenda" className="underline" style={{ color: "#7C3AED", fontWeight: 700 }}>Agenda</Link> → «Google Calendar».
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-6">
        <FeedSection feed={feed} />
      </div>
    </Card>
  );
}
