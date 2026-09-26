import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { UsersPage } from './users-page';
import { Account } from '../session';
import { User } from '../user-list/user-list';

const USERS: User[] = [
  {
    id: 1,
    name: 'admin',
    roles: [{ id: 1, name: 'orgadm', description: 'Organizator administrator' }],
  },
  { id: 2, name: 'guest', roles: [{ id: 2, name: 'photo', description: 'Access to photos' }] },
];

/**
 * The screen that used to be App itself. These cases came with it when the header, the filter
 * and the list were split apart, so they are the same assertions against the new host.
 */
describe('UsersPage', () => {
  let fixture: ComponentFixture<UsersPage>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UsersPage],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UsersPage);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  function loadUsers(account: Account = { name: 'admin', isAdmin: true, roles: [] }) {
    httpMock.expectOne({ url: '/organizator/me', method: 'GET' }).flush(account);
    fixture.detectChanges();

    // a non-admin is never sent the list, so there is no request to answer for one
    if (!account.isAdmin) return;

    httpMock
      .expectOne({ url: '/organizator/user-roles', method: 'GET' })
      .flush(structuredClone(USERS));
    fixture.detectChanges();
  }

  function userListText(): string {
    return (fixture.nativeElement.querySelector('app-user-list') as HTMLElement).textContent ?? '';
  }

  it('renders the filter and the user list', () => {
    loadUsers();

    expect(fixture.nativeElement.querySelector('#search')).toBeTruthy();
    expect(userListText()).toContain('admin');
    expect(userListText()).toContain('Organizator administrator');
  });

  it('keeps the filter away from a non-admin, who has nothing to filter', () => {
    loadUsers({ name: 'ovidiu', isAdmin: false, roles: [] });

    expect(fixture.nativeElement.querySelector('#search')).toBeNull();
    expect(userListText()).toContain('ovidiu');
  });

  it('filters the user list with the search input', async () => {
    loadUsers();

    const input = fixture.nativeElement.querySelector('#search') as HTMLInputElement;
    input.value = 'guest';
    input.dispatchEvent(new Event('input'));

    await new Promise((resolve) => setTimeout(resolve, 350)); // UserFilter debounces for 300ms

    fixture.detectChanges();
    expect(userListText()).toContain('guest');
    expect(userListText()).not.toContain('admin');
  });
});
