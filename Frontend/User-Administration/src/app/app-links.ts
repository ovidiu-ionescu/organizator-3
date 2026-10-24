import { Injectable, inject } from '@angular/core';
import { AuthRedirect } from './auth-redirect';

/**
 * The places this app's menu goes, and leaving it.
 *
 * The destinations are pages of other applications on the same host — the memo app, its calendar
 * and its journal — so they are ordinary navigations rather than routes of this app's router.
 * Keeping them in one service leaves the menu component about the dialog itself, and lets a test
 * see where an entry goes without a browser navigation.
 */
@Injectable({
  providedIn: 'root',
})
export class AppLinks {
  private readonly redirect = inject(AuthRedirect);

  go(where: string): void {
    window.location.assign(where);
  }

  /**
   * Sign out on the server, then out of the app. The cookie is HttpOnly, so only the server can
   * clear it; if the server cannot be reached, the login page is still the right place to be.
   */
  logOut(): void {
    void fetch('/organizator/logout', { credentials: 'include', method: 'GET' })
      .catch(() => undefined)
      .finally(() => this.redirect.redirectToLogin());
  }
}
