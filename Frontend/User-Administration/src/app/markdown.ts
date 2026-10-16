import { Injectable, computed, inject, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

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
 * **The output is the package's own, and it is taken as it stands.** The package runs its HTML
 * through `ammonia`, an allow-list sanitiser, before returning it (see
 * `organizator-wasm/src/markdown.rs`), and `render` hands the result over marked trusted, so
 * `[innerHTML]` puts it in the page as written. That is the same list a note is held to in the
 * memo app, which shows this same HTML with no second pass at all.
 *
 * Marking it trusted is what gives up Angular's own pass over `[innerHTML]`, and it has to be
 * given up: that pass drops the `data-gen` attribute the barcode markup is styled by, so a note
 * holding a barcode came out as a line of digits. Ammonia is then the only thing between a note and
 * the page, which is why `render` marks trusted exactly what the package returned and nothing else.
 */
@Injectable({
  providedIn: 'root',
})
export class Markdown {
  private sanitizer = inject(DomSanitizer);
  private renderer = signal<((markdown: string) => string) | null>(null);
  private loading?: Promise<void>;

  /**
   * Rendered results, kept because the caller renders in a template binding: the same note is
   * asked for on every change detection, and a calendar can hold hundreds of them. The trusted
   * value is kept along with its HTML, so a binding checked again is handed the same object rather
   * than a fresh one it would take for a change and write the element out over.
   */
  private cache = new Map<string, SafeHtml>();

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
   * The HTML for a piece of markdown, marked trusted, or null while the renderer is not loaded —
   * the caller shows the text as it stands until then, rather than nothing.
   */
  render(markdown: string): SafeHtml | null {
    const render = this.renderer();
    if (render === null) return null;

    const already = this.cache.get(markdown);
    if (already !== undefined) return already;

    const html = this.sanitizer.bypassSecurityTrustHtml(render(markdown));
    this.cache.set(markdown, html);
    return html;
  }
}
