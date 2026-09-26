import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Observable } from 'rxjs';

import { GroupsApi, groupChangeFailed } from './groups-api';

/**
 * The contract this app expects the server to honour, written down as requests. Half of it is
 * not implemented on the server yet, which is exactly why it is pinned here: when the backend
 * is built to match docs/api.md, these are the calls it has to answer.
 */
describe('GroupsApi', () => {
  let api: GroupsApi;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    api = TestBed.inject(GroupsApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  /** Runs a call, answers it, and hands back both the request and what the caller received. */
  function call<O>(source: Observable<O>, response: object) {
    let received: O | undefined;
    source.subscribe(value => (received = value));

    const request = httpMock.expectOne(() => true);
    request.flush(response);
    return { request, received };
  }

  it('sends the cookies with every call', () => {
    api.userGroups().subscribe();
    const request = httpMock.expectOne({ url: '/organizator/usergroups', method: 'GET' });
    expect(request.request.withCredentials).toBe(true);
    request.flush({ usergroups: [], requester: { id: 1, name: 'ovidiu' } });
  });

  describe('reads', () => {
    it('turns a null user-group list into an empty one', () => {
      // json_agg over no rows is SQL NULL, so "none" arrives as null rather than [].
      const { received } = call(api.userGroups(), {
        usergroups: null,
        requester: { id: 1, name: 'ovidiu' },
      });

      expect(received?.usergroups).toEqual([]);
    });

    it('turns a null member list into an empty one, so a new group renders', () => {
      const { received } = call(api.userGroups(), {
        usergroups: [{ id: 25, name: 'Family', users: null }],
        requester: { id: 1, name: 'ovidiu' },
      });

      expect(received?.usergroups).toEqual([{ id: 25, name: 'Family', users: [] }]);
    });

    it('turns a null memo-group list, and a null grant list, into empty ones', () => {
      const { received } = call(api.memoGroups(), {
        memogroups: [{ id: 37, name: 'ovidiu RO', usergroups: null }],
        requester: { id: 1, name: 'ovidiu' },
      });

      expect(received?.memogroups[0].usergroups).toEqual([]);
    });

    it('normalizes every list inside the admin report, not just the outer one', () => {
      const { received } = call(api.allUserGroups(), [
        {
          owner: { id: 1, name: 'ovidiu' },
          groups: [{ id: 25, name: 'Family', users: null }],
        },
      ]);

      // The report renders each group's members, so a null that survived here would throw
      // during rendering rather than degrade.
      expect(received?.[0].groups).toEqual([{ id: 25, name: 'Family', users: [] }]);
    });

    it('turns a null admin report into an empty one', () => {
      let received: unknown;
      api.allUserGroups().subscribe(owners => (received = owners));

      // The endpoint can answer the literal null, and the empty report is not a failure.
      httpMock
        .expectOne({ url: '/organizator/admin/all_user_groups', method: 'GET' })
        .flush(null);

      expect(received).toEqual([]);
    });

    it('normalizes the member list inside a grant, which is the likeliest one to be null', () => {
      // A grant on a group with no members is exactly where the aggregate yields null.
      const { received } = call(api.memoGroups(), {
        memogroups: [
          {
            id: 37,
            name: 'ovidiu RO',
            usergroups: [{ id: 25, name: 'Family', access: 1, users: null }],
          },
        ],
        requester: { id: 1, name: 'ovidiu' },
      });

      expect(received?.memogroups[0].usergroups[0].users).toEqual([]);
    });

    it('reads an owner the server sent as an explicit null as no owner at all', () => {
      const { received } = call(api.memoGroups(), {
        memogroups: [{ id: 37, name: 'ovidiu RO', usergroups: [], owner: null }],
        requester: { id: 1, name: 'ovidiu' },
      });

      // Option<GroupMember> serializes to null, and the panel tests the owner for absence.
      expect(received?.memogroups[0].owner).toBeUndefined();
    });

    it('suggests usernames from the admin-only user list, and gives up quietly otherwise', () => {
      let suggested: string[] | undefined;
      api.usernames().subscribe(names => (suggested = names));

      httpMock
        .expectOne({ url: '/organizator/user-roles', method: 'GET' })
        .flush([
          { id: 1, name: 'admin' },
          { id: 2, name: 'ovidiu' },
        ]);

      expect(suggested).toEqual(['admin', 'ovidiu']);

      // A non-admin cannot read that endpoint, and that must not be an error the page shows:
      // the member field takes a typed name regardless.
      let afterFailure: string[] | undefined;
      api.usernames().subscribe(names => (afterFailure = names));
      httpMock
        .expectOne({ url: '/organizator/user-roles', method: 'GET' })
        .flush({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' });

      expect(afterFailure).toEqual([]);
    });
  });

  describe('writes', () => {
    it('creates a user group', () => {
      const { request } = call(api.createUserGroup('Family'), {
        id: 26,
        name: 'Family',
        users: [],
      });

      expect(request.request.method).toBe('POST');
      expect(request.request.url).toBe('/organizator/usergroups');
      expect(request.request.body).toEqual({ name: 'Family' });
    });

    it('renames a user group', () => {
      const { request } = call(api.renameUserGroup(25, 'Friends'), {
        id: 25,
        name: 'Friends',
        users: [],
      });

      expect(request.request.method).toBe('PUT');
      expect(request.request.url).toBe('/organizator/usergroups/25');
      expect(request.request.body).toEqual({ name: 'Friends' });
    });

    it('deletes a user group', () => {
      api.deleteUserGroup(25).subscribe();
      const request = httpMock.expectOne({ url: '/organizator/usergroups/25', method: 'DELETE' });
      expect(request.request.body).toBeNull();
      request.flush(null);
    });

    it('adds a member by username, which is the only identifier a non-admin has', () => {
      const { request } = call(api.addMember(25, 'ovidiu'), {
        id: 25,
        name: 'Family',
        users: [{ id: 1, name: 'ovidiu' }],
      });

      expect(request.request.method).toBe('POST');
      expect(request.request.url).toBe('/organizator/usergroups/25/members');
      expect(request.request.body).toEqual({ username: 'ovidiu' });
    });

    it('removes a member, escaping the name so it survives the path', () => {
      api.removeMember(25, 'a b/c').subscribe();
      const request = httpMock.expectOne({
        url: '/organizator/usergroups/25/members/a%20b%2Fc',
        method: 'DELETE',
      });
      request.flush({ id: 25, name: 'Family', users: [] });
    });

    it('creates a private memo group, which is what anyone but an admin gets', () => {
      const { request } = call(api.createMemoGroup('RO', false), {
        id: 39,
        name: 'RO',
        usergroups: [],
      });

      expect(request.request.method).toBe('POST');
      expect(request.request.url).toBe('/organizator/memogroups');
      expect(request.request.body).toEqual({ name: 'RO', public: false });
    });

    it('creates a public memo group, which only an admin may ask for', () => {
      const { request } = call(api.createMemoGroup('Everyone RO', true), {
        id: 40,
        name: 'Everyone RO',
        usergroups: [],
      });

      expect(request.request.body).toEqual({ name: 'Everyone RO', public: true });
    });

    it('publishes a memo group, and stops it being published, on its own path', () => {
      const { request } = call(api.setMemoGroupPublic(37, true), {
        id: 37,
        name: 'ovidiu RO',
        usergroups: [],
      });

      expect(request.request.method).toBe('PUT');
      expect(request.request.url).toBe('/organizator/memogroups/37/public');
      expect(request.request.body).toEqual({ public: true });

      const back = call(api.setMemoGroupPublic(37, false), {
        id: 37,
        name: 'ovidiu RO',
        usergroups: [],
      });
      expect(back.request.request.url).toBe('/organizator/memogroups/37/public');
      expect(back.request.request.body).toEqual({ public: false });
    });

    it('renames a memo group', () => {
      const { request } = call(api.renameMemoGroup(37, 'RW'), {
        id: 37,
        name: 'RW',
        usergroups: [],
      });

      expect(request.request.method).toBe('PUT');
      expect(request.request.url).toBe('/organizator/memogroups/37');
      expect(request.request.body).toEqual({ name: 'RW' });
    });

    it('deletes a memo group', () => {
      api.deleteMemoGroup(37).subscribe();
      const request = httpMock.expectOne({ url: '/organizator/memogroups/37', method: 'DELETE' });
      request.flush(null);
    });

    it('grants access with a PUT, so granting and re-granting are the same call', () => {
      const { request } = call(api.grantAccess(37, 25, 2), {
        id: 37,
        name: 'RO',
        usergroups: [],
      });

      expect(request.request.method).toBe('PUT');
      expect(request.request.url).toBe('/organizator/memogroups/37/usergroups/25');
      expect(request.request.body).toEqual({ access: 2 });
    });

    it('revokes access on the same path it granted it', () => {
      api.revokeAccess(37, 25).subscribe();
      const request = httpMock.expectOne({
        url: '/organizator/memogroups/37/usergroups/25',
        method: 'DELETE',
      });
      request.flush({ id: 37, name: 'RO', usergroups: [] });
    });
  });
});

/** What a failure says to the visitor, which is the only part of the error they ever see. */
describe('groupChangeFailed', () => {
  function failure(status: number, error: unknown) {
    return { status, error } as Parameters<typeof groupChangeFailed>[0];
  }

  it('says the endpoint is not built yet when a bare 404 or 405 comes back', () => {
    // axum's fallback for an unrouted path answers a 404 with an empty body, and that — not
    // the status on its own — is what says nothing is listening there.
    expect(groupChangeFailed(failure(404, null), 'the user groups')).toContain('does not support');
    expect(groupChangeFailed(failure(404, ''), 'the user groups')).toContain('does not support');
    expect(groupChangeFailed(failure(405, null), 'the user groups')).toContain('does not support');
  });

  it('reads a 404 that does carry a reason as the refusal it is, not as a missing endpoint', () => {
    // Adding a member answers 404 for a group that is not the caller's, so the status alone
    // no longer means "not built yet".
    expect(groupChangeFailed(failure(404, { error: 'No such user group' }), 'the group Family')).toBe(
      'Could not change the group Family: No such user group'
    );
  });

  it('prefers the server\'s own reason when it gives one', () => {
    expect(
      groupChangeFailed(failure(422, { error: 'No such user' }), 'the group Family')
    ).toBe('Could not change the group Family: No such user');

    expect(groupChangeFailed(failure(400, 'Name is too long'), 'the group Family')).toBe(
      'Could not change the group Family: Name is too long'
    );
  });

  it('never shows a proxy\'s HTML error page', () => {
    const message = groupChangeFailed(
      failure(502, '<html><body>Bad Gateway</body></html>'),
      'the group Family'
    );

    expect(message).not.toContain('<');
    expect(message).toBe('Failed to change the group Family.');
  });

  it('reads a body that is not there, and a status that never arrived', () => {
    expect(groupChangeFailed(failure(500, ''), 'the user groups')).toBe(
      'Failed to change the user groups.'
    );
    expect(groupChangeFailed(failure(0, null), 'the user groups')).toContain(
      'could not be reached'
    );
  });

  it('names the ownership rule for a refusal', () => {
    expect(groupChangeFailed(failure(403, null), 'the memo group RO')).toBe(
      'You are not allowed to change the memo group RO.'
    );
  });
});
