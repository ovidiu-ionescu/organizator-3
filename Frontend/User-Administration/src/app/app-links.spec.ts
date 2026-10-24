import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AppLinks } from './app-links';
import { AuthRedirect } from './auth-redirect';

/**
 * Signing out is the one thing this service does beyond a plain navigation: the session cookie is
 * HttpOnly, so the server has to clear it, and the login page is the destination whether or not it
 * answered.
 */
describe('AppLinks', () => {
  let redirects: number;
  let requested: { url: string; init?: RequestInit }[];

  beforeEach(() => {
    redirects = 0;
    requested = [];

    TestBed.configureTestingModule({
      providers: [
        AppLinks,
        { provide: AuthRedirect, useValue: { redirectToLogin: () => redirects++ } },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the server to end the session, then goes to the login page', async () => {
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      requested.push({ url, init });
      return new Response(null, { status: 204 });
    });

    TestBed.inject(AppLinks).logOut();
    await vi.waitFor(() => expect(redirects).toBe(1));

    // The cookie goes with the request because only the server can clear it; the page is left
    // after the answer, so the request is not cut short by the navigation.
    expect(requested).toHaveLength(1);
    expect(requested[0].url).toBe('/organizator/logout');
    expect(requested[0].init).toMatchObject({ credentials: 'include', method: 'GET' });
  });

  it('still goes to the login page when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('NetworkError when attempting to fetch resource.');
    });

    TestBed.inject(AppLinks).logOut();
    await vi.waitFor(() => expect(redirects).toBe(1));
  });
});
