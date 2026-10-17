import { Routes } from '@angular/router';

/**
 * The two screens behind the shell's menu. Both are lazy: each is only useful to someone who
 * followed the menu there, so none of their code belongs in the initial bundle.
 *
 * The calendar used to be a third, and the screen the app opened on. It is now a page of the memo
 * app, which is where odates are read, written and drawn — /calendar on the same host.
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
  // Anything else — a stale bookmark, a typo, the /calendar this app used to serve — lands on the
  // screen the app opens with.
  { path: '**', redirectTo: 'users' },
];
