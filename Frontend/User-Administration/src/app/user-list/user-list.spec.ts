import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HttpParams, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { Role, User, UserList } from './user-list';
import { Account } from '../session';

const ROLES: Role[] = [
  { id: 1, name: 'orgadm', description: 'Organizator administrator' },
  { id: 2, name: 'org', description: 'Organizator user' },
  { id: 3, name: 'photo', description: 'Access to photos' },
];

const USERS: User[] = [
  { id: 1, name: 'admin', roles: [ROLES[0], ROLES[1]] },
  { id: 2, name: 'user', roles: [ROLES[1]] },
];

describe('UserList', () => {
  let component: UserList;
  let fixture: ComponentFixture<UserList>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserList],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserList);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  /** The account the server reports; an admin who may see the whole list unless told otherwise. */
  function expectAccountRequest(
    account: Account = { name: 'admin', isAdmin: true, roles: [ROLES[0]] },
  ) {
    httpMock.expectOne({ url: '/organizator/me', method: 'GET' }).flush(account);
    fixture.detectChanges();
  }

  /** The list itself, which is asked for once the app knows the visitor is an admin. */
  function expectUserListRequest() {
    const request = httpMock.expectOne({ url: '/organizator/user-roles', method: 'GET' });
    request.flush(structuredClone(USERS));
    fixture.detectChanges();
    return request;
  }

  /** Both requests of an admin's page load: who they are, then the list they may see. */
  function loadAdminList() {
    expectAccountRequest();
    expectUserListRequest();
  }

  function buttonOrNull(
    text: string,
    within: HTMLElement = fixture.nativeElement,
  ): HTMLButtonElement | null {
    const buttons = Array.from(within.querySelectorAll('button')) as HTMLButtonElement[];
    return buttons.find((candidate) => candidate.textContent?.trim() === text) ?? null;
  }

  function button(text: string, within: HTMLElement = fixture.nativeElement): HTMLButtonElement {
    const match = buttonOrNull(text, within);
    if (!match) throw new Error(`No button labelled "${text}"`);
    return match;
  }

  function roleChipLabels(): string[] {
    const chips = Array.from(
      fixture.nativeElement.querySelectorAll('.chip-remove'),
    ) as HTMLElement[];
    return chips.map((chip) => chip.getAttribute('aria-label') ?? '');
  }

  function addRoleBlockFor(userName: string): HTMLElement {
    const blocks = Array.from(fixture.nativeElement.querySelectorAll('.add-role')) as HTMLElement[];
    const match = blocks.find((block) =>
      block.querySelector('label')?.textContent?.includes(userName),
    );
    if (!match) throw new Error(`No "add role" block for user "${userName}"`);
    return match;
  }

  async function startEditing() {
    button('Edit roles').click();
    fixture.detectChanges();
    httpMock.expectOne({ url: '/organizator/roles', method: 'GET' }).flush(structuredClone(ROLES));
    await fixture.whenStable();
  }

  /** The user's own row, as opposed to the nested role and chip lists inside it. */
  function rowFor(userName: string): HTMLElement {
    const rows = Array.from(
      fixture.nativeElement.querySelectorAll('.user-list > ul > li'),
    ) as HTMLElement[];
    const match = rows.find((row) => row.querySelector('strong')?.textContent?.trim() === userName);
    if (!match) throw new Error(`No row for user "${userName}"`);
    return match;
  }

  /** The message shown on a row, empty when the row has none. */
  function rowStatusFor(userName: string): string {
    return rowFor(userName).querySelector('.status')?.textContent?.trim() ?? '';
  }

  /** The message above the list, about the list as a whole rather than about one user. */
  function listStatus(): string {
    return (
      fixture.nativeElement.querySelector('.user-list > .status')?.textContent?.trim() ?? ''
    );
  }

  function passwordForms(): HTMLFormElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('form.password-form'));
  }

  function passwordFormFor(userName: string): HTMLFormElement {
    const match = passwordForms().find((form) =>
      form.textContent?.includes(`new password for ${userName}`),
    );
    if (!match) throw new Error(`No password form for user "${userName}"`);
    return match;
  }

  function fieldFor(form: HTMLFormElement, field: 'new' | 'current'): HTMLInputElement {
    const name = field === 'new' ? 'new_password' : 'old_password';
    return form.querySelector(`input[name="${name}"]`) as HTMLInputElement;
  }

  function revealButton(form: HTMLFormElement): HTMLButtonElement {
    return form.querySelector('button.reveal') as HTMLButtonElement;
  }

  /** The row's "Change password" trigger, or null while its form has taken its place. */
  function triggerFor(userName: string): HTMLButtonElement | null {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    return (
      buttons.find((candidate) => candidate.textContent?.trim() === `Change password for ${userName}`) ??
      null
    );
  }

  async function openPasswordFormFor(userName: string) {
    button(`Change password for ${userName}`).click();
    await fixture.whenStable();
  }

  function fillPasswordForm(userName: string, newPassword: string, currentPassword: string) {
    const form = passwordFormFor(userName);
    fieldFor(form, 'new').value = newPassword;
    fieldFor(form, 'current').value = currentPassword;
    return form;
  }

  it('should create', () => {
    loadAdminList();
    expect(component).toBeTruthy();
  });

  it('does not allow editing before the users are loaded', () => {
    expectAccountRequest();

    // the account is known, so the button is there — but there is nothing to edit yet
    expect(button('Edit roles').disabled).toBe(true);

    expectUserListRequest();

    expect(button('Edit roles').disabled).toBe(false);
  });

  it('lists the users and their roles', () => {
    loadAdminList();

    expect(fixture.nativeElement.textContent).toContain('admin');
    expect(fixture.nativeElement.textContent).toContain('Organizator administrator');
    expect(button('Edit roles')).toBeTruthy();
  });

  it('offers the roles the user does not have yet when editing', async () => {
    loadAdminList();
    await startEditing();

    const block = addRoleBlockFor('admin');
    const options = Array.from(block.querySelectorAll('option')) as HTMLOptionElement[];

    // orgadm and org are already assigned to admin, so only photo is left to add
    expect(options.map((option) => option.value)).toEqual(['', '3']);
  });

  it('removes a role from a user', async () => {
    loadAdminList();
    await startEditing();

    const remove = fixture.nativeElement.querySelector(
      '[aria-label="Remove role orgadm from admin"]',
    ) as HTMLButtonElement;
    remove.click();
    await fixture.whenStable();

    expect(roleChipLabels()).toEqual(['Remove role org from admin', 'Remove role org from user']);
  });

  it('adds a role to a user', async () => {
    loadAdminList();
    await startEditing();

    const block = addRoleBlockFor('user');
    const select = block.querySelector('select') as HTMLSelectElement;
    select.value = '3';
    button('Add', block).click();
    await fixture.whenStable();

    expect(roleChipLabels()).toEqual([
      'Remove role orgadm from admin',
      'Remove role org from admin',
      'Remove role org from user',
      'Remove role photo from user',
    ]);
  });

  it('says "No more roles" in the dropdown once the user has them all', async () => {
    loadAdminList();
    await startEditing();

    const select = () => addRoleBlockFor('admin').querySelector('select') as HTMLSelectElement;
    expect(select().options[0].textContent?.trim()).toBe('Select a role…');

    select().value = '3'; // photo is the only role admin does not have yet
    button('Add', addRoleBlockFor('admin')).click();
    await fixture.whenStable();

    expect(select().disabled).toBe(true);
    expect(select().options.length).toBe(1);
    expect(select().options[0].textContent?.trim()).toBe('No more roles');
  });

  it('sends only the users whose roles changed', async () => {
    loadAdminList();
    await startEditing();

    const remove = fixture.nativeElement.querySelector(
      '[aria-label="Remove role orgadm from admin"]',
    ) as HTMLButtonElement;
    remove.click();
    await fixture.whenStable();

    button('Save').click();
    fixture.detectChanges();

    const put = httpMock.expectOne({ url: '/organizator/user-roles', method: 'PUT' });
    // user 2 is untouched, so it is not part of the payload
    expect(put.request.body).toEqual([{ userId: 1, roleIds: [2] }]);
    put.flush(null);
    await fixture.whenStable();

    expectUserListRequest(); // the list reloads after a successful save, with no second /me
    expect(fixture.nativeElement.textContent).toContain('Saved roles for 1 user.');
  });

  it('sends every remaining role when a user is left without any', async () => {
    loadAdminList();
    await startEditing();

    for (const label of ['Remove role orgadm from admin', 'Remove role org from admin']) {
      const remove = fixture.nativeElement.querySelector(
        `[aria-label="${label}"]`,
      ) as HTMLButtonElement;
      remove.click();
      await fixture.whenStable();
    }

    button('Save').click();
    fixture.detectChanges();

    const put = httpMock.expectOne({ url: '/organizator/user-roles', method: 'PUT' });
    expect(put.request.body).toEqual([{ userId: 1, roleIds: [] }]);
    put.flush(null);
    await fixture.whenStable();
    expectUserListRequest(); // the list reloads after a successful save, with no second /me
  });

  it('includes added roles in the diff', async () => {
    loadAdminList();
    await startEditing();

    const block = addRoleBlockFor('user');
    const select = block.querySelector('select') as HTMLSelectElement;
    select.value = '3';
    button('Add', block).click();
    await fixture.whenStable();

    button('Save').click();
    fixture.detectChanges();

    const put = httpMock.expectOne({ url: '/organizator/user-roles', method: 'PUT' });
    expect(put.request.body).toEqual([{ userId: 2, roleIds: [2, 3] }]); // ids sorted
    put.flush(null);
    await fixture.whenStable();
    expectUserListRequest(); // the list reloads after a successful save, with no second /me
  });

  it('does not send anything when nothing changed', async () => {
    loadAdminList();
    await startEditing();

    button('Save').click();
    await fixture.whenStable();

    httpMock.expectNone({ url: '/organizator/user-roles', method: 'PUT' });
    expect(fixture.nativeElement.textContent).toContain('No changes to save.');
    expect(button('Edit roles')).toBeTruthy(); // back to read mode, nothing to save
  });

  it('discards the changes when cancelling', async () => {
    loadAdminList();
    await startEditing();

    const remove = fixture.nativeElement.querySelector(
      '[aria-label="Remove role orgadm from admin"]',
    ) as HTMLButtonElement;
    remove.click();
    await fixture.whenStable();

    button('Cancel').click();
    await fixture.whenStable();

    expect(component.users()).toEqual(USERS);
    expect(button('Edit roles')).toBeTruthy();
  });

  it('replaces the trigger with the form, and only for the clicked user', async () => {
    loadAdminList();
    expect(triggerFor('admin')).toBeTruthy();

    await openPasswordFormFor('admin');

    expect(passwordForms().length).toBe(1);
    expect(triggerFor('admin')).toBeNull();
    expect(triggerFor('user')).toBeTruthy();
  });

  it('reveals only the new password, never the admin\'s own', async () => {
    loadAdminList();
    await openPasswordFormFor('admin');
    const form = passwordFormFor('admin');

    expect(fieldFor(form, 'new').type).toBe('password');
    expect(fieldFor(form, 'current').type).toBe('password');

    revealButton(form).click();
    await fixture.whenStable();

    expect(fieldFor(form, 'new').type).toBe('text');
    expect(fieldFor(form, 'current').type).toBe('password'); // stays masked
    // the admin's own password has no reveal control at all
    expect(form.querySelectorAll('button.reveal').length).toBe(1);
  });

  it('does not carry a revealed password over to the next user', async () => {
    loadAdminList();
    await openPasswordFormFor('admin');
    revealButton(passwordFormFor('admin')).click();
    await fixture.whenStable();
    expect(fieldFor(passwordFormFor('admin'), 'new').type).toBe('text');

    await openPasswordFormFor('user');

    expect(fieldFor(passwordFormFor('user'), 'new').type).toBe('password');
  });

  it('closes the form on cancel without posting', async () => {
    loadAdminList();
    await openPasswordFormFor('admin');
    fillPasswordForm('admin', 'n3w', 'adm1n');

    button('Cancel', passwordFormFor('admin')).click();
    await fixture.whenStable();

    expect(passwordForms().length).toBe(0);
    const trigger = triggerFor('admin');
    expect(trigger).toBeTruthy();
    // the trigger replaced the form, so focus belongs back on it rather than on the body
    expect(document.activeElement).toBe(trigger);
    httpMock.expectNone({ url: '/organizator/password', method: 'POST' });
  });

  it('closes an open password form when the roles editor starts', async () => {
    loadAdminList();
    await openPasswordFormFor('admin');

    await startEditing();

    expect(passwordForms().length).toBe(0);
  });

  it('posts the new password and the admin\'s own password as an escaped form body', async () => {
    loadAdminList();
    await openPasswordFormFor('user');
    button('Set', fillPasswordForm('user', 'n3w&p=ss+word%', 'my secret')).click();
    fixture.detectChanges();

    const post = httpMock.expectOne({ url: '/organizator/password', method: 'POST' });
    const body = post.request.body as HttpParams;
    expect(body.get('username')).toBe('user');
    expect(body.get('old_password')).toBe('my secret');
    expect(body.get('new_password')).toBe('n3w&p=ss+word%');
    // On the wire the dangerous delimiters are escaped, so a password cannot break out of its
    // field or smuggle in another one. Angular leaves "=" literal, which is harmless because the
    // body is parsed pairwise on the first "=" of each pair.
    expect(body.toString()).toContain('new_password=n3w%26p=ss%2Bword%25');
    // the & inside the password smuggled in no extra field
    expect(body.keys().sort()).toEqual(['new_password', 'old_password', 'username']);

    post.flush('', { status: 200, statusText: 'OK' });
    await fixture.whenStable();

    expect(passwordForms().length).toBe(0);
    expect(triggerFor('user')).toBeTruthy();
    expect(rowStatusFor('user')).toBe('Password changed for user.');
  });

  it('does not post while a field is empty, and stops the native submit', async () => {
    loadAdminList();
    await openPasswordFormFor('user');
    const form = fillPasswordForm('user', 'n3w', '');

    const submit = new Event('submit', { cancelable: true });
    form.dispatchEvent(submit);
    await fixture.whenStable();

    // without preventDefault the browser would send both passwords as a GET
    expect(submit.defaultPrevented).toBe(true);
    httpMock.expectNone({ url: '/organizator/password', method: 'POST' });
    expect(rowStatusFor('user')).toBe('Enter the new password and your own password.');
  });

  it('reports the admin\'s own password when the server says it is wrong', async () => {
    loadAdminList();
    await openPasswordFormFor('user');
    button('Set', fillPasswordForm('user', 'n3w', 'wrong')).click();
    fixture.detectChanges();

    httpMock
      .expectOne({ url: '/organizator/password', method: 'POST' })
      .flush(null, { status: 400, statusText: 'Bad Request' });
    await fixture.whenStable();

    const row = rowFor('user');
    expect(rowStatusFor('user')).toBe('Your own password is incorrect.');
    const message = row.querySelector('.status') as HTMLElement;
    expect(message.classList).toContain('error');

    const form = passwordFormFor('user'); // still open, so it can be retried
    expect(fieldFor(form, 'current').value).toBe(''); // the admin's password is not kept
    expect(fieldFor(form, 'new').value).toBe('n3w'); // the new one survives
  });

  it('reports a forbidden change without blaming the admin\'s password', async () => {
    loadAdminList();
    await openPasswordFormFor('user');
    button('Set', fillPasswordForm('user', 'n3w', 'adm1n')).click();
    fixture.detectChanges();

    httpMock
      .expectOne({ url: '/organizator/password', method: 'POST' })
      .flush(null, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();

    expect(rowStatusFor('user')).toBe('You are not allowed to change the password for user.');
    expect(fixture.nativeElement.textContent).not.toContain('Your own password is incorrect.');
  });

  it('leaves a 401 to the interceptor instead of reading it as a wrong password', async () => {
    loadAdminList();
    await openPasswordFormFor('user');
    button('Set', fillPasswordForm('user', 'n3w', 'adm1n')).click();
    fixture.detectChanges();

    httpMock
      .expectOne({ url: '/organizator/password', method: 'POST' })
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();

    // a 401 means the session is gone; in the app the interceptor redirects before this is shown
    expect(rowStatusFor('user')).not.toContain('Your own password is incorrect.');
  });

  it('shows the backend\'s reason for refusing the new password', async () => {
    loadAdminList();
    await openPasswordFormFor('user');
    button('Set', fillPasswordForm('user', 'short', 'adm1n')).click();
    fixture.detectChanges();

    // 422 is the new password itself being refused, and the body names the rule it broke
    httpMock
      .expectOne({ url: '/organizator/password', method: 'POST' })
      .flush('New password must be at least 10 characters', {
        status: 422,
        statusText: 'Unprocessable Entity',
      });
    await fixture.whenStable();

    expect(rowStatusFor('user')).toBe('New password must be at least 10 characters');
    expect(passwordForms().length).toBe(1); // still open, so the password can be changed and retried
    expect(fieldFor(passwordFormFor('user'), 'new').value).toBe('short');
  });

  it('still says something when a refused new password arrives without a reason', async () => {
    loadAdminList();
    await openPasswordFormFor('user');
    button('Set', fillPasswordForm('user', 'short', 'adm1n')).click();
    fixture.detectChanges();

    httpMock
      .expectOne({ url: '/organizator/password', method: 'POST' })
      .flush('', { status: 422, statusText: 'Unprocessable Entity' });
    await fixture.whenStable();

    expect(rowStatusFor('user')).toBe('Failed to change the password.');
  });

  it('shows the result on the password\'s own row, not above the list', async () => {
    loadAdminList();
    await openPasswordFormFor('user');
    button('Set', fillPasswordForm('user', 'n3w', 'adm1n')).click();
    fixture.detectChanges();

    httpMock
      .expectOne({ url: '/organizator/password', method: 'POST' })
      .flush('', { status: 200, statusText: 'OK' });
    await fixture.whenStable();

    // the message is about one user, so it stays with that user rather than on the list's status
    expect(rowStatusFor('user')).toBe('Password changed for user.');
    expect(rowStatusFor('admin')).toBe('');
    expect(listStatus()).toBe('');
  });

  it('drops a result once the form is opened again', async () => {
    loadAdminList();
    await openPasswordFormFor('user');
    button('Set', fillPasswordForm('user', 'n3w', 'adm1n')).click();
    fixture.detectChanges();

    httpMock
      .expectOne({ url: '/organizator/password', method: 'POST' })
      .flush('', { status: 200, statusText: 'OK' });
    await fixture.whenStable();

    await openPasswordFormFor('user');

    expect(rowStatusFor('user')).toBe('');
  });

  it('gives a non-admin their own row and no list of other users', () => {
    expectAccountRequest({ name: 'ovidiu', isAdmin: false, roles: [] });

    // the list is not theirs to read, so it is never asked for
    httpMock.expectNone({ url: '/organizator/user-roles', method: 'GET' });
    expect(fixture.nativeElement.querySelectorAll('.user-list > ul > li').length).toBe(1);
    expect(rowFor('ovidiu')).toBeTruthy();
    expect(buttonOrNull('Edit roles')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Your account');
    // their own empty state, which the server reports as no roles rather than omitting them
    expect(fixture.nativeElement.textContent).toContain('No roles assigned.');
  });

  it('shows a non-admin what their roles open, without letting them change them', () => {
    expectAccountRequest({ name: 'ovidiu', isAdmin: false, roles: [ROLES[1], ROLES[2]] });

    const row = rowFor('ovidiu');
    expect(row.textContent).toContain('Organizator user');
    expect(row.textContent).toContain('Access to photos');

    // read-only: no chips to remove and no dropdown to add, unlike the same list while editing
    expect(row.querySelectorAll('.chip-remove').length).toBe(0);
    expect(row.querySelectorAll('.add-role').length).toBe(0);
    expect(buttonOrNull('Edit roles')).toBeNull();
  });

  it('lets a non-admin change their own password', async () => {
    expectAccountRequest({ name: 'ovidiu', isAdmin: false, roles: [ROLES[1]] });

    await openPasswordFormFor('ovidiu');
    button('Set', fillPasswordForm('ovidiu', 'n3w', 'old1')).click();
    fixture.detectChanges();

    const post = httpMock.expectOne({ url: '/organizator/password', method: 'POST' });
    const body = post.request.body as HttpParams;
    expect(body.get('username')).toBe('ovidiu'); // their own name, which the backend accepts for self
    expect(body.get('old_password')).toBe('old1');
    expect(body.get('new_password')).toBe('n3w');

    post.flush('', { status: 200, statusText: 'OK' });
    await fixture.whenStable();

    expect(rowStatusFor('ovidiu')).toBe('Password changed for ovidiu.');
  });

  it('falls back to the user list when the account cannot be read', () => {
    httpMock
      .expectOne({ url: '/organizator/me', method: 'GET' })
      .flush('no', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Could not read your account; showing the user list.',
    );

    // what the app did before /me existed: ask for the list and let the server refuse
    httpMock
      .expectOne({ url: '/organizator/user-roles', method: 'GET' })
      .flush(structuredClone(USERS));
    fixture.detectChanges();

    expect(rowFor('admin')).toBeTruthy();
  });

  it('leaves the roles message above the list', async () => {
    loadAdminList();
    await startEditing();
    button('Save').click();
    await fixture.whenStable();

    expect(listStatus()).toBe('No changes to save.');
  });
});
