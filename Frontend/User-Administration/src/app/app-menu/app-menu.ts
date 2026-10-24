import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { AppLinks } from '../app-links';

interface MenuEntry {
  label: string;
  /// The SVG path of the entry's picture, when it has one.
  icon?: string;
  run: () => void;
}

// The same pictures the memo app's menu shows for these two destinations, with the fill left to
// the theme: there they sit on a dark bar, here on the page's own surface.
const MEMOS_ICON =
  'M40 4H8C5.79 4 4 5.79 4 8v24c0 2.21 1.79 4 4 4h28l8 8V8c0-2.21-1.79-4-4-4zm-4 24H12v-4h24v4zm0-6H12v-4h24v4zm0-6H12v-4h24v4z';
const CALENDAR_ICON =
  'M38 6h-2V2h-4v4H16V2h-4v4h-2c-2.21 0-3.98 1.79-3.98 4L6 38c0 2.21 1.79 4 4 4h28c2.21 0 4-1.79 4-4V10c0-2.21-1.79-4-4-4zm0 32H10V16h28v22zM14 20h10v10H14z';
/**
 * The menu behind the three dots: the way back to the other screens on this host.
 *
 * The same destinations as the menu in the memo and calendar pages — the two places this app is
 * reached from — so the reader can always get back. It is a component of this app rather than the
 * other app's element: the two are written differently, and what they share is what the menu
 * says, not how it is built.
 *
 * A native modal dialog: the browser keeps the focus inside it, closes it on Escape, and gives
 * the rest of the page back when it is done. `showModal` and `close` are guarded because the
 * unit-test DOM does not implement them; the fallback does what the dialog would for this small
 * piece — open the element, focus the first entry, and put the focus back.
 */
@Component({
  selector: 'app-menu',
  template: `
    <button
      #trigger
      type="button"
      class="btn menu-trigger"
      aria-label="More"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      (click)="openMenu()"
    >
      <!-- The three dots the memo app's own menu button wears. -->
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="5" r="2.2" />
        <circle cx="12" cy="12" r="2.2" />
        <circle cx="12" cy="19" r="2.2" />
      </svg>
    </button>

    <dialog #dialog class="menu-dialog" aria-label="Application menu" (close)="menuClosed()">
      <div class="menu-entries">
        @for (entry of entries; track entry.label) {
          <button type="button" class="menu-entry" (click)="choose(entry)">
            @if (entry.icon) {
              <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
                <path [attr.d]="entry.icon" />
              </svg>
            }
            {{ entry.label }}
          </button>
        }
      </div>
      <div class="menu-actions">
        <button type="button" class="btn" (click)="closeMenu()">Close</button>
      </div>
    </dialog>
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .menu-trigger {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.75rem;
      height: 2.75rem;
      padding: 0;
    }

    .menu-trigger svg {
      width: 1.5rem;
      height: 1.5rem;
      fill: currentColor;
    }

    .menu-dialog {
      min-width: 16rem;
      max-width: calc(100vw - 2rem);
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      background-color: var(--surface);
      color: var(--text);
      box-shadow: 0 10px 30px rgb(0 0 0 / 35%);
    }

    .menu-dialog::backdrop {
      background-color: rgb(0 0 0 / 45%);
    }

    .menu-entries {
      display: flex;
      flex-direction: column;
    }

    .menu-entry {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.7rem 0.9rem;
      border: 0;
      border-bottom: 1px solid var(--border-subtle);
      background: none;
      color: var(--text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .menu-entry:last-child {
      border-bottom: 0;
    }

    .menu-entry:hover {
      background-color: var(--surface-hover);
    }

    .menu-entry:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: -2px;
    }

    .menu-entry svg {
      width: 1.25rem;
      height: 1.25rem;
      fill: currentColor;
      opacity: 0.9;
    }

    .menu-actions {
      display: flex;
      justify-content: flex-end;
      padding: 0.6rem 0.9rem;
      border-top: 1px solid var(--border-subtle);
    }
  `,
})
export class AppMenu {
  private readonly links = inject(AppLinks);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly open = signal(false);

  protected readonly entries: readonly MenuEntry[] = [
    { label: 'Memos', icon: MEMOS_ICON, run: () => this.links.go('/memo/') },
    { label: 'Calendar', icon: CALENDAR_ICON, run: () => this.links.go('/calendar') },
    { label: 'Memo Maintenance', run: () => this.links.go('/memo/$$$admin') },
    { label: 'Journal', run: () => this.links.go('/journal') },
    { label: 'Log out', run: () => this.links.logOut() },
  ];

  protected openMenu(): void {
    if (this.open()) return;
    const dialog = this.dialog().nativeElement;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      // The unit-test DOM has no modal dialog; showing it is enough to exercise the rest.
      dialog.setAttribute('open', '');
    }
    this.open.set(true);
    dialog.querySelector<HTMLButtonElement>('.menu-entry')?.focus();
  }

  protected closeMenu(): void {
    const dialog = this.dialog().nativeElement;
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
      this.menuClosed();
    }
  }

  protected menuClosed(): void {
    this.open.set(false);
    this.trigger().nativeElement.focus();
  }

  protected choose(entry: MenuEntry): void {
    this.closeMenu();
    entry.run();
  }
}
