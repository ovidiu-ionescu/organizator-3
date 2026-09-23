import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HighlightPipe } from './highlight-pipe';

@Component({
  imports: [HighlightPipe],
  template: `<p [innerHTML]="text() | highlight: search()"></p>`,
})
class Host {
  text = signal('');
  search = signal('');
}

describe('HighlightPipe', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();

    fixture = TestBed.createComponent(Host);
  });

  function render(text: string, search: string): string {
    fixture.componentInstance.text.set(text);
    fixture.componentInstance.search.set(search);
    fixture.detectChanges();

    return (fixture.nativeElement as HTMLElement).querySelector('p')!.innerHTML;
  }

  it('wraps the matching text in a mark element', () => {
    expect(render('Organizator administrator', 'admin')).toContain(
      'Organizator <mark class="highlight">admin</mark>istrator',
    );
  });

  it('highlights every match, ignoring case', () => {
    expect(render('photo, Photo and PHOTO', 'photo')).toContain(
      '<mark class="highlight">photo</mark>, <mark class="highlight">Photo</mark> and <mark class="highlight">PHOTO</mark>',
    );
  });

  it('returns the text unchanged when there is no search term', () => {
    expect(render('Organizator user', '')).toBe('Organizator user');
  });

  it('treats regex characters in the search term literally', () => {
    expect(render('org (admin)', '(')).toContain('<mark class="highlight">(</mark>admin)');
  });
});
