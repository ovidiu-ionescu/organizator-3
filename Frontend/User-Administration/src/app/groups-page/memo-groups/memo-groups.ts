import { Component, ElementRef, effect, input, output, signal, viewChild, viewChildren } from '@angular/core';
import {
  ACCESS_LEVELS,
  MemoGroup,
  MemoGroupAccess,
  PanelStatus,
  UserGroup,
  accessShort,
} from '../../groups-api';

/** What a grant row emits when its level changes, and what "no access" means to it. */
const NO_ACCESS = 0;

/**
 * The memo groups the visitor can see — their own, plus the admin's public ones — and which
 * user groups have access to each.
 *
 * The access level is the whole point of a memo group, so it is a control on the row rather
 * than something to open: changing it sends the new level straight away, and "no access" is
 * the absence of the grant, which is what revoking does.
 */
@Component({
  selector: 'app-memo-groups',
  imports: [],
  templateUrl: './memo-groups.html',
  styleUrl: './memo-groups.css',
})
export class MemoGroups {
  groups = input.required<MemoGroup[]>();
  /** The visitor's own user groups, which are the ones they may grant. */
  userGroups = input<UserGroup[]>([]);
  /** Who the visitor is, so a public group owned by someone else is not shown as theirs. */
  requesterId = input<number | null>(null);
  /** Only an admin may decide that a memo group is visible to everyone. */
  isAdmin = input(false);
  loading = input(false);
  saving = input(false);
  status = input<PanelStatus | null>(null);

  create = output<{ name: string; public: boolean }>();
  rename = output<{ group: MemoGroup; name: string }>();
  setPublic = output<{ group: MemoGroup; public: boolean }>();
  grant = output<{ group: MemoGroup; userGroupId: number; access: number }>();
  revoke = output<{ group: MemoGroup; userGroup: { id: number; name: string } }>();
  remove = output<MemoGroup>();

  readonly accessLevels = ACCESS_LEVELS;

  renamingId = signal<number | null>(null);
  confirmingDeleteId = signal<number | null>(null);

  private renameField = viewChild<ElementRef<HTMLInputElement>>('renameField');

  /** The create form's "public" box, which only an admin is given. */
  private newGroupPublic = viewChild<ElementRef<HTMLInputElement>>('newGroupPublic');

  /** Where focus goes when a delete removes the row that had it. */
  private heading = viewChild<ElementRef<HTMLHeadingElement>>('panelHeading');
  private renameButtons = viewChildren<ElementRef<HTMLButtonElement>>('renameButton');
  private deleteButtons = viewChildren<ElementRef<HTMLButtonElement>>('deleteButton');
  private confirmButtons = viewChildren<ElementRef<HTMLButtonElement>>('confirmDeleteButton');

  /** See UserGroups: set on close, cleared once the view has the trigger back to focus. */
  private pendingFocus: { trigger: 'rename' | 'delete'; id: number } | null = null;

  /**
   * The picker that was just changed, and the level the model actually holds for it. A change
   * the server refuses leaves the control showing a level that was never stored, and Angular
   * will not write the old one back by itself: the level did not change, so the binding did
   * not change either. Put it back by hand when the answer comes in.
   */
  private pendingSelect: { select: HTMLSelectElement; access: number } | null = null;

  constructor() {
    effect(() => {
      const status = this.status();
      const pending = this.pendingSelect;
      if (pending === null || status === null) return;

      if (status.error) pending.select.value = String(pending.access);
      this.pendingSelect = null;
    });

    effect(() => {
      const renaming = this.renamingId();
      const confirming = this.confirmingDeleteId();
      const field = this.renameField();
      const renameTriggers = this.renameButtons();
      const deleteTriggers = this.deleteButtons();
      const confirmTriggers = this.confirmButtons();
      // Read so that this effect runs again when a save finishes — that is when the trigger
      // becomes focusable again, having been disabled for the length of the request.
      const saving = this.saving();

      if (renaming !== null) {
        this.pendingFocus = null;
        field?.nativeElement.focus();
        return;
      }
      if (confirming !== null) {
        this.pendingFocus = null;
        this.trigger(confirmTriggers, 'mg-confirm-delete', confirming)?.nativeElement.focus();
        return;
      }

      const pending = this.pendingFocus;
      if (pending === null) return;

      const triggers = pending.trigger === 'rename' ? renameTriggers : deleteTriggers;
      const trigger = this.trigger(triggers, `mg-${pending.trigger}`, pending.id);

      // A disabled control cannot take focus, and a save disables its own trigger the moment
      // it starts. Waiting for saving to go back down is what stops focus falling to the
      // body after every rename; the read of saving() above is what brings this effect back.
      if (trigger && !saving) {
        trigger.nativeElement.focus();
        this.pendingFocus = null;
      }
    });
  }

