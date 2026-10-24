import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { AppLinks } from '../app-links';
import { AppMenu } from './app-menu';

/**
 * The menu in the heading: the way back to the memo app, its calendar and journal, and out.
 *
 * The destinations are pages of other applications, so the service that goes to them is replaced
 * here by one that writes down where it was sent. That keeps the test on the dialog — what it
 * offers, what a choice does, and where the focus goes — without a browser navigation.
 */
describe('AppMenu', () => {
  let fixture: ComponentFixture<AppMenu>;
  /** Where the menu sent the reader, in order. The stub's own word for signing out is "log out". */
  let went: string[];

  beforeEach(async () => {
    went = [];
    const links = {
      go: (where: string) => went.push(where),
      logOut: () => went.push('log out'),
    };

    await TestBed.configureTestingModule({
      imports: [AppMenu],
      providers: [provideZonelessChangeDetection(), { provide: AppLinks, useValue: links }],
    }).compileComponents();

    fixture = TestBed.createComponent(AppMenu);
    fixture.detectChanges();
  });

  const trigger = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('button.menu-trigger') as HTMLButtonElement;

  const dialog = (): HTMLDialogElement =>
    fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;

  const entries = (): HTMLButtonElement[] =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        'button.menu-entry',
      ),
    );

  const labels = (): (string | undefined)[] => entries().map((entry) => entry.textContent?.trim());

  function open(): void {
    trigger().click();
    fixture.detectChanges();
  }

  function closeWithButton(): void {
    const button = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button.btn'),
    ).find((candidate) => candidate.textContent?.trim() === 'Close');
    if (button === undefined) throw new Error('The menu has no Close button');
    button.click();
    fixture.detectChanges();
  }

  it('stays closed until asked, and tells a screen reader where it stands', () => {
    expect(dialog().open).toBe(false);
    expect(trigger().getAttribute('aria-label')).toBe('More');
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(dialog().getAttribute('aria-label')).toBe('Application menu');
  });

  it('offers the way back to the rest of the app', () => {
    open();

    expect(dialog().open).toBe(true);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    // The same destinations, and in the same order, as the menu in the memo app: what the reader
    // learned there is what this one says.
    expect(labels()).toEqual(['Memos', 'Calendar', 'Memo Maintenance', 'Journal', 'Log out']);
    // The first entry is where the keyboard starts, which is where a modal dialog belongs.
    expect(document.activeElement).toBe(entries()[0]);
  });

  it('goes where an entry says, and gives the focus back on the way out', () => {
    open();
    entries()[0].click();
    fixture.detectChanges();

    expect(went).toEqual(['/memo/']);
    expect(dialog().open).toBe(false);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });

  it('reaches the calendar, the maintenance page and the journal', () => {
    open();
    entries()[1].click();
    fixture.detectChanges();

    open();
    entries()[2].click();
    fixture.detectChanges();

    open();
    entries()[3].click();
    fixture.detectChanges();

    expect(went).toEqual(['/calendar', '/memo/$$$admin', '/journal']);
  });

  it('signs out from the menu', () => {
    open();
    entries()[4].click();
    fixture.detectChanges();

    expect(went).toEqual(['log out']);
    expect(dialog().open).toBe(false);
  });

  it('closes with its own button rather than going anywhere', () => {
    open();
    closeWithButton();

    expect(went).toEqual([]);
    expect(dialog().open).toBe(false);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });

  it('opens once, even when the trigger is pressed twice', () => {
    open();
    open();

    expect(dialog().open).toBe(true);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });
});
