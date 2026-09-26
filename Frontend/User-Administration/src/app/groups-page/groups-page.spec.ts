import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { GroupsPage } from './groups-page';
import { MemoGroup, UserGroup, UserGroupsPerUser } from '../groups-api';

/** A group with nobody in it — the state a group is in between being created and being used. */
const EMPTY_GROUP: UserGroup = { id: 25, name: 'ovidiu (Individual)', users: [] };

const FAMILY: UserGroup = {
  id: 26,
  name: 'Family',
  users: [
    { id: 1, name: 'ovidiu' },
    { id: 7, name: 'maria' },
  ],
};

const RO: MemoGroup = { id: 37, name: 'ovidiu RO', usergroups: [] };

const RW: MemoGroup = {
  id: 38,
  name: 'ovidiu RW',
  usergroups: [
    { id: 25, name: 'ovidiu (Individual)', access: 2, users: [] },
    { id: 26, name: 'Family', access: 1, users: [] },
  ],
};

/**
 * The Groups screen, exercised through its panels as they are really rendered. Every write
 * here is one the server does not implement yet, so the last word on each is what the screen
 * says when the request comes back refused.
 */
describe('GroupsPage', () => {
  let fixture: ComponentFixture<GroupsPage>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupsPage],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupsPage);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  /** Answers the three reads the screen makes, and the admin's extra two when they apply. */
  function load(
    options: {
      admin?: boolean;
      /** Who the memo-group read says the visitor is, which is what ownership is judged against. */
      requesterId?: number;
      userGroups?: UserGroup[] | null;
      memoGroups?: MemoGroup[] | null;
      allGroups?: UserGroupsPerUser[];
    } = {}
  ) {
    const admin = options.admin ?? false;
    const requesterId = options.requesterId ?? 1;

    fixture.detectChanges(); // ngOnInit fires the two group reads and the account read

    httpMock
      .expectOne({ url: '/organizator/usergroups', method: 'GET' })
      .flush({ usergroups: options.userGroups ?? [], requester: { id: 1, name: 'ovidiu' } });
    httpMock
      .expectOne({ url: '/organizator/memogroups', method: 'GET' })
      .flush({ memogroups: options.memoGroups ?? [], requester: { id: requesterId, name: 'ovidiu' } });
    httpMock
      .expectOne({ url: '/organizator/me', method: 'GET' })
      .flush({ name: 'ovidiu', isAdmin: admin, roles: [] });

    fixture.detectChanges();

    if (admin) {
      httpMock
        .expectOne({ url: '/organizator/admin/all_user_groups', method: 'GET' })
        .flush(options.allGroups ?? []);
      httpMock.expectOne({ url: '/organizator/user-roles', method: 'GET' }).flush([]);
      fixture.detectChanges();
    }
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function query<T extends Element>(selector: string): T {
    const element = fixture.nativeElement.querySelector(selector) as T | null;
    if (element === null) throw new Error(`Nothing matches ${selector}`);
    return element;
  }

  function submit(selector: string, field?: HTMLInputElement | HTMLSelectElement, value?: string) {
    if (field && value !== undefined) field.value = value;
    query<HTMLFormElement>(selector).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  function click(selector: string) {
    query<HTMLButtonElement>(selector).click();
    fixture.detectChanges();
  }

  /**
   * The names actually in a list, rather than anywhere on the screen. A status message names
   * the group it is about ("Deleted Family."), so searching the whole text would find a group
   * that is no longer there.
   */
  function listedNames(panel: string, selector: string): string[] {
    const found = (fixture.nativeElement as HTMLElement).querySelectorAll(
      `${panel} ${selector}`
    );
    return Array.from(found).map(element => element.textContent?.trim() ?? '');
  }

  const userGroupNames = () => listedNames('app-user-groups', '.group-head strong');
  const grantNames = () => listedNames('app-memo-groups', '.grant-name');

  describe('reading', () => {
    it('lists the user groups with their members', () => {
      load({ userGroups: [EMPTY_GROUP, FAMILY] });

      expect(text()).toContain('ovidiu (Individual)');
      expect(text()).toContain('Family');
      expect(text()).toContain('maria');
    });

    it('keeps an empty group on the screen, with its member field', () => {
      // The whole point of the screen: a group is created in order to be filled, so one with
      // no members is a group waiting, not a group to hide.
      load({ userGroups: [EMPTY_GROUP] });

      expect(text()).toContain('ovidiu (Individual)');
      expect(text()).toContain('No members yet');
      expect(query('#ug-member-25')).toBeTruthy();
    });

    it('renders an empty group the server sent as a null member list', () => {
      load({
        userGroups: [{ id: 25, name: 'Brand new', users: null as unknown as UserGroup['users'] }],
      });

      expect(text()).toContain('Brand new');
      expect(text()).toContain('No members yet');
    });

    it('lists the memo groups with the access each user group has', () => {
      load({ memoGroups: [RW] });

      expect(text()).toContain('ovidiu RW');
      expect(text()).toContain('Read and write');
      expect(text()).toContain('Family');
      expect(text()).toContain('Read');
    });

    it('says so when a memo group has nobody granted on it yet', () => {
      load({ memoGroups: [RO] });

      expect(text()).toContain('No user group has access yet.');
      expect(query('#mg-grant-37')).toBeTruthy();
    });

    it('explains an empty screen rather than showing one, for a user who owns no groups', () => {
      load({ userGroups: [] });

      expect(text()).toContain('You do not own any user groups yet');
    });
  });

  describe('the admin report', () => {
    it('is not on the screen for a non-admin, who may not read it', () => {
      load({ userGroups: [FAMILY] });

      expect(fixture.nativeElement.querySelector('app-all-user-groups')).toBeNull();
    });

    it('shows every owner and their groups to an admin', () => {
      load({
        admin: true,
        allGroups: [{ owner: { id: 1, name: 'ovidiu' }, groups: [FAMILY] }],
      });

      expect(fixture.nativeElement.querySelector('app-all-user-groups')).toBeTruthy();
      expect(text()).toContain('All user groups');
      expect(text()).toContain('maria');
    });
  });

  describe('writing', () => {
    it('creates a user group and puts it on the screen', () => {
      load({ userGroups: [] });

      submit('.create-row', query<HTMLInputElement>('#new-user-group-name'), 'Family');

      const request = httpMock.expectOne({
        url: '/organizator/usergroups',
        method: 'POST',
      });
      expect(request.request.body).toEqual({ name: 'Family' });

      request.flush({ id: 30, name: 'Family', users: [] });
      fixture.detectChanges();

      expect(text()).toContain('Family');
      expect(text()).toContain('Created Family');
    });

    it('adds a member by username', () => {
      load({ userGroups: [EMPTY_GROUP] });

      submit('.add-member', query<HTMLInputElement>('#ug-member-25'), 'maria');

      const request = httpMock.expectOne({
        url: '/organizator/usergroups/25/members',
        method: 'POST',
      });
      expect(request.request.body).toEqual({ username: 'maria' });

      request.flush({ id: 25, name: 'ovidiu (Individual)', users: [{ id: 7, name: 'maria' }] });
      fixture.detectChanges();

      expect(text()).toContain('maria');
      expect(text()).not.toContain('No members yet');
    });

    it('refuses an empty name without asking the server', () => {
      load({ userGroups: [] });

      submit('.create-row', query<HTMLInputElement>('#new-user-group-name'), '   ');

      httpMock.expectNone({ url: '/organizator/usergroups', method: 'POST' });
    });

    it('renames a group', () => {
      load({ userGroups: [FAMILY] });

      click('#ug-rename-26');
      submit('.rename-row', query<HTMLInputElement>('#ug-rename-26'), 'Friends');

      const request = httpMock.expectOne({
        url: '/organizator/usergroups/26',
        method: 'PUT',
      });
      expect(request.request.body).toEqual({ name: 'Friends' });

      request.flush({ id: 26, name: 'Friends', users: FAMILY.users });
      fixture.detectChanges();

      expect(text()).toContain('Friends');
    });

    it('deletes a group only after it has been confirmed', () => {
      load({ userGroups: [EMPTY_GROUP, FAMILY] });

      click('#ug-delete-26');
      expect(text()).toContain('Delete Family?');
      httpMock.expectNone({ url: '/organizator/usergroups/26', method: 'DELETE' });

      click('#ug-confirm-delete-26');

      const request = httpMock.expectOne({
        url: '/organizator/usergroups/26',
        method: 'DELETE',
      });
      request.flush(null);
      fixture.detectChanges();

      expect(userGroupNames()).toEqual(['ovidiu (Individual)']);
      expect(text()).toContain('Deleted Family');

      // Deleting a group re-reads the memo groups, whose grants may have named it.
      httpMock
        .expectOne({ url: '/organizator/memogroups', method: 'GET' })
        .flush({ memogroups: [RO], requester: { id: 1, name: 'ovidiu' } });
    });

    it('re-reads the memo groups after deleting a user group, whose grants went with it', () => {
      load({ userGroups: [FAMILY], memoGroups: [RW] });

      click('#ug-delete-26');
      click('#ug-confirm-delete-26');

      httpMock.expectOne({ url: '/organizator/usergroups/26', method: 'DELETE' }).flush(null);
      fixture.detectChanges();

      httpMock
        .expectOne({ url: '/organizator/memogroups', method: 'GET' })
        .flush({ memogroups: [RO], requester: { id: 1, name: 'ovidiu' } });
      fixture.detectChanges();

      expect(text()).toContain('No user group has access yet.');
    });

    it('grants a user group access at the level picked beside it', () => {
      load({ userGroups: [FAMILY], memoGroups: [RO] });

      query<HTMLSelectElement>('#mg-grant-37').value = '26';
      query<HTMLSelectElement>('#mg-grant-access-37').value = '2';
      submit('.add-grant');

      const request = httpMock.expectOne({
        url: '/organizator/memogroups/37/usergroups/26',
        method: 'PUT',
      });
      // What was chosen is what is granted — not read, to be raised afterwards.
      expect(request.request.body).toEqual({ access: 2 });

      request.flush({
        id: 37,
        name: 'ovidiu RO',
        usergroups: [{ id: 26, name: 'Family', access: 2, users: [] }],
      });
      fixture.detectChanges();

      expect(text()).toContain('Family');
      expect(text()).toContain('Read and write');
    });

    it('grants read access when the level control is left alone', () => {
      load({ userGroups: [FAMILY], memoGroups: [RO] });

      query<HTMLSelectElement>('#mg-grant-37').value = '26';
      submit('.add-grant');

      // Read is the first level offered, so leaving the control alone grants the least.
      const request = httpMock.expectOne({
        url: '/organizator/memogroups/37/usergroups/26',
        method: 'PUT',
      });
      expect(request.request.body).toEqual({ access: 1 });

      request.flush({
        id: 37,
        name: 'ovidiu RO',
        usergroups: [{ id: 26, name: 'Family', access: 1, users: [] }],
      });
    });

    it('raises a level through the control on the row', () => {
      load({ userGroups: [FAMILY], memoGroups: [RW] });

      const select = query<HTMLSelectElement>('#mg-access-38-25');
      select.value = '1';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      const request = httpMock.expectOne({
        url: '/organizator/memogroups/38/usergroups/25',
        method: 'PUT',
      });
      expect(request.request.body).toEqual({ access: 1 });
      request.flush(RW);
      fixture.detectChanges();
    });

    it('reads "no access" as revoking the grant, not as a level', () => {
      load({ userGroups: [FAMILY], memoGroups: [RW] });

      const select = query<HTMLSelectElement>('#mg-access-38-26');
      select.value = '0';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      httpMock.expectOne({
        url: '/organizator/memogroups/38/usergroups/26',
        method: 'DELETE',
      }).flush({
        id: 38,
        name: 'ovidiu RW',
        usergroups: [{ id: 25, name: 'ovidiu (Individual)', access: 2, users: [] }],
      });
      fixture.detectChanges();

      expect(grantNames()).toEqual(['ovidiu (Individual)']);
    });

    it('says an endpoint that is not built yet is not built yet', () => {
      load({ userGroups: [FAMILY] });

      click('#ug-delete-26');
      click('#ug-confirm-delete-26');

      // Deleting has no endpoint, and axum answers an unrouted path with a 404 carrying no
      // body — which is exactly what tells it apart from the 404 that means "no such group".
      httpMock
        .expectOne({ url: '/organizator/usergroups/26', method: 'DELETE' })
        .flush(null, { status: 404, statusText: 'Not Found' });
      fixture.detectChanges();

      expect(text()).toContain('does not support');
      // and the group is still there, because nothing was deleted
      expect(text()).toContain('Family');
    });

    it('reports what the server said when the refusal carries a reason', () => {
      load({ userGroups: [FAMILY] });

      submit('.add-member', query<HTMLInputElement>('#ug-member-26'), 'nobody');

      // Adding a member is implemented, and answers 422 with the reason for a name no user has.
      httpMock
        .expectOne({ url: '/organizator/usergroups/26/members', method: 'POST' })
        .flush({ error: 'No user named 「nobody」' }, { status: 422, statusText: 'Unprocessable' });
      fixture.detectChanges();

      expect(text()).toContain('No user named 「nobody」');
    });

    it('leaves the list alone when a change fails', () => {
      load({ userGroups: [FAMILY] });

      click('#ug-rename-26');
      submit('.rename-row', query<HTMLInputElement>('#ug-rename-26'), 'Friends');

      httpMock
        .expectOne({ url: '/organizator/usergroups/26', method: 'PUT' })
        .flush(null, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(text()).toContain('Family');
      expect(text()).not.toContain('Friends');
    });
  });

  describe('focus', () => {
    it('goes into the rename field, and back to the trigger when it is cancelled', () => {
      load({ userGroups: [FAMILY] });

      click('#ug-rename-26');
      expect(document.activeElement?.id).toBe('ug-rename-26');
      expect(document.activeElement?.tagName).toBe('INPUT');

      click('.rename-row .btn:not(.btn-primary)'); // Cancel
      expect(document.activeElement?.id).toBe('ug-rename-26');
      expect(document.activeElement?.tagName).toBe('BUTTON');
    });

    it('goes to the heading when a delete takes the row that had it', () => {
      load({ userGroups: [EMPTY_GROUP, FAMILY] });

      click('#ug-delete-26');
      click('#ug-confirm-delete-26');

      // The row is going away, so its own trigger cannot take focus back.
      expect(document.activeElement?.tagName).toBe('H2');

      httpMock.expectOne({ url: '/organizator/usergroups/26', method: 'DELETE' }).flush(null);
      httpMock
        .expectOne({ url: '/organizator/memogroups', method: 'GET' })
        .flush({ memogroups: [], requester: { id: 1, name: 'ovidiu' } });
    });
  });

  describe('public memo groups', () => {
    it('offers the choice to an admin', () => {
      load({ admin: true, memoGroups: [RO] });

      expect(query('#new-memo-group-public')).toBeTruthy();
    });

    it('offers it to nobody else', () => {
      load({ memoGroups: [RO] });

      expect(fixture.nativeElement.querySelector('#new-memo-group-public')).toBeNull();
    });

    it('creates a public group when an admin ticks the box', () => {
      load({ admin: true, memoGroups: [] });

      query<HTMLInputElement>('#new-memo-group-public').checked = true;
      submit(
        'app-memo-groups .create-row',
        query<HTMLInputElement>('#new-memo-group-name'),
        'Everyone RO'
      );

      const request = httpMock.expectOne({ url: '/organizator/memogroups', method: 'POST' });
      expect(request.request.body).toEqual({ name: 'Everyone RO', public: true });

      request.flush({ id: 40, name: 'Everyone RO', usergroups: [], public: true });
      fixture.detectChanges();

      expect(text()).toContain('visible to everyone');
    });

    it('creates a private group when the box is left alone', () => {
      load({ admin: true, memoGroups: [] });

      submit(
        'app-memo-groups .create-row',
        query<HTMLInputElement>('#new-memo-group-name'),
        'Mine'
      );

      const request = httpMock.expectOne({ url: '/organizator/memogroups', method: 'POST' });
      expect(request.request.body).toEqual({ name: 'Mine', public: false });
      request.flush({ id: 41, name: 'Mine', usergroups: [], public: false });
    });

    it('says on the row that a group is public, and lets an admin change it', () => {
      load({ admin: true, memoGroups: [{ ...RO, public: true }] });

      expect(text()).toContain('Public');
      expect(query<HTMLInputElement>('#mg-public-37').checked).toBe(true);

      const box = query<HTMLInputElement>('#mg-public-37');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      const request = httpMock.expectOne({
        url: '/organizator/memogroups/37/public',
        method: 'PUT',
      });
      expect(request.request.body).toEqual({ public: false });

      request.flush({ id: 37, name: 'ovidiu RO', usergroups: [], public: false });
      fixture.detectChanges();

      expect(text()).toContain('no longer public');
    });

    it('offers no visibility control until the server says which a group is', () => {
      // `public` is in no response yet; a checkbox would have to invent an answer.
      load({ admin: true, memoGroups: [RO] });

      expect(RO.public).toBeUndefined();
      expect(fixture.nativeElement.querySelector('#mg-public-37')).toBeNull();
    });

    it('offers no visibility control to a non-admin either', () => {
      load({ memoGroups: [{ ...RO, public: true }] });

      expect(fixture.nativeElement.querySelector('#mg-public-37')).toBeNull();
    });

    it('says a group is public for everyone who can see it, not only for an admin', () => {
      load({ memoGroups: [{ ...RO, public: true }] });

      // A non-admin is shown the admin's public groups; the badge is what explains why a
      // group they do not own is on their screen at all.
      expect(listedNames('app-memo-groups', '.badge.public')).toEqual(['Public']);
    });

    it('says nothing of the sort about a group of one\'s own', () => {
      load({ memoGroups: [{ ...RO, public: false }] });

      expect(listedNames('app-memo-groups', '.badge.public')).toEqual([]);
      expect(text()).not.toContain('Public');
    });
  });

  describe('what the server answers', () => {
    it('does not claim the groups are gone when the read failed', () => {
      fixture.detectChanges();

      httpMock
        .expectOne({ url: '/organizator/usergroups', method: 'GET' })
        .flush(null, { status: 500, statusText: 'Server Error' });
      httpMock
        .expectOne({ url: '/organizator/memogroups', method: 'GET' })
        .flush({ memogroups: [], requester: { id: 1, name: 'ovidiu' } });
      httpMock
        .expectOne({ url: '/organizator/me', method: 'GET' })
        .flush({ name: 'ovidiu', isAdmin: false, roles: [] });
      fixture.detectChanges();

      expect(text()).toContain('Failed to load your user groups');
      // "You have no groups" under "the groups did not load" would say they were deleted.
      expect(text()).not.toContain('You do not own any user groups yet');
    });

    it('renders a report whose member list came back null', () => {
      load({
        admin: true,
        allGroups: [
          {
            owner: { id: 1, name: 'ovidiu' },
            groups: [{ id: 25, name: 'Family', users: null as unknown as UserGroup['users'] }],
          },
        ],
      });

      expect(text()).toContain('No members yet.');
    });

    it('puts the access picker back when the server refuses the change', () => {
      load({ userGroups: [FAMILY], memoGroups: [RW] });

      const select = query<HTMLSelectElement>('#mg-access-38-26');
      expect(select.value).toBe('1'); // Family has read access

      select.value = '2';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      httpMock
        .expectOne({ url: '/organizator/memogroups/38/usergroups/26', method: 'PUT' })
        .flush({ error: 'nope' }, { status: 404, statusText: 'Not Found' });
      fixture.detectChanges();

      // Nothing was stored, so the control must not go on showing a level that was refused.
      expect(select.value).toBe('1');
      expect(text()).toContain('nope');
    });

    it('reports a failed change on the row it was about, not just on the panel', () => {
      load({ userGroups: [EMPTY_GROUP, FAMILY] });

      click('#ug-rename-26');
      submit('.rename-row', query<HTMLInputElement>('#ug-rename-26'), 'Friends');

      httpMock
        .expectOne({ url: '/organizator/usergroups/26', method: 'PUT' })
        .flush(null, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      const rows = listedNames('app-user-groups', '.row-status');
      expect(rows.some(row => row.includes('Family'))).toBe(true);
    });
  });

  describe('memo groups the visitor does not own', () => {
    it('shows the controls when the owner is an explicit null', () => {
      // A Rust Option<GroupMember> serializes to null, not to a missing key.
      load({ memoGroups: [{ ...RO, owner: null as unknown as undefined }] });

      expect(fixture.nativeElement.querySelector('#mg-rename-37')).toBeTruthy();
    });

    it('keeps the controls for the admin account, whose requester id is the sentinel 0', () => {
      // db.rs reports 0 as the requester for the admin, while the seeded public groups are
      // owned by user 1 — comparing the two would lock the owner out of their own groups.
      load({ requesterId: 0, memoGroups: [{ ...RO, owner: { id: 1, name: 'admin' } }] });

      expect(fixture.nativeElement.querySelector('#mg-rename-37')).toBeTruthy();
    });

    it('hides the controls when the server says someone else owns it', () => {
      // The admin's public groups are shown to everyone but are only the admin's to change.
      load({ requesterId: 5, memoGroups: [{ ...RO, owner: { id: 1, name: 'admin' } }] });

      expect(fixture.nativeElement.querySelector('#mg-rename-37')).toBeNull();
      expect(fixture.nativeElement.querySelector('#mg-delete-37')).toBeNull();
      expect(fixture.nativeElement.querySelector('#mg-grant-37')).toBeNull();
    });

    it('allows the attempt while the owner is unknown, and lets the server refuse', () => {
      load({ memoGroups: [RO] });

      expect(fixture.nativeElement.querySelector('#mg-rename-37')).toBeTruthy();
    });
  });
});