  /**
   * Whether this memo group is the visitor's to change. A public group owned by an admin is
   * shown to everyone but may only be changed by its owner, and the endpoint does not say who
   * that is yet — so an unknown owner lets the attempt through and lets the server refuse,
   * rather than hiding a control on a guess.
   */
  isEditable(group: MemoGroup): boolean {
    const requesterId = this.requesterId();
    if (group.owner == null || requesterId == null) return true;

    // 0 is what db.rs reports as the requester for the admin account — it switches the
    // session to set_admin_user.sql, which sets the current user to 0 — while the seeded
    // public memo groups are owned by user 1. Comparing those would take every control away
    // from the one account that owns them, so 0 counts as "not an id", like a missing owner.
    if (requesterId === 0) return true;

    return group.owner.id === requesterId;
  }

  /** The badge letter for an access level, matching what the Memo app prints. */
  short(access: number): string {
    return accessShort(access);
  }

  /** The own user groups not yet granted on this memo group, for the grant control. */
  available(group: MemoGroup): UserGroup[] {
    return this.userGroups().filter(
      candidate => !group.usergroups.some(granted => granted.id === candidate.id)
    );
  }

  statusFor(group: MemoGroup): PanelStatus | null {
    const message = this.status();
    return message !== null && message.id === group.id ? message : null;
  }

  /** The message the panel speaks for itself: one loading failed, or a group was deleted. */
  panelStatus(): string {
    const message = this.status();
    return message !== null && message.id === null ? message.text : '';
  }

  /**
   * True once a load has failed. The empty-list message has to keep quiet then: "no memo
   * groups" under "failed to load your memo groups" says the groups are gone when the
   * request merely failed.
   */
  failed(): boolean {
    return this.status()?.error === true;
  }

  openRename(group: MemoGroup) {
    this.confirmingDeleteId.set(null);
    this.renamingId.set(group.id);
  }

  cancelRename() {
    this.close('rename');
  }

  submitRename(group: MemoGroup, field: HTMLInputElement, event: Event) {
    event.preventDefault(); // a (submit) binding does not stop the native GET

    const name = field.value.trim();
    if (!name || name === group.name) {
      this.close('rename');
      return;
    }

    this.rename.emit({ group, name });
    this.close('rename');
  }

  confirmDelete(group: MemoGroup) {
    if (this.confirmingDeleteId() === group.id) {
      // The row is about to go, so its trigger cannot take focus back: the heading can, and
      // it tells a screen reader which list it has landed in.
      this.confirmingDeleteId.set(null);
      this.pendingFocus = null;
      this.heading()?.nativeElement.focus();
      this.remove.emit(group);
      return;
    }
    this.renamingId.set(null);
    this.confirmingDeleteId.set(group.id);
  }

  cancelDelete() {
    this.close('delete');
  }

  createGroup(field: HTMLInputElement, event: Event) {
    event.preventDefault();

    const name = field.value.trim();
    if (!name) return;

    // The checkbox only exists for an admin — it is behind an @if, which puts it out of the
    // form's reach as a template variable — so a query is how it is read. Its absence is a
    // group of one's own, which is what a non-admin creates.
    const publicField = this.newGroupPublic()?.nativeElement;

    this.create.emit({ name, public: publicField?.checked === true });
    field.value = '';
    if (publicField) publicField.checked = false;
  }

  /**
   * Whether the visibility control belongs on this group at all. It needs both the right to
   * set it and a value to show: with `public` absent the server has not said which the group
   * is, and a checkbox would have to invent an answer.
   */
  showsVisibility(group: MemoGroup): boolean {
    return this.isAdmin() && group.public !== undefined;
  }

  changeVisibility(group: MemoGroup, box: HTMLInputElement) {
    this.setPublic.emit({ group, public: box.checked });
  }

  /** The level on one grant changed. "No access" is not a level: it removes the grant. */
  changeAccess(group: MemoGroup, grant: MemoGroupAccess, select: HTMLSelectElement) {
    // Remembered before the answer is known, so a refusal can put the control back.
    this.pendingSelect = { select, access: grant.access };

    const access = Number(select.value);
    if (access === NO_ACCESS) {
      this.revoke.emit({ group, userGroup: { id: grant.id, name: grant.name } });
      return;
    }
    this.grant.emit({ group, userGroupId: grant.id, access });
  }

  addGrant(
    group: MemoGroup,
    userGroupSelect: HTMLSelectElement,
    accessSelect: HTMLSelectElement,
    event: Event
  ) {
    event.preventDefault();

    const userGroupId = Number(userGroupSelect.value);
    if (!userGroupId) return;

    // The level comes from its own control, so what is granted is what was asked for. The
    // picker only offers levels this build knows, and read is the fallback if it somehow
    // offers none — never more than was chosen.
    const access =
      ACCESS_LEVELS.find(level => level.value === Number(accessSelect.value))?.value ?? 1;

    this.grant.emit({ group, userGroupId, access });
  }

  private close(trigger: 'rename' | 'delete') {
    const id = trigger === 'rename' ? this.renamingId() : this.confirmingDeleteId();
    if (trigger === 'rename') {
      this.renamingId.set(null);
    } else {
      this.confirmingDeleteId.set(null);
    }
    if (id !== null) this.pendingFocus = { trigger, id };
  }

  private trigger(
    buttons: readonly ElementRef<HTMLButtonElement>[],
    prefix: string,
    id: number
  ): ElementRef<HTMLButtonElement> | undefined {
    return buttons.find(candidate => candidate.nativeElement.id === `${prefix}-${id}`);
  }
}
