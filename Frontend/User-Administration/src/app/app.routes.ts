import { Routes } from '@angular/router';

/**
 * Two screens behind the shell's menu. Both are lazy: the groups screen is only useful to
 * someone who followed the menu there, so its code has no business in the initial bundle.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'users' },
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
  // Anything else — a stale bookmark, a typo — lands on the screen the app used to open with.
  { path: '**', redirectTo: 'users' },
];
