import { TestBed } from '@angular/core/testing';

import { Theme } from './theme';

describe('Theme', () => {
  beforeEach(() => clearTheme());
  afterEach(() => clearTheme());

  it('defaults to dark', () => {
    expect(TestBed.inject(Theme).theme()).toBe('dark');
  });

  it('restores the theme chosen on an earlier visit', () => {
    localStorage.setItem('theme', 'light');

    expect(TestBed.inject(Theme).theme()).toBe('light');
  });

  it('toggles between dark and light', () => {
    const theme = TestBed.inject(Theme);

    theme.toggle();
    expect(theme.theme()).toBe('light');
    expect(theme.isDark()).toBe(false);

    theme.toggle();
    expect(theme.theme()).toBe('dark');
    expect(theme.isDark()).toBe(true);
  });
});

function clearTheme() {
  localStorage.clear();
  delete document.documentElement.dataset['theme'];
}
