import { Component, inject, signal } from '@angular/core';
import { UserFilter } from '../user-filter/user-filter';
import { UserList } from '../user-list/user-list';
import { Session } from '../session';

/**
 * The screen the app has always had: the user list with role editing and password changes.
 * It moved out of App when App became the shell around the menu, and is otherwise what it
 * was — the filter and the list are unchanged.
 */
@Component({
  selector: 'app-users-page',
  imports: [UserFilter, UserList],
  templateUrl: './users-page.html',
  styleUrl: './users-page.css',
})
export class UsersPage {
  /** Read here to keep the filter away from a non-admin, and filled in by the list's own request. */
  protected readonly session = inject(Session);

  searchTerm = signal<string>('');

  updateFilter(term: string) {
    this.searchTerm.set(term);
  }
}
