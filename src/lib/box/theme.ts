export type ThemeId = "field" | "steam";

const KEY = "spookbox-theme";

export function readTheme(): ThemeId {
  if (typeof localStorage === "undefined") return "field";
  return localStorage.getItem(KEY) === "steam" ? "steam" : "field";
}

export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode */
  }
}
