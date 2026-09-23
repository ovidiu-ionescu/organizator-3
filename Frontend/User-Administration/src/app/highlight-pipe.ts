import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({
  name: 'highlight',
  standalone: true,
})
export class HighlightPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(text: string, search: string): SafeHtml {
    if(!search || ! text) {
      return text;
    }

    // Escape special regex characters to prevent runtime regex errors
    const escapedSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escapedSearch})`, 'gi');

    // Wrap matching text in a <mark> tag
    const highlightedText = text.replace(regex, '<mark class="highlight">$1</mark>');
    console.log(highlightedText);

    // Bypass security so Angular renders the <mark> tag properly
    return this.sanitizer.bypassSecurityTrustHtml(highlightedText);
  }
}
