export function clearLocalSession() {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.removeItem("access_token");
  localStorage.removeItem("current_user");
  localStorage.removeItem("auth_mode");
}

function parseJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) {
      return null;
    }
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(normalized);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function getValidAccessToken() {
  if (typeof window === "undefined") {
    return null;
  }

  const token = localStorage.getItem("access_token");
  if (!token) {
    return null;
  }

  const payload = parseJwtPayload(token);
  const exp = Number(payload?.exp || 0);
  if (!exp) {
    return token;
  }

  const now = Math.floor(Date.now() / 1000);
  if (exp <= now + 5) {
    clearLocalSession();
    return null;
  }

  return token;
}
