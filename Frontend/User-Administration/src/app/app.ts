import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UserFilter} from './user-filter/user-filter';
import { UserList } from './user-list/user-list';
import { Theme } from './theme';
import { Session } from './session';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, UserFilter, UserList],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('user-administration');

  protected readonly theme = inject(Theme);

  /** Read here to keep the filter away from a non-admin, and filled in by the list's own request. */
  protected readonly session = inject(Session);

  searchTerm = signal<string>('');

  updateFilter(term: string) {
    this.searchTerm.set(term);
  }
}
