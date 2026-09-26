import { Component, input } from '@angular/core';
import { PanelStatus, UserGroupsPerUser } from '../../groups-api';

/**
 * Every owner and the user groups they own — the whole system's groups in one place, which is
 * the admin's extra.
 *
 * Read only: it is a report of what exists, and changing someone else's group is not something
 * this screen offers. The endpoint is admin-only, so a non-admin never sees it at all.
 */
@Component({
  selector: 'app-all-user-groups',
  imports: [],
  templateUrl: './all-user-groups.html',
  styleUrl: './all-user-groups.css',
})
export class AllUserGroups {
  owners = input.required<UserGroupsPerUser[]>();
  loading = input(false);
  status = input<PanelStatus | null>(null);
}
