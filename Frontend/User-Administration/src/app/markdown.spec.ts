import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { Markdown } from './markdown';

/**
 * Only what holds when the wasm package cannot be fetched, which is the case here: jsdom has no
 * way to load it. The rendering itself is the package's own, exercised by its Rust tests and by
 * driving it directly — what this app owns is the loading, the caching and what happens when
 * either fails.
 */
describe('Markdown', () => {
  let markdown: Markdown;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    markdown = TestBed.inject(Markdown);
  });

  it('answers nothing until the renderer has loaded', () => {
    // The callers rely on this to show the note as it was written instead of an empty box.
    expect(markdown.isReady()).toBe(false);
    expect(markdown.render('# anything')).toBeNull();
  });

  it('gives up quietly when the package cannot be loaded', async () => {
    // A note is worth reading even when it cannot be rendered, so a failed load must not throw
    // out of load() and must not leave render() claiming to have something.
    await expect(markdown.load()).resolves.toBeUndefined();

    expect(markdown.isReady()).toBe(false);
    expect(markdown.render('# anything')).toBeNull();
  });

  it('loads once, however many callers ask', async () => {
    // One fetch for the page, not one per note.
    const first = markdown.load();
    const second = markdown.load();

    expect(first).toBe(second);
    await first;
  });
});
