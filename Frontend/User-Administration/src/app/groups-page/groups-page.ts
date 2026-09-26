import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  GroupsApi,
  MemoGroup,
  PanelStatus,
  UserGroup,
  UserGroupsPerUser,
  groupChangeFailed,
} from '../groups-api';
import { Session } from '../session';
import { UserGroups } from './user-groups/user-groups';
import { MemoGroups } from './memo-groups/memo-groups';
import { AllUserGroups } from './all-user-groups/all-user-groups';

/**
 * The screen behind the Groups menu entry: the user groups you own and the memo groups you
 * can see, and for an admin the report of everyone's groups as well.
 *
 * This component holds the state and makes the calls; the three panels below it render it
 * and say what the visitor asked for. Loading is split per panel, so one failing request
 * does not blank the other two.
 */
@Component({
  selector: 'app-groups-page',
  imports: [UserGroups, MemoGroups, AllUserGroups],
  templateUrl: './groups-page.html',
  styleUrl: './groups-page.css',
})
export class GroupsPage implements OnInit {
  private api = inject(GroupsApi);
  private session = inject(Session);

  userGroups = signal<UserGroup[]>([]);
  memoGroups = signal<MemoGroup[]>([]);
  allUserGroups = signal<UserGroupsPerUser[]>([]);
  /** Suggested values for the member field, and only for an admin — see GroupsApi.usernames. */
  usernames = signal<string[]>([]);
  /**
   * Who the visitor is, as `/memogroups` reports them. Used only to tell a memo group they own
   * from a public one they merely see; null until that read answers.
   */
  memoRequesterId = signal<number | null>(null);

  loadingUserGroups = signal(false);
  loadingMemoGroups = signal(false);
  loadingAllGroups = signal(false);

  savingUserGroups = signal(false);
  savingMemoGroups = signal(false);

  userGroupStatus = signal<PanelStatus | null>(null);
  memoGroupStatus = signal<PanelStatus | null>(null);
  allGroupsStatus = signal<PanelStatus | null>(null);

  isAdmin = computed(() => this.session.isAdmin() === true);

  ngOnInit() {
    this.loadUserGroups();
    this.loadMemoGroups();

    // The account decides whether there is a report to show. It is the same request the
    // user list makes, shared through the service, so this costs nothing extra.
    this.session.load().subscribe(account => {
      if (account?.isAdmin) {
        this.loadAllUserGroups();
        this.loadUsernames();
      }
    });
  }

  loadUserGroups() {
    this.loadingUserGroups.set(true);
    this.userGroupStatus.set(null);
    this.api.userGroups().subscribe({
      next: response => {
        this.userGroups.set(response.usergroups);
        this.loadingUserGroups.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loadingUserGroups.set(false);
        console.error('Failed to load the user groups:', err.status);
        this.userGroupStatus.set({
          id: null,
          text: 'Failed to load your user groups.',
          error: true,
        });
      },
    });
  }

  loadMemoGroups() {
    this.loadingMemoGroups.set(true);
    this.memoGroupStatus.set(null);
    this.api.memoGroups().subscribe({
      next: response => {
        this.memoGroups.set(response.memogroups);
        this.memoRequesterId.set(response.requester.id);
        this.loadingMemoGroups.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loadingMemoGroups.set(false);
        console.error('Failed to load the memo groups:', err.status);
        this.memoGroupStatus.set({
          id: null,
          text: 'Failed to load your memo groups.',
          error: true,
        });
      },
    });
  }

  private loadAllUserGroups() {
    this.loadingAllGroups.set(true);
    this.allGroupsStatus.set(null);
    this.api.allUserGroups().subscribe({
      next: owners => {
        this.allUserGroups.set(owners);
        this.loadingAllGroups.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loadingAllGroups.set(false);
        console.error('Failed to load all user groups:', err.status);
        this.allGroupsStatus.set({
          id: null,
          text: 'Failed to load the report of all user groups.',
          error: true,
        });
      },
    });
  }

