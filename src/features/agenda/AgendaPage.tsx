import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppHeader } from "@/components/layout/AppHeader";
import {
  AgendaIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  EventTypeIcon,
  PlusIcon,
} from "@/components/ui/icons";
import { useStore } from "@/data/store";
import { EventFormModal } from "./EventFormModal";
import { avatarGradient, initials } from "@/lib/format";
import type { CalendarEvent, EventType } from "@/types/db";

const HOUR_HEIGHT = 66;
const START_HOUR = 8;
const END_HOUR = 20;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

const TYPE_STYLES: Record<EventType, { bg: string; border: string; text: string; sub: string; pill: string; pillText: string }> = {
  visita: { bg: "rgba(124,58,237,0.07)", border: "#7C3AED", text: "#4C1D95", sub: "#7C3AED99", pill: "#EDE9FE", pillText: "#7C3AED" },
  llamada: { bg: "rgba(59,130,246,0.07)", border: "#3B82F6", text: "#1E3A8A", sub: "#3B82F699", pill: "#DBEAFE", pillText: "#1D4ED8" },
  reunion: { bg: "rgba(236,72,153,0.07)", border: "#EC4899", text: "#831843", sub: "#EC489999", pill: "#FCE7F3", pillText: "#9D174D" },
  seguimiento: { bg: "rgba(245,158,11,0.07)", border: "#F59E0B", text: "#78350F", sub: "#F59E0B99", pill: "#FEF3C7", pillText: "#B45309" },
};

const TYPE_LABELS: Record<EventType, string> = {
  visita: "Visita",
  llamada: "Llamada",
  reunion: "Reunión",
  seguimiento: "Seguimiento",
};

const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie"];

/** Lunes de la semana que contiene `date`. */
function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

const fmtHour = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** Capitaliza solo la primera letra: "agosto de 2026" -> "Agosto de 2026". */
const capitalizeFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Posición vertical de una fecha dentro de la grilla horaria. */
const decimalHour = (d: Date) => d.getHours() + d.getMinutes() / 60;

