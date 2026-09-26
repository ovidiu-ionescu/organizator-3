import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';

import { App } from './app';
import { routes } from './app.routes';

/**
 * The shell: the heading, the theme toggle, and the menu that gets you between the two
 * screens. The screens themselves are tested where they live, so this navigates the real
 * route table and answers whatever the pages it reaches ask the server for.
 */
describe('App', () => {
  let fixture: ComponentFixture<App>;
  let httpMock: HttpTestingController;
  /** What /me answers. Set per test, so a non-admin case really is one. */
  let isAdmin: boolean;

  beforeEach(async () => {
    isAdmin = true;

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(App);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
  });

  /**
   * Navigates and lets the lazy page load, then answers what it asked for. The pages chain
   * their reads — who the visitor is first, then what that lets them see — so this keeps
   * answering until nothing is outstanding, rather than flushing one round and hoping.
   */
  async function go(url: string) {
    await TestBed.inject(Router).navigateByUrl(url);
    await fixture.whenStable();
    fixture.detectChanges();

    for (let round = 0; round < 5; round++) {
      const outstanding = httpMock.match(() => true);
      if (outstanding.length === 0) break;

      for (const request of outstanding) {
        request.flush(responseFor(request.request.url));
      }

      await fixture.whenStable();
      fixture.detectChanges();
    }
  }

  function responseFor(url: string): object {
    if (url === '/organizator/me') {
      return { name: isAdmin ? 'admin' : 'ovidiu', isAdmin, roles: [] };
    }
    if (url === '/organizator/usergroups') {
      return { usergroups: [], requester: { id: 1, name: 'admin' } };
    }
    if (url === '/organizator/memogroups') {
      return { memogroups: [], requester: { id: 1, name: 'admin' } };
    }
    return []; // /user-roles, /admin/all_user_groups
  }

  function navLinks(): HTMLAnchorElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('nav a'));
  }

  it('shows the heading, the theme toggle and both menu entries', async () => {
    await go('/');

    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain(
      'User administration'
    );
    expect(navLinks().map(link => link.textContent?.trim())).toEqual([
      'Users & roles',
      'Groups',
    ]);
    expect(navLinks().map(link => link.getAttribute('href'))).toEqual(['/users', '/groups']);
  });

  it('opens on the users screen', async () => {
    await go('/');

    expect(fixture.nativeElement.querySelector('app-users-page')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-groups-page')).toBeNull();
  });

  it('reaches the groups screen through the menu', async () => {
    await go('/groups');

    expect(fixture.nativeElement.querySelector('app-groups-page')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-users-page')).toBeNull();
  });

  it('sends an unknown path to the users screen rather than nowhere', async () => {
    await go('/no-such-screen');

    expect(fixture.nativeElement.querySelector('app-users-page')).toBeTruthy();
  });

  it('marks the entry you are on, and only that one', async () => {
    await go('/');

    expect(navLinks()[0].getAttribute('aria-current')).toBe('page');
    expect(navLinks()[1].getAttribute('aria-current')).toBeNull();

    await go('/groups');

    expect(navLinks()[0].getAttribute('aria-current')).toBeNull();
    expect(navLinks()[1].getAttribute('aria-current')).toBe('page');
  });

  it('shows the menu to a non-admin too, who has their own groups to manage', async () => {
    isAdmin = false;

    await go('/groups');

    // The groups screen is theirs as well — the endpoint returns only their own — so the
    // entry is not hidden from them the way the user list's filter is. The admin report on
    // that screen is, though.
    expect(navLinks()).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('app-groups-page')).toBeTruthy();
  });

  it('switches the theme and remembers it', async () => {
    await go('/');

    const toggle = fixture.nativeElement.querySelector('.app-header button') as HTMLButtonElement;

    toggle.click();
    fixture.detectChanges();

    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
    expect(toggle.textContent).toContain('Switch to dark theme');

    toggle.click();
    fixture.detectChanges();

    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(toggle.textContent).toContain('Switch to light theme');
  });
});
