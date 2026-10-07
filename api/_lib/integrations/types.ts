/**
 * Contrato de un portal (adapter) del motor de publicación multi-inmobiliaria.
 *
 *   Organization (agencies) ─┬─ Portal Connection (agency_integrations, 1 por portal)
 *                            └─ Publication (property_publications, 1 por propiedad y portal,
 *                                            con connection_id → la conexión usada)
 *
 *   Propiedad → Engine (engine.ts) → Adapter (este contrato) → API del portal
 *
 * Reglas para cualquier adapter:
 *  - Recibe SIEMPRE el `agencyId` del usuario autenticado (lo resuelve
 *    api/_lib/auth.ts). Nunca acepta un agencyId, token o credencial del cliente.
 *  - Nunca devuelve ni loguea tokens, contraseñas ni respuestas crudas del portal.
 *  - Los mensajes (`message`, `issues`) son para alguien que no sabe nada de APIs.
 *  - `publish` es idempotente: si la propiedad ya tiene aviso vivo, lo actualiza.
 *
 * Este archivo es solo tipos (lo importan también las pruebas sin red).
 */

export type PortalId = "mercadolibre" | "meta" | "argenprop" | "zonaprop";

/** Coincide con el check `auth_method` de agency_integrations (migración 20261006120000). */
export type AuthMethod = "oauth" | "credentials" | "api_key" | "feed";

/** Si el conector se puede usar hoy y, si no, por qué. */
export type Availability =
  | { state: "available" }
  /** Hay código, pero falta un paso externo (p. ej. App Review de Meta). */
  | { state: "needs_approval"; reason: string }
  /** No hay conector todavía (falta documentación oficial o acuerdo de integrador). */
  | { state: "coming_soon"; reason: string }
  /** Hay código pero faltan variables de entorno en este deploy. */
  | { state: "not_configured"; reason: string };

/** Estado de la conexión de UNA agencia con el portal, tal como se muestra en Configuración → Integraciones. */
export type ConnectionState = "connected" | "not_connected" | "error" | "needs_reauth" | "unavailable";

export interface ConnectionStatus {
  portal: PortalId;
  state: ConnectionState;
  /** Nombre visible de la cuenta (nickname de ML, nombre de la Página…). Nunca un id ni un token. */
  accountLabel: string | null;
  connectedAt: string | null;
  /** Último error, en lenguaje para la inmobiliaria. */
  lastError: string | null;
  lastCheckedAt: string | null;
  authMethod: AuthMethod;
  availability: Availability;
}

export interface AgencyScope {
  agencyId: string;
  userId: string;
  role: string;
}

export interface PortalIssue {
  field: string;
  message: string;
  blocking: boolean;
}

/**
 * Resultado de una acción por portal. `outcome` es estable (lo usa la UI);
 * `message` es texto para la persona.
 */
export type PublishOutcome =
  | "ready" //            check: se puede publicar
  | "published" //        aviso nuevo creado
  | "updated" //          ya existía: se actualizó (idempotencia)
  | "pending_payment" //  el portal creó el aviso pero falta pagar/cupo (402 de ML)
  | "invalid" //          faltan datos (ver issues)
  | "rejected" //         el portal rechazó el aviso
  | "not_connected"
  | "needs_reauth"
  | "unavailable" //      el portal no tiene conector disponible
  | "in_progress" //      hay otro intento en curso (doble clic)
  | "not_published" //    acción sobre un aviso que no existe
  | "property_not_found"
  | "error";

export interface PublishResult {
  portal: PortalId;
  outcome: PublishOutcome;
  ok: boolean;
  message: string | null;
  issues: PortalIssue[];
  warnings: string[];
  /** Fila de property_publications tal como quedó (sin secretos). */
  row: Record<string, unknown> | null;
}

/** Datos por portal que manda el cliente (cada adapter valida y normaliza los suyos). */
export type PortalInput = Record<string, unknown>;

export type LifecycleAction = "pause" | "activate" | "close" | "sync";

export interface PublishRequest {
  scope: AgencyScope;
  /** uuid de `properties` (Property.app_property_id del CRM). "" si la propiedad solo vive en el CRM. */
  propertyId: string;
  /** Id local del CRM. Solo, cuando la propiedad no está en la app (pesos o sin sincronizar). */
  crmPropertyId?: string | null;
  input: PortalInput;
}

export interface ConnectStart {
  /** OAuth: URL a la que va el navegador. */
  url?: string;
  /** Cookie (ya armada) que hay que setear antes de redirigir. */
  setCookie?: string;
  /** Credenciales: la UI tiene que mostrar el formulario guiado. */
  form?: boolean;
}

export interface PortalAdapter {
  id: PortalId;
  name: string;
  authMethod: AuthMethod;
  /** Canales de property_publications que escribe (Meta escribe facebook e instagram). */
  channels: string[];
  /**
   * Puede publicar propiedades que no están en la app (solo CRM): recibe la
   * ficha y las fotos del cliente y las valida (hoy, solo Mercado Libre).
   */
  supportsCrmOnly?: boolean;
  availability(): Availability;

  /* ── conexión ─────────────────────────────────────────────────────── */
  status(scope: AgencyScope): Promise<ConnectionStatus>;
  /** Inicia la conexión (solo admins; lo verifica el endpoint). `returnTo` ya validado. */
  connect(scope: AgencyScope, opts: { returnTo: string }): Promise<ConnectStart>;
  disconnect(scope: AgencyScope): Promise<void>;
  /** Renueva la sesión si hace falta. Lanza si no se puede (el motivo queda en last_error). */
  refresh(scope: AgencyScope): Promise<void>;

  /* ── publicación ──────────────────────────────────────────────────── */
  validate(req: PublishRequest): Promise<PublishResult>;
  publish(req: PublishRequest): Promise<PublishResult>;
  update(req: PublishRequest): Promise<PublishResult>;
  lifecycle(req: PublishRequest, action: LifecycleAction): Promise<PublishResult>;
  /** Estado del portal → estado de property_publications (con mensaje legible). */
  mapStatus(raw: unknown): { status: string; message: string | null };
}
