export function getApiBaseUrl() {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!value || !String(value).trim()) {
    throw new Error("Missing NEXT_PUBLIC_API_BASE_URL environment variable.");
  }
  return String(value).replace(/\/+$/, "");
}
