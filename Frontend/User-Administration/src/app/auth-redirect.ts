import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class AuthRedirect {
  private loginBaseUrl = '/login.html';

  redirectToLogin() {
    // Capture current page URL and URL-encode it
    const returnUrl = encodeURIComponent(window.location.href);

    // Redirect browser to external login page
    window.location.href = `${this.loginBaseUrl}?r=${returnUrl}`;
  }
}
