/**
 * @prettier
 *
 * Renders markdown through the same wasm the editor draws memos with, for the pages that only read
 * notes — today the calendar.
 *
 * The editor calls process_markdown itself, since it already holds the module for encrypting and
 * merging; a page that has no other use for the module goes through here, where the load is started
 * once and the results are kept.
 */
import {wasm_ready} from "./wasm.js";
// @ts-ignore
import {process_markdown} from "../pkg/organizator_wasm.js";

let renderer: ((markdown: string) => string) | null = null;
let loading: Promise<void> | undefined;

/**
 * What has already been rendered. The calendar redraws its whole list on every change, so a note
 * would be handed to the renderer again and again for no new answer.
 */
const rendered = new Map<string, string>();

/// Starts the module if it has not been started, and resolves when it can be called. Every caller
/// waits on the same load; a load that failed is not remembered, so the next one tries again.
export const load_markdown = (): Promise<void> => {
  loading ??= wasm_ready().then(() => {
    renderer = markdown => process_markdown(markdown, 0);
  });
  return loading;
};

/**
 * The HTML for a piece of markdown, or null while the module is still on its way — the caller shows
 * the note as it was written until then, rather than an empty space where a note should be.
 */
export const render_markdown = (markdown: string): string | null => {
  if (renderer === null) return null;

  const already = rendered.get(markdown);
  if (already !== undefined) return already;

  const html = renderer(markdown);
  rendered.set(markdown, html);
  return html;
};
