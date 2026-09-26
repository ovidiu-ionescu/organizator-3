import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';

/** A user as the group endpoints name one. `name` is the username, which is what they key on. */
export interface GroupMember {
  id: number;
  name: string;
}

/** A group of users. An empty `users` is a group still waiting for its first member. */
export interface UserGroup {
  id: number;
  name: string;
  users: GroupMember[];
}

/** A user group granted an access level on a memo group. */
export interface MemoGroupAccess {
  id: number;
  name: string;
  access: number;
  users: GroupMember[];
}

export interface MemoGroup {
  id: number;
  name: string;
  usergroups: MemoGroupAccess[];
  /**
   * Whether every user can see this memo group, not just its owner. Only an admin may set it.
   * Not sent yet — `undefined` means the server did not say, which the screen treats as "not
   * known", rather than as private, so it does not offer a control for a state it cannot read.
   */
  public?: boolean;
  /**
   * Who the memo group belongs to. Not sent yet — when it is absent the owner is unknown and
   * the screen lets the attempt through rather than hiding a control it cannot justify. It
   * matters because the default `<user> RO` / `<user> RW` groups are owned by the admin and
   * are public, so a user sees memo groups they may not rename or delete.
   */
  owner?: GroupMember;
}

export interface UserGroupsResponse {
  usergroups: UserGroup[];
  requester: GroupMember;
}

export interface MemoGroupsResponse {
  memogroups: MemoGroup[];
  requester: GroupMember;
}

/**
 * What the reads actually put on the wire. `json_agg` over no rows is SQL NULL, so an empty
 * list arrives as `null` and not `[]` — the same for the members inside a group. The
 * service coalesces both, so nothing downstream has to know.
 */
interface UserGroupsWire {
  usergroups: UserGroup[] | null;
  requester: GroupMember;
}

interface MemoGroupsWire {
  memogroups: MemoGroup[] | null;
  requester: GroupMember;
}

/** One owner and the groups they own, as the admin report groups them. */
export interface UserGroupsPerUser {
  owner: GroupMember;
  groups: UserGroup[];
}

/**
 * A message a panel shows about one group, or about the panel as a whole when `id` is null
 * — the same split the user list makes between its toolbar status and its per-row password
 * status. It lives here rather than beside the page so the panels that render it do not
 * have to import the component that owns them.
 */
export interface PanelStatus {
  id: number | null;
  text: string;
  error: boolean;
}

/**
 * The levels this screen can grant. There is no 0 here on purpose: no access at all is the
 * absence of a memo_acl row, which revoking expresses, so there is nothing to pick.
 *
 * These mirror the backend's READ_ONLY_ACCESS / READ_WRITE_ACCESS constants, and the
 * letters are the ones the Memo app prints for the same numbers, so the two frontends
 * describe an access level the same way.
 */
export const ACCESS_LEVELS = [
  { value: 1, label: 'Read', short: 'R' },
  { value: 2, label: 'Read and write', short: 'W' },
] as const;

/**
 * The one-letter form of an access level, for the badge beside it. A level this build does
 * not know about — the backend gaining one — still renders as its number rather than as a
 * letter that would be wrong or a blank that would say nothing.
 */
export function accessShort(access: number): string {
  const known = ACCESS_LEVELS.find(level => level.value === access)?.short;
  if (known !== undefined) return known;

  // memo_acl.access is a nullable column (DDL/memo_acl.sql), so a grant with no level is
  // possible and must not render as the word "null".
  return Number.isFinite(access) ? String(access) : '?';
}

/**
 * The group endpoints.
 *
 * The reads exist; the writes do not exist on the server yet — this app defines them, and
 * they answer 404 or 405 until the backend is built to match `docs/api.md`. Every write
 * returns the group as it now stands, so a caller can replace its copy instead of guessing.
 */
@Injectable({
  providedIn: 'root',
})
export class GroupsApi {
  private http = inject(HttpClient);

  // Automatically sends the stored JWT cookie, like every other call in the app.
  private readonly options = { withCredentials: true } as const;

  userGroups(): Observable<UserGroupsResponse> {
    return this.http
      .get<UserGroupsWire>('/organizator/usergroups', this.options)
      .pipe(
        map(wire => ({
          usergroups: normalizeGroups(wire.usergroups),
          requester: wire.requester,
        }))
      );
  }

