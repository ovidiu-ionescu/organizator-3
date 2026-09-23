import { TestBed } from '@angular/core/testing';

import { AuthRedirect } from './auth-redirect';

describe('AuthRedirect', () => {
  let service: AuthRedirect;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AuthRedirect);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
