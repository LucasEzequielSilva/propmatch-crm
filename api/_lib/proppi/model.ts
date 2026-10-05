/**
 * Modelo de Proppi, configurable en un solo lugar (env `PROPPI_MODEL`).
 *
 * Default: `claude-haiku-4-5` (el más barato). Se puede volver a
 * `claude-opus-5-5` (u otro 5.x) sin tocar código: el request se arma según lo
 * que soporta cada modelo.
 */
export const DEFAULT_PROPPI_MODEL = "claude-haiku-4-5";

export function proppiModel(): string {
  return process.env.PROPPI_MODEL?.trim() || DEFAULT_PROPPI_MODEL;
}

export type ProppiMode = "panel" | "inbox";

export interface ModelCaps {
  /** `output_config.effort`: Opus/Sonnet 5.x, Fable, Mythos. En Haiku 4.5 da error, no se manda. */
  effort: boolean;
  /** `fallbacks: "default"` (beta server-side-fallback-2026-07-01): solo modelos 5.x / Fable / Mythos. */
  serverFallback: boolean;
}

/**
 * Thinking: nunca se manda el parámetro. En Haiku 4.5 eso es "sin thinking";
 * en Opus 5.5 / Opus 5 omitirlo = adaptive (y `disabled` o `budget_tokens` dan 400).
 */
export function modelCaps(model: string): ModelCaps {
  const gen5 = /^claude-(opus|sonnet)-5|^claude-(fable|mythos)-/.test(model);
  return { effort: gen5, serverFallback: gen5 };
}

export const EFFORT: Record<ProppiMode, "low" | "medium"> = { panel: "medium", inbox: "low" };

export const MAX_TOKENS: Record<ProppiMode, number> = { panel: 4096, inbox: 1500 };
