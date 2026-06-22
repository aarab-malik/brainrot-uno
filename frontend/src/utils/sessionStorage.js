const SESSION_KEY = "uno-session";

export function saveUnoSession({ code, slot, name }) {
  if (!code || !name) return;
  const payload = { code: code.toUpperCase(), name: name.trim() };
  if (slot != null) payload.slot = Number(slot);
  localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
}

export function loadUnoSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.code || !data.name) return null;
    const session = {
      code: String(data.code).toUpperCase(),
      name: String(data.name),
    };
    if (data.slot != null) session.slot = Number(data.slot);
    return session;
  } catch {
    return null;
  }
}

export function clearUnoSession() {
  localStorage.removeItem(SESSION_KEY);
}
