import { Component, ElementRef, effect, inject, input, signal, computed, viewChild, viewChildren } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { HighlightPipe } from '../highlight-pipe';
import { Session } from '../session';

/**
 * The id of the signed-in user's own row, which stands in for the list a non-admin may not read. It
 * is never sent anywhere: the row's password form posts the name the server gave us, and only has to
 * be an id no real user can have, which database keys — always positive — cannot.
 */
const SELF_ROW_ID = -1;

export interface Role {
  id: number;
  name: string;
  description: string;
}

export interface User {
  id: number;
  name: string;
  roles: Role[];
}

/** Body of the PUT: one entry per user whose roles differ from the stored ones. */
export interface UserRolesChange {
  userId: number;
  roleIds: number[];
}

interface Status {
  text: string;
  error: boolean;
}

/** A message about one user's password, so it carries the row it has to be shown on. */
interface PasswordStatus extends Status {
  userId: number;
}

@Component({
  selector: 'app-user-list',
  imports: [HighlightPipe],
  templateUrl: './user-list.html',
  styleUrl: './user-list.css',
})
export class UserList {
  private http = inject(HttpClient);
  private session = inject(Session);

  filterTerm = input<string>('');

  users = signal<User[]>([]);
  allRoles = signal<Role[]>([]);
  loading = signal(false);
  editing = signal(false);
  saving = signal(false);
  /** Messages about the list as a whole: loading the roles, saving the roles. */
  status = signal<Status | null>(null);
  /** The result of a password change, shown next to the user it was made for. */
  passwordStatus = signal<PasswordStatus | null>(null);

  private usersBeforeEdit: User[] = [];

  /** The user whose password form is open, or null when none is. */
  passwordUserId = signal<number | null>(null);
  passwordSaving = signal(false);
  showNewPassword = signal(false);

  private newPasswordField = viewChild<ElementRef<HTMLInputElement>>('newPassword');

  /** Every row's trigger. Only the closed rows render one, which is why this is not a viewChild. */
  private changePasswordButtons = viewChildren<ElementRef<HTMLButtonElement>>('changePasswordButton');

  /**
   * Set when a form closes, cleared once focus has been handed back to that row's trigger. It has
   * to outlive a single effect run: the effect fires before the view is updated, so on the run
   * that notices the close the trigger is not on the page yet — only a later run, triggered by the
   * query itself, can see it.
   */
  private pendingFocusUserId: number | null = null;

  constructor() {
    effect(() => {
      const openFor = this.passwordUserId();
      const editing = this.editing();
      const field = this.newPasswordField();
      const buttons = this.changePasswordButtons();

      if (openFor !== null) {
        // Focus lands on the field the admin opened the form for, instead of making them tab onwards.
        this.pendingFocusUserId = null;
        field?.nativeElement.focus();
        return;
      }

      const pending = this.pendingFocusUserId;
      if (pending === null) return;

      if (editing) {
        // The roles editor replaced the whole list, so there is no trigger to go back to.
        this.pendingFocusUserId = null;
        return;
      }

      const trigger = buttons.find(
        candidate => candidate.nativeElement.id === `change-password-${pending}`
      );
      if (trigger) {
        trigger.nativeElement.focus();
        this.pendingFocusUserId = null;
      }
    });
  }

  filteredUsers = computed(() => {
    const term = this.filterTerm().toLowerCase().trim();
    if (!term) return this.users();

    return this.users().filter(user => {
      const matchesName = user.name.toLowerCase().includes(term);
      const matchesRole = user.roles.some(role =>
        role.name.toLowerCase().includes(term) ||
        role.description.toLowerCase().includes(term)
      );
      return matchesName || matchesRole;
    })
  });

  /** True once the server has confirmed the visitor is an admin; false while it is unknown too. */
  isAdmin = computed(() => this.session.isAdmin() === true);

  /**
   * True once the server has said the visitor is not an admin, which is the one case where the user
   * list is not theirs to read and their own row takes its place.
   */
  selfOnly = computed(() => this.session.isAdmin() === false);

