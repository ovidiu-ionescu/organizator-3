/**
 * @prettier
 *
 * The display themes: what they are called, which one the reader chose, and how a choice is put
 * on the page.
 *
 * The palettes are in src/html/themes.css, keyed off the attribute this module sets on <html> —
 * a colour theme is a block in that file and a line in the list below, no TypeScript. A theme's
 * *layout* (the Links boxes) lives in the shadow styles of the component that owns the markup it
 * rearranges, because a page stylesheet cannot select inside a shadow root; see memo-editor.ts.
 */

import konsole from "./console_log.js";
import { theme_changed } from "./events.js";

/// Where the choice is kept. It is read before the first paint by a script in memo.html (a module
/// script would run too late, and the general_store in IndexedDB is asynchronous, so the app would
/// flash the default theme and then change) — the two places have to agree on this name.
export const THEME_STORAGE_KEY = "memo_theme";

export const THEMES = [
  { id: "dark", name: "Dark" },
  { id: "light", name: "Light" },
  { id: "paper", name: "Paper" },
  { id: "links", name: "Links" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "dark";

const is_a_theme = (value: null | string): value is ThemeId =>
  THEMES.some((theme) => theme.id === value);

/// The theme the page is showing, which is what the stylesheet has already been keyed off.
export const current_theme = (): ThemeId => {
  const showing = document.documentElement.dataset.theme ?? null;
  return is_a_theme(showing) ? showing : DEFAULT_THEME;
};

/// The theme the reader chose, from the last time they chose one. Anything unrecognised — an old
/// name, a value edited by hand — is the default rather than a page with no colours at all.
export const stored_theme = (): ThemeId => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return is_a_theme(stored) ? stored : DEFAULT_THEME;
  } catch (e) {
    konsole.log("Could not read the stored theme", e);
    return DEFAULT_THEME;
  }
};

/// Show a theme, remember it, and tell whatever is on screen about it.
export const apply_theme = (theme: ThemeId) => {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (e) {
    // A browser that will not write it: the theme holds for this page, and the next start comes
    // up on the default.
    konsole.log("Could not store the theme", e);
  }
  // What the status bar is drawn in when the app is installed on a phone. Read back from the
  // stylesheet rather than repeated here, so the two cannot drift apart.
  const background = getComputedStyle(document.documentElement).getPropertyValue("--memo-bg").trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && background) {
    meta.setAttribute("content", background);
  }
  theme_changed(theme);
};