  private loadUsernames() {
    this.api.usernames().subscribe(names => this.usernames.set(names));
  }

  // ---- user groups ----------------------------------------------------------------

  createUserGroup(name: string) {
    // No row to hang a failure on yet, so this one speaks for the panel.
    this.changeUserGroup(this.api.createUserGroup(name), about(null, 'the user groups'), group => {
      this.userGroups.update(groups => [...groups, group]);
      return `Created ${group.name}. Add its members below.`;
    });
  }

  renameUserGroup(group: UserGroup, name: string) {
    this.changeUserGroup(
      this.api.renameUserGroup(group.id, name),
      about(group, 'the group'),
      renamed => {
        this.userGroups.update(groups => replace(groups, renamed));
        return `Renamed to ${renamed.name}.`;
      }
    );
  }

  addMember(group: UserGroup, username: string) {
    this.changeUserGroup(this.api.addMember(group.id, username), about(group, 'the group'), updated => {
      this.userGroups.update(groups => replace(groups, updated));
      return `Added ${username} to ${updated.name}.`;
    });
  }

  removeMember(group: UserGroup, username: string) {
    this.changeUserGroup(
      this.api.removeMember(group.id, username),
      about(group, 'the group'),
      updated => {
        this.userGroups.update(groups => replace(groups, updated));
        return `Removed ${username} from ${updated.name}.`;
      }
    );
  }

  deleteUserGroup(group: UserGroup) {
    this.userGroupStatus.set(null);
    this.savingUserGroups.set(true);
    this.api.deleteUserGroup(group.id).subscribe({
      next: () => {
        this.userGroups.update(groups => groups.filter(item => item.id !== group.id));
        this.savingUserGroups.set(false);
        // Nothing is left to hang the message on, so it goes on the panel.
        this.userGroupStatus.set({ id: null, text: `Deleted ${group.name}.`, error: false });
        // Every memo group that granted this user group access has just lost it, and the
        // memo panel has no other way to hear about it.
        this.loadMemoGroups();
        this.refreshAllUserGroups();
      },
      error: (err: HttpErrorResponse) =>
        this.userGroupFailed(err, group.id, `the group ${group.name}`),
    });
  }

  // ---- memo groups ----------------------------------------------------------------

  createMemoGroup(newGroup: { name: string; public: boolean }) {
    this.changeMemoGroup(
      this.api.createMemoGroup(newGroup.name, newGroup.public),
      about(null, 'the memo groups'),
      group => {
        this.memoGroups.update(groups => [...groups, group]);
        const shared = group.public ? ', visible to everyone' : '';
        return `Created ${group.name}${shared}. Grant a user group access below.`;
      }
    );
  }

  setMemoGroupPublic(group: MemoGroup, isPublic: boolean) {
    this.changeMemoGroup(
      this.api.setMemoGroupPublic(group.id, isPublic),
      about(group, 'the memo group'),
      updated => {
        this.memoGroups.update(groups => replace(groups, updated));
        // What came back if the server said, and otherwise what was asked for.
        return (updated.public ?? isPublic)
          ? `${updated.name} is now visible to everyone.`
          : `${updated.name} is no longer public.`;
      }
    );
  }

  renameMemoGroup(group: MemoGroup, name: string) {
    this.changeMemoGroup(
      this.api.renameMemoGroup(group.id, name),
      about(group, 'the memo group'),
      renamed => {
        this.memoGroups.update(groups => replace(groups, renamed));
        return `Renamed to ${renamed.name}.`;
      }
    );
  }

  grantAccess(group: MemoGroup, userGroupId: number, access: number) {
    this.changeMemoGroup(
      this.api.grantAccess(group.id, userGroupId, access),
      about(group, 'the memo group'),
      updated => {
        this.memoGroups.update(groups => replace(groups, updated));
        return `Set the access level on ${updated.name}.`;
      }
    );
  }