  /**
   * The signed-in user as a row of their own, or null until the server has said who they are. Their
   * roles come along so the row can show what they have access to — read-only, since editing them
   * is what makes someone an admin.
   */
  private selfUser = computed<User | null>(() => {
    const name = this.session.name();
    return name === null ? null : { id: SELF_ROW_ID, name, roles: this.session.roles() };
  });

  /** What the list shows: every user an admin may see, or only the visitor's own row. */
  visibleUsers = computed<User[]>(() => {
    if (!this.selfOnly()) return this.filteredUsers();
    const self = this.selfUser();
    return self ? [self] : [];
  });

  /** The roles the user does not have yet, used to fill the "add role" dropdown. */
  availableRolesFor(user: User): Role[] {
    return this.allRoles().filter(role => !user.roles.some(assigned => assigned.id === role.id));
  }

  ngOnInit() {
    this.session.load().subscribe(account => {
      if (account?.isAdmin) {
        this.fetchUsers();
      } else if (account === null) {
        // With no answer from /me there is nothing to decide on, so fall back to what the app did
        // before it existed: ask for the list, which answers 403 for a non-admin.
        this.status.set({
          text: 'Could not read your account; showing the user list.',
          error: true
        });
        this.fetchUsers();
      }
      // a non-admin gets no list of other users: their own row carries the password form instead
    });
  }

  fetchUsers() {
    this.loading.set(true);
    this.http.get<User[]>('/organizator/user-roles', {
      withCredentials: true // Automatically sends stored JWT cookie
    }).subscribe({
      next: (data) => {
        this.users.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Failed to load users (Unauthorized):', err);
        this.loading.set(false);
      }
    });
  }

  fetchRoles() {
    this.http.get<Role[]>('/organizator/roles', {
      withCredentials: true // Automatically sends stored JWT cookie
    }).subscribe({
      next: (data) => this.allRoles.set(data),
      error: (err) => {
        console.error('Failed to load roles (Unauthorized):', err);
        this.status.set({ text: 'Failed to load the list of roles.', error: true });
      }
    });
  }

  startEditing() {
    this.usersBeforeEdit = structuredClone(this.users());
    this.status.set(null);
    this.editing.set(true);
    this.closePasswordForm();
    this.passwordStatus.set(null); // the editor replaces the row the message was shown on
    this.fetchRoles();
  }

  cancelEditing() {
    this.users.set(this.usersBeforeEdit);
    this.status.set(null);
    this.editing.set(false);
  }

  addRole(user: User, select: HTMLSelectElement) {
    const role = this.allRoles().find(role => role.id === Number(select.value));
    if (!role) return;

    this.updateRoles(user.id, roles => [...roles, role]);
  }

  removeRole(user: User, role: Role) {
    this.updateRoles(user.id, roles => roles.filter(item => item.id !== role.id));
  }

  openPasswordForm(user: User) {
    this.showNewPassword.set(false); // never open on cleartext left over from another user
    this.passwordUserId.set(user.id);
    this.passwordStatus.set(null); // the last result gives way to the attempt being made now
  }

  /**
   * Closes the form and clears whatever was typed. The fields are read straight from the DOM at
   * submit time, so this is the only place that empties them — pass the inputs when they are
   * already gone from the DOM (closing because editing started) and nothing needs clearing.
   */
  closePasswordForm(newPasswordField?: HTMLInputElement, currentPasswordField?: HTMLInputElement) {
    if (newPasswordField) newPasswordField.value = '';
    if (currentPasswordField) currentPasswordField.value = '';
    this.showNewPassword.set(false);

    const closed = this.passwordUserId();
    this.passwordUserId.set(null);
    if (closed !== null) this.pendingFocusUserId = closed; // the effect hands focus back to its trigger
  }

  toggleNewPassword() {
    this.showNewPassword.update(show => !show);
  }

