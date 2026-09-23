import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthRedirect } from './auth-redirect';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authRedirect = inject(AuthRedirect);

  // Clone request to include cookies
  const authReq = req.clone({
    withCredentials: true
  });

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // If unauthorized, redirect to the external login page with return parameter
      if (error.status === 401) {
        authRedirect.redirectToLogin();
      }
      return throwError(() => error);
    })
  );
};
