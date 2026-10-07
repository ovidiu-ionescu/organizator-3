import { Injectable, computed, signal } from '@angular/core';

/** The shape of the wasm package's module, as much of it as this app uses. */
interface OrganizatorWasm {
  default: () => Promise<unknown>;
  /** Markdown to HTML. `base_64_limit` of 0 leaves long payloads alone. */
  process_markdown: (markdown: string, base64Limit: number) => string;
}

/**
 * Renders notes as markdown, through the same `organizator-wasm` the memo editor uses — so a note
 * looks the same in both frontends, and there is one markdown dialect in the project rather than
 * two that drift.
 *
 * The package is copied into the build (`angular.json`, from `../organizator-wasm/pkg` to `pkg`)
 * and fetched at runtime, the way the memo app does it. It is loaded on demand rather than at
 * startup: it is a sizeable wasm file, and nobody reading the calendar needs it until they are
 * looking at a note.
 *
 * **The output is safe to put in the DOM.** The package runs its HTML through `ammonia`, an
 * allow-list sanitiser, before returning it (`organizator-wasm/src/markdown.rs`). Angular's
 * `[innerHTML]` sanitises it a second time on the way in, which is belt and braces rather than
 * the only thing standing between a note and the page.
 */
@Injectable({
  providedIn: 'root',
})
export class Markdown {
  private renderer = signal<((markdown: string) => string) | null>(null);
  private loading?: Promise<void>;

  /**
   * Rendered results, kept because the caller renders in a template binding: the same note is
   * asked for on every change detection, and a calendar can hold hundreds of them.
   */
  private cache = new Map<string, string>();

  isReady = computed(() => this.renderer() !== null);

  /** Loads the renderer once. Every caller waits on the same load. */
  load(): Promise<void> {
    this.loading ??= this.loadOnce();
    return this.loading;
  }

  private async loadOnce(): Promise<void> {
    try {
      // Resolved against the document's base, so it follows the base href the app is built and
      // served with rather than assuming it is at the root.
      const url = new URL('pkg/organizator_wasm.js', document.baseURI).href;
      const module = (await import(url)) as OrganizatorWasm;
      await module.default();

      this.renderer.set(markdown => module.process_markdown(markdown, 0));
    } catch (err) {
      // A note is worth reading as it was written, so a renderer that will not load is not worth
      // failing the screen over: render() keeps answering null and the caller shows the text.
      console.error('Could not load the markdown renderer:', err);
    }
  }

  /**
   * The HTML for a piece of markdown, or null while the renderer is not loaded — the caller shows
   * the text as it stands until then, rather than nothing.
   */
  render(markdown: string): string | null {
    const render = this.renderer();
    if (render === null) return null;

    const already = this.cache.get(markdown);
    if (already !== undefined) return already;

    const html = render(markdown);
    this.cache.set(markdown, html);
    return html;
  }
}