  submitPassword(
    user: User,
    newPasswordField: HTMLInputElement,
    currentPasswordField: HTMLInputElement,
    event: Event
  ) {
    // A plain (submit) binding does not stop the native submission, which would send both
    // passwords to the URL as a GET.
    event.preventDefault();

    if (this.passwordSaving()) return;

    const newPassword = newPasswordField.value;
    const currentPassword = currentPasswordField.value;

    if (!newPassword || !currentPassword) {
      this.passwordStatus.set({
        userId: user.id,
        text: 'Enter the new password and your own password.',
        error: true
      });
      return;
    }

    // HttpParams is what makes Angular send this as application/x-www-form-urlencoded and escape
    // the secrets, so a password containing & = + % survives the round trip.
    const body = new HttpParams()
      .set('username', user.name)
      .set('old_password', currentPassword)
      .set('new_password', newPassword);

    this.passwordSaving.set(true);
    this.passwordStatus.set(null);

    this.http.post('/organizator/password', body, {
      withCredentials: true, // Automatically sends stored JWT cookie
      responseType: 'text', // the endpoint answers with an empty body
    }).subscribe({
      next: () => {
        this.passwordSaving.set(false);
        this.closePasswordForm(newPasswordField, currentPasswordField);
        this.passwordStatus.set({
          userId: user.id,
          text: `Password changed for ${user.name}.`,
          error: false
        });
      },
      error: (err: HttpErrorResponse) => {
        this.passwordSaving.set(false);
        console.error('Failed to change the password:', err.status); // never the error itself
        currentPasswordField.value = ''; // the admin's own password is not kept around

        // 400 is the admin's own password being wrong, kept apart from 401 so that a 401 can go on
        // meaning "the session is gone" and be handled by the interceptor like everywhere else.
        if (err.status === 400) {
          this.passwordStatus.set({
            userId: user.id,
            text: 'Your own password is incorrect.',
            error: true
          });
        } else if (err.status === 403) {
          this.passwordStatus.set({
            userId: user.id,
            text: `You are not allowed to change the password for ${user.name}.`,
            error: true
          });
        } else if (err.status === 422) {
          // The backend refuses the new password itself here and names the rule it broke, which is
          // more use to the admin than a generic failure — and adds no rule for the UI to keep up
          // with when the server gains another one.
          this.passwordStatus.set({
            userId: user.id,
            text: this.refusedPasswordReason(err),
            error: true
          });
        } else {
          this.passwordStatus.set({
            userId: user.id,
            text: 'Failed to change the password.',
            error: true
          });
        }
      }
    });
  }

  save() {
    const changed = this.changedUsers();

    if (changed.length === 0) {
      this.editing.set(false);
      this.status.set({ text: 'No changes to save.', error: false });
      return;
    }

    this.saving.set(true);
    this.status.set(null);

    this.http.put('/organizator/user-roles', changed, {
      withCredentials: true // Automatically sends stored JWT cookie
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.editing.set(false);
        this.status.set({
          text: `Saved roles for ${changed.length} user${changed.length === 1 ? '' : 's'}.`,
          error: false
        });
        this.fetchUsers(); // reload, so the list shows what the server actually stored
      },
      error: (err) => {
        console.error('Failed to save roles:', err);
        this.saving.set(false);
        this.status.set({ text: 'Failed to save the roles.', error: true });
      }
    });
  }

  /** Only the users touched while editing, not the users the filter hides or nobody changed. */
  private changedUsers(): UserRolesChange[] {
    const before = new Map(this.usersBeforeEdit.map(user => [user.id, roleIds(user)]));

    return this.users()
      .map(user => ({ userId: user.id, roleIds: roleIds(user) }))
      .filter(change => before.get(change.userId)?.join() !== change.roleIds.join());
  }

  private updateRoles(userId: number, change: (roles: Role[]) => Role[]) {
    this.users.update(users =>
      users.map(user => user.id === userId ? { ...user, roles: change(user.roles) } : user)
    );
  }

  /**
   * The backend's own words for refusing the new password. It answers 422 with the reason as plain
   * text — the request asked for a text response, so that is what the error body holds — and the
   * empty body a proxy or an older server might leave behind still has to say something.
   */
  private refusedPasswordReason(response: HttpErrorResponse): string {
    const reason = response.error;
    return typeof reason === 'string' && reason.trim() !== ''
      ? reason.trim()
      : 'Failed to change the password.';
  }
}

/** The role ids of a user, sorted so that comparison and payload do not depend on edit order. */
function roleIds(user: User): number[] {
  return user.roles.map(role => role.id).sort((a, b) => a - b);
}
