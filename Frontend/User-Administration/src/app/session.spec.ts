import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { Account, Session } from './session';
import { Role } from './user-list/user-list';

const ROLE: Role = { id: 3, name: 'photo', description: 'Access to photos' };

describe('Session', () => {
  let session: Session;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    session = TestBed.inject(Session);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function expectAccountRequest() {
    return httpMock.expectOne({ url: '/organizator/me', method: 'GET' });
  }

  it('publishes the name, the admin flag and the roles the server answers with', () => {
    session.load().subscribe();

    expectAccountRequest().flush({ name: 'admin', isAdmin: true, roles: [ROLE] });

    expect(session.name()).toBe('admin');
    expect(session.isAdmin()).toBe(true);
    expect(session.roles()).toEqual([ROLE]);
  });

  it('does not call the visitor a non-admin before the server has answered', () => {
    expect(session.name()).toBeNull();
    // null rather than false: only the server may say the visitor is not an admin
    expect(session.isAdmin()).toBeNull();
    expect(session.roles()).toEqual([]);

    session.load().subscribe();

    expectAccountRequest().flush({ name: 'guest', isAdmin: false, roles: [] });

    expect(session.name()).toBe('guest');
    expect(session.isAdmin()).toBe(false);
  });

  it('reads the account once for everyone who asks', () => {
    const names: (string | null)[] = [];
    session.load().subscribe(account => names.push(account?.name ?? null));
    session.load().subscribe(account => names.push(account?.name ?? null));

    expectAccountRequest().flush({ name: 'admin', isAdmin: true, roles: [ROLE] }); // one request, two callers

    expect(names).toEqual(['admin', 'admin']);
  });

  it('reads an answer that never came as no account, leaving the caller to say what happens then', () => {
    let account: Account | null | undefined;
    session.load().subscribe(value => (account = value));

    expectAccountRequest().flush('no', { status: 500, statusText: 'Server Error' });

    expect(account).toBeNull();
    expect(session.name()).toBeNull();
    expect(session.isAdmin()).toBeNull();
  });
});
