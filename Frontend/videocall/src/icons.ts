/**
 * The controls' icons. Static markup on purpose: it is the same few shapes on every render, and
 * keeping it here means the buttons in the call view need no icon font or image request.
 */

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" ` +
  `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `${body}</svg>`;

export const icons = {
  mic: svg(
    `<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>` +
      `<path d="M19 10v2a7 7 0 0 1-14 0v-2"/>` +
      `<path d="M12 19v3"/><path d="M8 22h8"/>`,
  ),
  mic_off: svg(
    `<path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>` +
      `<path d="M15 9.34V5a3 3 0 0 0-5.94-.6"/>` +
      `<path d="M19 10v2a7 7 0 0 1-11 5.75"/>` +
      `<path d="M12 19v3"/><path d="M8 22h8"/><path d="M2 2l20 20"/>`,
  ),
  camera: svg(
    `<path d="M23 7l-7 5 7 5V7z"/>` +
      `<rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>`,
  ),
  camera_off: svg(
    `<path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>` +
      `<path d="M9.5 5H14a2 2 0 0 1 2 2v3.5l7-4.5v10l-4.5-3"/>` +
      `<path d="M2 2l20 20"/>`,
  ),
  switch_camera: svg(
    `<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>` +
      `<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/>` +
      `<path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>`,
  ),
  screen: svg(
    `<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>` +
      `<path d="M8 21h8"/><path d="M12 17v4"/>`,
  ),
  leave: svg(
    `<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 ` +
      `12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 ` +
      `19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 ` +
      `19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 ` +
      `.7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/>` +
      `<path d="M2 2l20 20"/>`,
  ),
  link: svg(
    `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>` +
      `<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
  ),
} as const;