  memoGroups(): Observable<MemoGroupsResponse> {
    return this.http
      .get<MemoGroupsWire>('/organizator/memogroups', this.options)
      .pipe(
        map(wire => ({
          memogroups: normalizeMemoGroups(wire.memogroups),
          requester: wire.requester,
        }))
      );
  }

  /**
   * Every owner and the groups they own. An empty result used to arrive as `null` rather than
   * `[]` — json_agg over no rows — which is now coalesced in the SQL; it is absorbed here too,
   * so a server without that fix still reads as an empty report rather than a broken screen.
   */
  allUserGroups(): Observable<UserGroupsPerUser[]> {
    return this.http
      .get<UserGroupsPerUser[] | null>('/organizator/admin/all_user_groups', this.options)
      .pipe(
        // The groups inside are normalized like everywhere else: the report renders their
        // member lists, and they are built by the same aggregate that answers `null`.
        map(owners =>
          (owners ?? []).map(owner => ({ ...owner, groups: normalizeGroups(owner.groups) }))
        )
      );
  }

  /**
   * The usernames an admin may add to a group, only ever used to suggest values in the
   * member field. `/user-roles` is the one endpoint that lists users and it is admin-only,
   * so this is a convenience an admin may fail to get — the field still takes a typed name.
   */
  usernames(): Observable<string[]> {
    return this.http.get<{ name: string }[]>('/organizator/user-roles', this.options).pipe(
      map(users => users.map(user => user.name)),
      catchError(() => of([]))
    );
  }

  createUserGroup(name: string): Observable<UserGroup> {
    return this.userGroupWrite(
      this.http.post<UserGroup>('/organizator/usergroups', { name }, this.options)
    );
  }

  renameUserGroup(id: number, name: string): Observable<UserGroup> {
    return this.userGroupWrite(
      this.http.put<UserGroup>(`/organizator/usergroups/${id}`, { name }, this.options)
    );
  }

  deleteUserGroup(id: number): Observable<void> {
    return this.http.delete<void>(`/organizator/usergroups/${id}`, this.options);
  }

  addMember(groupId: number, username: string): Observable<UserGroup> {
    return this.userGroupWrite(
      this.http.post<UserGroup>(
        `/organizator/usergroups/${groupId}/members`,
        { username },
        this.options
      )
    );
  }

  removeMember(groupId: number, username: string): Observable<UserGroup> {
    return this.userGroupWrite(
      this.http.delete<UserGroup>(
        `/organizator/usergroups/${groupId}/members/${encodeURIComponent(username)}`,
        this.options
      )
    );
  }

  /** `isPublic` is only honoured for an admin; anyone else gets a group of their own. */
  createMemoGroup(name: string, isPublic: boolean): Observable<MemoGroup> {
    return this.memoGroupWrite(
      this.http.post<MemoGroup>('/organizator/memogroups', { name, public: isPublic }, this.options)
    );
  }

  /** Makes a memo group visible to everyone, or stops it being. Admin only. */
  setMemoGroupPublic(id: number, isPublic: boolean): Observable<MemoGroup> {
    return this.memoGroupWrite(
      this.http.put<MemoGroup>(
        `/organizator/memogroups/${id}/public`,
        { public: isPublic },
        this.options
      )
    );
  }

  renameMemoGroup(id: number, name: string): Observable<MemoGroup> {
    return this.memoGroupWrite(
      this.http.put<MemoGroup>(`/organizator/memogroups/${id}`, { name }, this.options)
    );
  }

  deleteMemoGroup(id: number): Observable<void> {
    return this.http.delete<void>(`/organizator/memogroups/${id}`, this.options);
  }

  /** Granting and re-granting are the same call: the access level is upserted. */
  grantAccess(memoGroupId: number, userGroupId: number, access: number): Observable<MemoGroup> {
    return this.memoGroupWrite(
      this.http.put<MemoGroup>(accessPath(memoGroupId, userGroupId), { access }, this.options)
    );
  }

  revokeAccess(memoGroupId: number, userGroupId: number): Observable<MemoGroup> {
    return this.memoGroupWrite(
      this.http.delete<MemoGroup>(accessPath(memoGroupId, userGroupId), this.options)
    );
  }

