import { Injectable, computed, effect, signal } from '@angular/core';

export type ThemeName = 'dark' | 'light';

const STORAGE_KEY = 'theme';

/**
 * Keeps <html data-theme> in sync with the chosen color theme and remembers it for the next visit.
 * The same key is read by the inline script in index.html, so a stored theme applies before the
 * app boots instead of flashing the default one.
 */
@Injectable({
  providedIn: 'root',
})
export class Theme {
  theme = signal<ThemeName>(storedTheme());
  isDark = computed(() => this.theme() === 'dark');

  constructor() {
    effect(() => {
      const theme = this.theme();
      document.documentElement.dataset['theme'] = theme;
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        // Storage can be unavailable (e.g. private mode); the theme still applies for this session.
      }
    });
  }

  toggle() {
    this.theme.update(current => (current === 'dark' ? 'light' : 'dark'));
  }
}

function storedTheme(): ThemeName {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