export default function AgendaPage() {
  const navigate = useNavigate();
  const {
    events,
    tasks,
    toggleTask,
    addTask,
    removeTask,
    profile,
    contactById,
    propertyById,
    coverPhoto,
    matches,
  } = useStore();

  const [query, setQuery] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  /** `null` mientras el campo de nueva tarea está cerrado. */
  const [taskDraft, setTaskDraft] = useState<string | null>(null);
  const [taskPriority, setTaskPriority] = useState(false);

  const today = new Date();
  const weekStart = useMemo(() => {
    const d = mondayOf(today);
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset]);

  const days = useMemo(
    () =>
      DAY_LABELS.map((label, i) => {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + i);
        return { label, date, isToday: date.toDateString() === today.toDateString() };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekStart],
  );

  const weekEvents = useMemo(() => {
    const q = query.trim().toLowerCase();
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 5);
    return events.filter((e) => {
      const start = new Date(e.starts_at);
      if (start < weekStart || start >= end) return false;
      if (q && !e.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [events, weekStart, query]);

  const todayEvents = useMemo(
    () => events.filter((e) => new Date(e.starts_at).toDateString() === today.toDateString()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events],
  );

  const upcoming = useMemo(
    () =>
      [...events]
        .filter((e) => new Date(e.starts_at).getTime() >= Date.now())
        .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
        .slice(0, 4),
    [events],
  );

  function submitTask() {
    const text = (taskDraft ?? "").trim();
    if (!text) {
      setTaskDraft(null);
      setTaskPriority(false);
      return;
    }
    addTask({
      text,
      is_priority: taskPriority,
      due_date: null,
      contact_id: null,
      owner_id: profile.id,
    });
    // El campo queda abierto: las tareas se cargan de a varias.
    setTaskDraft("");
    setTaskPriority(false);
  }

  const nextEvent = upcoming[0];
  const pendingTasks = tasks.filter((t) => !t.is_done);

  // La semana puede cruzar dos meses (31 ago - 4 sep): se muestran ambos.
  const monthLabel = (() => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 4);
    const startMonth = weekStart.toLocaleDateString("es-AR", { month: "long" });
    const endMonth = end.toLocaleDateString("es-AR", { month: "long" });
    const year = end.getFullYear();
    return capitalizeFirst(
      startMonth === endMonth ? `${startMonth} ${year}` : `${startMonth} – ${endMonth} ${year}`,
    );
  })();

  return (
    <>
      <AppHeader
        title="Agenda"
        subtitle="Organizá tu día y no te pierdas ninguna oportunidad."
        search={{ placeholder: "Buscar evento...", value: query, onChange: setQuery }}
        action={{ label: "Nuevo evento", onClick: () => setFormOpen(true) }}
      />

      <div className="flex-1 flex overflow-hidden flex-col xl:flex-row">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Barra del calendario */}
          <div
            className="flex items-center justify-between px-6 py-3 border-b flex-shrink-0 gap-4 flex-wrap"
            style={{ borderColor: "#F3F0FF", background: "white" }}
          >
            <div className="flex items-center gap-3">
              <button
                onClick={() => setWeekOffset(0)}
                className="px-3.5 py-1.5 rounded-xl text-sm transition-all"
                style={{
                  background: weekOffset === 0 ? "var(--gradient-brand)" : "#F5F3FF",
                  color: weekOffset === 0 ? "white" : "#7C3AED",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                Hoy
              </button>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setWeekOffset((w) => w - 1)}
                  aria-label="Semana anterior"
                  className="w-7 h-7 flex items-center justify-center rounded-lg transition-all hover:bg-violet-50"
                >
                  <ChevronLeftIcon color="#7C3AED" />
                </button>
                <button
                  onClick={() => setWeekOffset((w) => w + 1)}
                  aria-label="Semana siguiente"
                  className="w-7 h-7 flex items-center justify-center rounded-lg transition-all hover:bg-violet-50"
                >
                  <ChevronRightIcon color="#7C3AED" />
                </button>
              </div>
              <span className="text-sm" style={{ color: "#1F0A3C", fontWeight: 700 }}>
                {monthLabel}
              </span>
            </div>

            <div className="hidden xl:flex items-center gap-4">
              {(Object.entries(TYPE_LABELS) as [EventType, string][]).map(([k, v]) => (
                <div key={k} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: TYPE_STYLES[k].border }} />
                  <span className="text-xs" style={{ color: "#7C6A99" }}>
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <WeeklyCalendar
              days={days}
              events={weekEvents}
              selectedEvent={selectedEvent}
              onSelectEvent={setSelectedEvent}
            />
          </div>
        </div>

        {/* Panel de hoy */}
        <div
          className="w-full xl:w-72 flex-shrink-0 overflow-y-auto border-t xl:border-t-0 xl:border-l"
          style={{ borderColor: "#EDE9FE", background: "#FDFCFF" }}
        >
          <div className="px-5 py-5 relative overflow-hidden" style={{ background: "var(--gradient-brand-wide)" }}>
            <div className="absolute -right-4 -top-4 w-20 h-20 rounded-full opacity-20" style={{ background: "white" }} />
            <div className="relative z-10">
              <p
                className="text-white text-xs uppercase mb-1"
                style={{ letterSpacing: "0.1em", fontWeight: 600, opacity: 0.8 }}
              >
                Hoy
              </p>
              <p className="text-white text-lg" style={{ fontWeight: 800 }}>
                {capitalizeFirst(
                  today.toLocaleDateString("es-AR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  }),
                )}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <span
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-xs"
                  style={{ background: "rgba(255,255,255,0.2)", fontWeight: 600 }}
                >
                  <AgendaIcon size={11} color="white" />
                  {todayEvents.length} {todayEvents.length === 1 ? "evento" : "eventos"}
                </span>
                <span
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-xs"
                  style={{ background: "rgba(255,255,255,0.2)", fontWeight: 600 }}
                >
                  <CheckIcon size={11} color="white" />
                  {pendingTasks.length} {pendingTasks.length === 1 ? "tarea" : "tareas"}
                </span>
              </div>
            </div>
          </div>

          {/* Próxima actividad */}
          {nextEvent && (
            <div className="p-4 border-b" style={{ borderColor: "#F3F0FF" }}>
              <p
                className="text-xs uppercase mb-3"
                style={{ color: "#A78BFA", fontWeight: 700, letterSpacing: "0.1em" }}
              >
                Próxima actividad
              </p>
              <NextEventCard
                event={nextEvent}
                photo={nextEvent.property_id ? coverPhoto(nextEvent.property_id) : null}
                contactName={contactById(nextEvent.contact_id)?.full_name ?? null}
                propertyTitle={propertyById(nextEvent.property_id)?.title ?? null}
                matchScore={
                  matches.find(
                    (m) =>
                      m.contact_id === nextEvent.contact_id && m.property_id === nextEvent.property_id,
                  )?.score ?? null
                }
                onOpen={() => navigate("/oportunidades")}
              />
            </div>
          )}

          {/* Tareas */}
          <div className="p-4 border-b" style={{ borderColor: "#F3F0FF" }}>
            <div className="flex items-center justify-between mb-3">
              <p
                className="text-xs uppercase"
                style={{ color: "#A78BFA", fontWeight: 700, letterSpacing: "0.1em" }}
              >
                Tareas pendientes
              </p>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  background: "var(--gradient-brand)",
                  color: "white",
                  fontWeight: 700,
                  fontSize: "10px",
                }}
              >
                {pendingTasks.length}
              </span>
            </div>
            <div className="space-y-2">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="group flex items-start gap-1 rounded-xl transition-all hover:bg-violet-50"
                >
                  <button
                    onClick={() => toggleTask(task.id)}
                    className="flex-1 min-w-0 flex items-start gap-2.5 text-left p-2.5"
                  >
                    <div
                      className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5 transition-all"
                      style={
                        task.is_done
                          ? { background: "var(--gradient-brand)" }
                          : { border: "2px solid #DDD6FE", background: "white" }
                      }
                    >
                      {task.is_done && <CheckIcon size={10} color="white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-xs leading-relaxed"
                        style={{
                          color: task.is_done ? "#C4B5FD" : "#374151",
                          fontWeight: task.is_done ? 400 : 500,
                          textDecoration: task.is_done ? "line-through" : "none",
                        }}
                      >
                        {task.text}
                      </p>
                      {task.is_priority && !task.is_done && (
                        <span className="text-xs" style={{ color: "#EC4899", fontWeight: 600, fontSize: "10px" }}>
                          ● Prioritaria
                        </span>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() => removeTask(task.id)}
                    aria-label={"Eliminar tarea: " + task.text}
                    className="w-6 h-6 mt-2.5 mr-1 rounded-lg flex-shrink-0 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all hover:bg-white"
                    style={{ color: "#C4B5FD", fontSize: 15, lineHeight: 1 }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {taskDraft === null ? (
              <button
                onClick={() => setTaskDraft("")}
                className="w-full mt-2 py-2 rounded-xl text-xs transition-all hover:bg-violet-50 flex items-center justify-center gap-1.5"
                style={{ color: "#7C3AED", fontWeight: 600 }}
              >
                <PlusIcon size={11} color="currentColor" />
                Agregar tarea
              </button>
            ) : (
              <div className="mt-2 px-1">
                <input
                  value={taskDraft}
                  onChange={(e) => setTaskDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitTask();
                    if (e.key === "Escape") {
                      setTaskDraft(null);
                      setTaskPriority(false);
                    }
                  }}
                  placeholder="Llamar a Martín por la contraoferta..."
                  autoFocus
                  className="w-full px-3 py-2 rounded-xl text-xs border outline-none transition-all bg-white text-[#1F0A3C] placeholder:text-[#C4B5FD] border-[#EDE9FE] focus:border-[#A78BFA] focus:ring-4 focus:ring-[#EDE9FE]"
                />
                <div className="flex items-center justify-between gap-2 mt-2">
                  <button
                    onClick={() => setTaskPriority((v) => !v)}
                    className="px-2.5 py-1 rounded-lg transition-all border"
                    style={
                      taskPriority
                        ? { background: "#FDF2F8", color: "#EC4899", borderColor: "#FBCFE8", fontWeight: 600, fontSize: "10px" }
                        : { background: "white", color: "#A78BFA", borderColor: "#EDE9FE", fontWeight: 600, fontSize: "10px" }
                    }
                  >
                    ● Prioritaria
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setTaskDraft(null);
                        setTaskPriority(false);
                      }}
                      className="px-2.5 py-1 rounded-lg transition-all hover:bg-violet-50"
                      style={{ color: "#7C6A99", fontWeight: 600, fontSize: "10px" }}
                    >
                      Listo
                    </button>
                    <button
                      onClick={submitTask}
                      className="px-3 py-1 rounded-lg text-white transition-all hover:opacity-90"
                      style={{ background: "var(--gradient-brand)", fontWeight: 600, fontSize: "10px" }}
                    >
                      Agregar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Próximos eventos */}
          <div className="p-4">
            <p
              className="text-xs uppercase mb-3"
              style={{ color: "#A78BFA", fontWeight: 700, letterSpacing: "0.1em" }}
            >
              Próximos eventos
            </p>
            <div className="space-y-2">
              {upcoming.length === 0 ? (
                <p className="text-xs text-center py-3" style={{ color: "#C4B5FD" }}>
                  No hay eventos próximos.
                </p>
              ) : (
                upcoming.map((ev) => {
                  const s = TYPE_STYLES[ev.type];
                  const date = new Date(ev.starts_at);
                  const isToday = date.toDateString() === today.toDateString();
                  return (
                    <div
                      key={ev.id}
                      className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all hover:bg-violet-50"
                      style={{ border: "1px solid #F3F0FF" }}
                    >
                      <div
                        className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: s.bg, border: `1.5px solid ${s.border}33` }}
                      >
                        <EventTypeIcon type={ev.type} color={s.border} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs truncate" style={{ color: "#1F0A3C", fontWeight: 600 }}>
                          {ev.title}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: "#A78BFA", fontSize: "10px" }}>
                          {isToday
                            ? "Hoy"
                            : date.toLocaleDateString("es-AR", { weekday: "short", day: "numeric" })}{" "}
                          · {fmtHour(date)}
                        </p>
                      </div>
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.border }} />
                    </div>
                  );
                })
              )}
            </div>

            <button
              onClick={() => setFormOpen(true)}
              className="w-full mt-3 py-2.5 rounded-xl text-xs border-2 border-dashed transition-all hover:border-violet-300 flex items-center justify-center gap-1.5"
              style={{ borderColor: "#DDD6FE", color: "#7C3AED", fontWeight: 600 }}
            >
              <PlusIcon size={12} color="currentColor" />
              Agregar evento
            </button>
          </div>
        </div>
      </div>

      {formOpen && <EventFormModal onClose={() => setFormOpen(false)} />}
    </>
  );
}

