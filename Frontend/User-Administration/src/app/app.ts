import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Theme } from './theme';

/**
 * The shell every screen sits in: the heading, the theme toggle and the menu. The screens
 * themselves are routed, so this holds no feature state of its own.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('user-administration');

  protected readonly theme = inject(Theme);
}
