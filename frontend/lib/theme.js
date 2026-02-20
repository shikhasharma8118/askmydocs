export const THEME_KEY = "askmydocs_theme";

export const APP_THEMES = [
  { id: "blue-gray", label: "Blue Gray (Classic)" },
  { id: "sage", label: "Sage" },
  { id: "warm-paper", label: "Warm Paper" },
];

export function getSavedTheme() {
  if (typeof window === "undefined") {
    return "blue-gray";
  }
  const value = localStorage.getItem(THEME_KEY);
  const valid = APP_THEMES.some((theme) => theme.id === value);
  return valid ? value : "blue-gray";
}

export function applyTheme(themeId) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.setAttribute("data-theme", themeId);
}