  revokeAccess(group: MemoGroup, userGroup: { id: number; name: string }) {
    this.changeMemoGroup(
      this.api.revokeAccess(group.id, userGroup.id),
      about(group, 'the memo group'),
      updated => {
        this.memoGroups.update(groups => replace(groups, updated));
        return `Revoked ${userGroup.name} on ${updated.name}.`;
      }
    );
  }

  deleteMemoGroup(group: MemoGroup) {
    this.memoGroupStatus.set(null);
    this.savingMemoGroups.set(true);
    this.api.deleteMemoGroup(group.id).subscribe({
      next: () => {
        this.memoGroups.update(groups => groups.filter(item => item.id !== group.id));
        this.savingMemoGroups.set(false);
        this.memoGroupStatus.set({ id: null, text: `Deleted ${group.name}.`, error: false });
        // No report refresh here: it lists user groups, and a memo group is not one.
      },
      error: (err: HttpErrorResponse) =>
        this.memoGroupFailed(err, group.id, `the memo group ${group.name}`),
    });
  }

  // ---- shared plumbing ------------------------------------------------------------

  /**
   * Runs one change and puts its result on the row it was about. `apply` folds the group the
   * server sent back into the list and returns the message to show; it runs only on a
   * response, so a failure leaves the list exactly as it was.
   */
  private changeUserGroup(
    request: Observable<UserGroup>,
    about: Failure,
    apply: (group: UserGroup) => string
  ) {
    this.userGroupStatus.set(null);
    this.savingUserGroups.set(true);
    request.subscribe({
      next: group => {
        this.savingUserGroups.set(false);
        this.userGroupStatus.set({ id: group.id, text: apply(group), error: false });
        this.refreshAllUserGroups();
      },
      error: (err: HttpErrorResponse) => this.userGroupFailed(err, about.id, about.what),
    });
  }

  private changeMemoGroup(
    request: Observable<MemoGroup>,
    about: Failure,
    apply: (group: MemoGroup) => string
  ) {
    this.memoGroupStatus.set(null);
    this.savingMemoGroups.set(true);
    request.subscribe({
      next: group => {
        this.savingMemoGroups.set(false);
        this.memoGroupStatus.set({ id: group.id, text: apply(group), error: false });
      },
      error: (err: HttpErrorResponse) => this.memoGroupFailed(err, about.id, about.what),
    });
  }

  /**
   * Re-reads the admin report, which lists every owner's groups and so is stale after any
   * change to one of them. Does nothing for a non-admin, who has no report to refresh.
   */
  private refreshAllUserGroups() {
    if (this.isAdmin()) this.loadAllUserGroups();
  }

  private userGroupFailed(err: HttpErrorResponse, id: number | null, what: string) {
    this.savingUserGroups.set(false);
    console.error('Failed to change the user groups:', err.status); // never the body itself
    this.userGroupStatus.set({ id, text: groupChangeFailed(err, what), error: true });
  }

  private memoGroupFailed(err: HttpErrorResponse, id: number | null, what: string) {
    this.savingMemoGroups.set(false);
    console.error('Failed to change the memo groups:', err.status);
    this.memoGroupStatus.set({ id, text: groupChangeFailed(err, what), error: true });
  }
}

/** The list with one group swapped for the version the server just returned. */
function replace<T extends { id: number }>(groups: T[], updated: T): T[] {
  return groups.map(group => (group.id === updated.id ? updated : group));
}

/** Where a failed change is reported, and what to call the thing it was about. */
interface Failure {
  id: number | null;
  what: string;
}

/**
 * Names the subject of a failure for the sentence the visitor reads. A change to one group
 * says which, so the message can sit on its row; a create has no row yet and speaks for the
 * panel, so `kind` is the plural it should use.
 */
function about(group: { id: number; name: string } | null, kind: string): Failure {
  return group === null ? { id: null, what: kind } : { id: group.id, what: `${kind} ${group.name}` };
}
