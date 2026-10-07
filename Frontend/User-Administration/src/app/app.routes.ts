import { Routes } from '@angular/router';

/**
 * The three screens behind the shell's menu. All of them are lazy: each is only useful to
 * someone who followed the menu there, so none of their code belongs in the initial bundle.
 *
 * The calendar is the one the app opens on, and the first entry in the menu so that the screen
 * you land on is the one at the front.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'calendar' },
  {
    path: 'users',
    // The router's default title strategy puts these in document.title, so each screen says
    // which one it is to someone who cannot see it (WCAG 2.4.2).
    title: 'Users and roles',
    loadComponent: () => import('./users-page/users-page').then(module => module.UsersPage),
  },
  {
    path: 'groups',
    title: 'Groups',
    loadComponent: () => import('./groups-page/groups-page').then(module => module.GroupsPage),
  },
  {
    path: 'calendar',
    title: 'Calendar',
    loadComponent: () =>
      import('./calendar-page/calendar-page').then(module => module.CalendarPage),
  },
  // Anything else — a stale bookmark, a typo — lands on the screen the app opens with.
  { path: '**', redirectTo: 'calendar' },
];
