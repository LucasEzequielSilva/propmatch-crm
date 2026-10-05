/** Marca de "estoy en la demo" que sobrevive a un refresh, no a cerrar la pestaña. */
const DEMO_FLAG_KEY = "propmatch.demo";

export function isDemoActive(): boolean {
  try {
    return sessionStorage.getItem(DEMO_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDemoFlag(on: boolean) {
  try {
    if (on) sessionStorage.setItem(DEMO_FLAG_KEY, "1");
    else sessionStorage.removeItem(DEMO_FLAG_KEY);
  } catch {
    // Storage bloqueado: la demo dura hasta el próximo refresh.
  }
}
