/**
 * @prettier
 *
 * The WebAssembly module memo text is merged, encrypted and rendered with.
 */

// @ts-ignore
import init from "../pkg/organizator_wasm.js";

let loading: Promise<unknown> | undefined;

/**
 * Resolves once the module is ready to be called, starting the load if it has not begun.
 *
 * The load is lazy, because a page that never opens a memo has no reason to fetch a megabyte of
 * wasm, and shared, because everything that needs the module goes through this one promise. The
 * callers used to assume the editor had loaded it, which held only while nothing but the editor
 * could reach a merge: caching the whole library from the list page merges memos before any
 * editor has been opened, and there the module was still undefined.
 */
export const wasm_ready = async (): Promise<void> => {
  if (!loading) {
    // A load that failed is not remembered, so the next caller starts another attempt instead of
    // inheriting a promise that has already rejected.
    loading = init().catch((e: unknown) => {
      loading = undefined;
      throw e;
    });
  }
  await loading;
};