function WeeklyCalendar({
  days,
  events,
  selectedEvent,
  onSelectEvent,
}: {
  days: { label: string; date: Date; isToday: boolean }[];
  events: CalendarEvent[];
  selectedEvent: string | null;
  onSelectEvent: (id: string | null) => void;
}) {
  const now = new Date();
  const nowDecimal = decimalHour(now);

  return (
    <div className="flex flex-col" style={{ background: "white", minWidth: 720 }}>
      <div className="flex border-b sticky top-0 z-20" style={{ borderColor: "#F3F0FF", background: "white" }}>
        <div className="flex-shrink-0" style={{ width: 56 }} />
        {days.map((day) => (
          <div
            key={day.date.toISOString()}
            className="flex-1 py-3 flex flex-col items-center border-l"
            style={{ borderColor: "#F3F0FF" }}
          >
            <span
              className="text-xs uppercase"
              style={{
                color: day.isToday ? "#7C3AED" : "#A78BFA",
                fontWeight: 600,
                letterSpacing: "0.08em",
              }}
            >
              {day.label}
            </span>
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center mt-1 text-sm"
              style={
                day.isToday
                  ? { background: "var(--gradient-brand)", color: "white", fontWeight: 800 }
                  : { color: "#374151", fontWeight: 600 }
              }
            >
              {day.date.getDate()}
            </div>
          </div>
        ))}
      </div>

      <div className="flex" style={{ minHeight: HOURS.length * HOUR_HEIGHT }}>
        <div className="flex-shrink-0 relative" style={{ width: 56 }}>
          {HOURS.map((h) => (
            <div
              key={h}
              className="flex items-start justify-end pr-3 select-none"
              style={{ height: HOUR_HEIGHT, paddingTop: 2 }}
            >
              <span className="text-xs" style={{ color: "#C4B5FD", fontWeight: 500 }}>
                {String(h).padStart(2, "0")}:00
              </span>
            </div>
          ))}
        </div>

        {days.map((day) => {
          const dayEvents = events.filter(
            (e) => new Date(e.starts_at).toDateString() === day.date.toDateString(),
          );
          return (
            <div
              key={day.date.toISOString()}
              className="flex-1 relative border-l"
              style={{
                borderColor: "#F3F0FF",
                background: day.isToday ? "rgba(124,58,237,0.012)" : "transparent",
              }}
            >
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute w-full border-t"
                  style={{ top: (h - START_HOUR) * HOUR_HEIGHT, borderColor: "#F3F0FF" }}
                />
              ))}
              {HOURS.map((h) => (
                <div
                  key={`${h}-half`}
                  className="absolute w-full border-t"
                  style={{
                    top: (h - START_HOUR + 0.5) * HOUR_HEIGHT,
                    borderColor: "#F9F7FF",
                    borderStyle: "dashed",
                  }}
                />
              ))}

              {/* Línea del "ahora" — hora real, no una constante */}
              {day.isToday && nowDecimal >= START_HOUR && nowDecimal <= END_HOUR && (
                <div
                  className="absolute z-10 flex items-center"
                  style={{ top: (nowDecimal - START_HOUR) * HOUR_HEIGHT - 1, left: 0, right: 0 }}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: "#EC4899", marginLeft: -5 }}
                  />
                  <div
                    className="flex-1 h-0.5"
                    style={{ background: "linear-gradient(90deg, #EC4899, #EC489940)" }}
                  />
                </div>
              )}

              {dayEvents.map((ev) => (
                <CalendarEventBlock
                  key={ev.id}
                  event={ev}
                  isSelected={selectedEvent === ev.id}
                  onSelect={() => onSelectEvent(selectedEvent === ev.id ? null : ev.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarEventBlock({
  event: ev,
  isSelected,
  onSelect,
}: {
  event: CalendarEvent;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const s = TYPE_STYLES[ev.type];
  const start = new Date(ev.starts_at);
  const end = new Date(ev.ends_at);
  const durationHours = (end.getTime() - start.getTime()) / 3_600_000;
  const top = (decimalHour(start) - START_HOUR) * HOUR_HEIGHT + 3;
  const height = Math.max(durationHours * HOUR_HEIGHT - 6, 28);
  const isShort = height < 52;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className="absolute rounded-xl overflow-hidden cursor-pointer transition-all"
      style={{
        top,
        height,
        left: 4,
        right: 4,
        background: s.bg,
        borderLeft: `3px solid ${s.border}`,
        boxShadow: isSelected ? `0 4px 16px ${s.border}44` : "0 1px 4px rgba(0,0,0,0.06)",
        zIndex: isSelected ? 15 : 10,
        transform: isSelected ? "scale(1.01)" : undefined,
      }}
    >
      <div className="px-2.5 py-1.5 h-full flex flex-col justify-between">
        <div className="min-w-0">
          {!isShort && (
            <span
              className="inline-block px-1.5 py-0.5 rounded-md mb-1"
              style={{
                background: s.pill,
                color: s.pillText,
                fontWeight: 700,
                fontSize: "9px",
                letterSpacing: "0.04em",
              }}
            >
              {TYPE_LABELS[ev.type].toUpperCase()}
            </span>
          )}
          <p
            className="leading-tight truncate"
            style={{ color: s.text, fontWeight: 700, fontSize: isShort ? "10px" : "11px" }}
          >
            {ev.title}
          </p>
        </div>
        <p style={{ color: s.sub, fontSize: "9px", fontWeight: 600 }}>
          {isShort ? fmtHour(start) : `${fmtHour(start)} — ${fmtHour(end)}`}
        </p>
      </div>
    </div>
  );
}

function NextEventCard({
  event,
  photo,
  contactName,
  propertyTitle,
  matchScore,
  onOpen,
}: {
  event: CalendarEvent;
  photo: string | null;
  contactName: string | null;
  propertyTitle: string | null;
  matchScore: number | null;
  onOpen: () => void;
}) {
  const s = TYPE_STYLES[event.type];
  const start = new Date(event.starts_at);

  return (
    <div
      className="rounded-2xl overflow-hidden border"
      style={{ borderColor: "#EDE9FE", boxShadow: "0 2px 12px rgba(124,58,237,0.1)" }}
    >
      <div className="relative h-28 overflow-hidden" style={{ background: "#F5F3FF" }}>
        {photo ? (
          <img src={photo} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <EventTypeIcon type={event.type} color="#DDD6FE" size={28} />
          </div>
        )}
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(to top, rgba(31,10,60,0.5) 0%, transparent 60%)" }}
        />
        <div className="absolute top-2.5 left-2.5">
          <span
            className="text-xs px-2 py-1 rounded-full uppercase"
            style={{
              background: `${s.border}D9`,
              color: "white",
              fontWeight: 700,
              fontSize: "10px",
              backdropFilter: "blur(4px)",
            }}
          >
            {TYPE_LABELS[event.type]}
          </span>
        </div>
        <div className="absolute bottom-2.5 left-2.5 right-2.5">
          <p
            className="text-white text-xs truncate"
            style={{ fontWeight: 700, textShadow: "0 1px 4px rgba(0,0,0,0.4)" }}
          >
            {propertyTitle ?? event.title}
          </p>
        </div>
      </div>

      <div className="p-3.5" style={{ background: "white" }}>
        <div className="flex items-center gap-1.5 mb-2.5">
          {contactName && (
            <>
              <div
                className={`w-6 h-6 rounded-full bg-gradient-to-br ${avatarGradient(contactName)} flex items-center justify-center text-white flex-shrink-0`}
                style={{ fontSize: "9px", fontWeight: 800 }}
              >
                {initials(contactName)}
              </div>
              <div className="min-w-0">
                <p className="text-xs truncate" style={{ color: "#1F0A3C", fontWeight: 700 }}>
                  {contactName}
                </p>
                {matchScore !== null && (
                  <p className="text-xs" style={{ color: "#A78BFA", fontSize: "10px" }}>
                    {matchScore}% Match
                  </p>
                )}
              </div>
            </>
          )}
          <div className="ml-auto flex items-center gap-1 flex-shrink-0">
            <ClockIcon size={12} color="#A78BFA" />
            <span className="text-xs" style={{ color: "#7C3AED", fontWeight: 700 }}>
              {fmtHour(start)}
            </span>
          </div>
        </div>
        <button
          onClick={onOpen}
          className="w-full py-2 rounded-xl text-xs text-white text-center transition-all hover:opacity-90"
          style={{ background: "var(--gradient-brand)", fontWeight: 600 }}
        >
          Ver oportunidad →
        </button>
      </div>
    </div>
  );
}