  /**
   * The writes are normalized like the reads, because the same server code builds both
   * responses and the same empty list has the same way of arriving as `null`.
   */
  private userGroupWrite(source: Observable<UserGroup>): Observable<UserGroup> {
    return source.pipe(map(normalizeGroup));
  }

  private memoGroupWrite(source: Observable<MemoGroup>): Observable<MemoGroup> {
    return source.pipe(map(normalizeMemoGroup));
  }
}

/** The path of one access grant, so the two calls that share it cannot drift apart. */
function accessPath(memoGroupId: number, userGroupId: number): string {
  return `/organizator/memogroups/${memoGroupId}/usergroups/${userGroupId}`;
}

/**
 * A list the server sent as `null`, which is how it says "none" — its aggregates are
 * `json_agg` over no rows. Each group's members are normalized the same way.
 */
function normalizeGroups(groups: UserGroup[] | null): UserGroup[] {
  return (groups ?? []).map(normalizeGroup);
}

function normalizeMemoGroups(groups: MemoGroup[] | null): MemoGroup[] {
  return (groups ?? []).map(normalizeMemoGroup);
}

function normalizeGroup(group: UserGroup): UserGroup {
  return { ...group, users: group.users ?? [] };
}

function normalizeMemoGroup(group: MemoGroup): MemoGroup {
  return {
    ...group,
    // Option<GroupMember> on the server serializes to null rather than to a missing key, so
    // "no owner" arrives as one of two shapes and only one of them is what the type says.
    owner: group.owner ?? undefined,
    // memo_group.public is a nullable column (DDL/memo_group.sql) and nothing has to have
    // written it, so a null means "not known", exactly like a missing value — and the screen
    // hides the visibility control for both rather than showing one that cannot be trusted.
    public: group.public ?? undefined,
    // The grants' member lists are coalesced too: they are built by the same aggregate, so a
    // grant on a memberless group is where a null list is most likely to turn up.
    usergroups: (group.usergroups ?? []).map(grant => ({ ...grant, users: grant.users ?? [] })),
  };
}

/**
 * What to tell the visitor about a change that failed.
 *
 * 404 and 405 are called out by name because they are the expected answer for every write
 * here *until the backend implements them*: that has to read as "not built yet" rather than
 * as a fault in the app. `docs/api.md` gives 404 a second meaning once they exist — "no such
 * group, or not yours" — so this branch will need revisiting then, and the two meanings want
 * telling apart before the write endpoints ship rather than after.
 */
export function groupChangeFailed(err: HttpErrorResponse, what: string): string {
  // A refusal the database made on the caller's behalf carries only "Data access forbidden",
  // which names nothing, so the app's own wording is more use here than the server's.
  if (err.status === 403) return `You are not allowed to change ${what}.`;

  // Otherwise the server's own words come first. Now that some of these calls exist, a 404 is
  // as likely to be a real answer — "no such group" — as a path nothing is listening on, and
  // the difference is exactly whether the body has something to say.
  const reason = serverReason(err);
  if (reason !== null) return `Could not change ${what}: ${reason}`;

  // Nothing said. A 404 with no body is axum's fallback for a path no handler is registered
  // on, and a 405 is a path that exists without that method: both mean "not built yet".
  if (err.status === 404 || err.status === 405) {
    return `The server does not support changing ${what} yet (it answered ${err.status}).`;
  }
  if (err.status === 0) {
    return `The server could not be reached, so ${what} was not changed.`;
  }
  // Not "the name is taken": the body says which state refused, and there was none to read.
  if (err.status === 409) return `Something else changed first, so ${what} was not changed.`;
  return `Failed to change ${what}.`;
}

/**
 * The reason the server gave, if it gave one. It answers with either `{"error": "..."}` or a
 * bare string depending on which layer refused, so both are read; anything else — an HTML
 * page from a proxy, a body that is not text, an empty one — is not a reason and is left to
 * the caller's own wording rather than shown to the visitor.
 */
function serverReason(err: HttpErrorResponse): string | null {
  const body: unknown = err.error;

  const reason =
    typeof body === 'string'
      ? body
      : body !== null && typeof body === 'object' && 'error' in body
        ? (body as { error: unknown }).error
        : null;

  if (typeof reason !== 'string') return null;

  const trimmed = reason.trim();
  return trimmed === '' || trimmed.includes('<') ? null : trimmed;
}
