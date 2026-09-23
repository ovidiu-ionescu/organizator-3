import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, of, shareReplay, tap } from 'rxjs';
// A type-only import: the component file imports this service, so a value import back would be a
// cycle. Nothing of it survives into the emitted JavaScript.
import type { Role } from './user-list/user-list';

/** Who the server says the signed-in visitor is. */
export interface Account {
  name: string;
  isAdmin: boolean;
  roles: Role[];
}

/**
 * The signed-in account, read once from /me and shared by everything that needs it: the list shows
 * every user to an admin and only the visitor's own roles and password form to anyone else, and the
 * header keeps the filter out of a non-admin's way.
 */
@Injectable({
  providedIn: 'root',
})
export class Session {
  private http = inject(HttpClient);

  private account = signal<Account | null>(null);

  /** The signed-in user's name, or null until the server has answered. */
  name = computed(() => this.account()?.name ?? null);

  /**
   * Whether the visitor may see the user list. null until the server has answered, so that a caller
   * can tell "not an admin" apart from "not known yet" — otherwise the admin view would appear and
   * be taken back a moment later.
   */
  isAdmin = computed(() => this.account()?.isAdmin ?? null);

  /** What the signed-in user has access to, empty until the server has answered. */
  roles = computed<Role[]>(() => this.account()?.roles ?? []);

  private pending?: Observable<Account | null>;

  /**
   * Reads the account and publishes it. Every call gets the same response, so the one request is
   * shared. An answer that never arrives reads as null rather than throwing, and the caller decides
   * what the visitor sees then.
   */
  load(): Observable<Account | null> {
    this.pending ??= this.http.get<Account>('/organizator/me', {
      withCredentials: true // Automatically sends stored JWT cookie
    }).pipe(
      tap(account => this.account.set(account)),
      catchError((err: HttpErrorResponse) => {
        console.error('Failed to load the account:', err.status);
        return of(null);
      }),
      shareReplay(1)
    );
    return this.pending;
  }
}
