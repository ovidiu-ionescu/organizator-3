import { Component, ElementRef, effect, input, output, signal, viewChild, viewChildren } from '@angular/core';
import { PanelStatus, UserGroup } from '../../groups-api';

/**
 * The user groups the visitor owns, with their members.
 *
 * An empty group is an ordinary state here, not a gap: it is what a group looks like
 * between being created and being filled, so it keeps its member field open and says so.
 * The panel only ever holds groups the visitor owns — the endpoint returns no others — so
 * everything on it is theirs to change.
 */
@Component({
  selector: 'app-user-groups',
  imports: [],
  templateUrl: './user-groups.html',
  styleUrl: './user-groups.css',
})
export class UserGroups {
  groups = input.required<UserGroup[]>();
  /** Names to suggest in the member field. Empty for a non-admin, which is not an error. */
  usernames = input<string[]>([]);
  loading = input(false);
  saving = input(false);
  status = input<PanelStatus | null>(null);

  create = output<string>();
  rename = output<{ group: UserGroup; name: string }>();
  addMember = output<{ group: UserGroup; username: string }>();
  removeMember = output<{ group: UserGroup; username: string }>();
  remove = output<UserGroup>();

  /** The group whose rename field is open, or whose deletion is being confirmed. */
  renamingId = signal<number | null>(null);
  confirmingDeleteId = signal<number | null>(null);

  private renameField = viewChild<ElementRef<HTMLInputElement>>('renameField');

  /** Where focus goes when a delete removes the row that had it. */
  private heading = viewChild<ElementRef<HTMLHeadingElement>>('panelHeading');

  /** Every row's triggers. Only the idle rows render them, which is why these are not viewChild. */
  private renameButtons = viewChildren<ElementRef<HTMLButtonElement>>('renameButton');
  private deleteButtons = viewChildren<ElementRef<HTMLButtonElement>>('deleteButton');
  private confirmButtons = viewChildren<ElementRef<HTMLButtonElement>>('confirmDeleteButton');

  /**
   * Set when a form closes, cleared once focus is back on that row's trigger. It has to
   * outlive a single effect run: the effect fires before the view is updated, so on the run
   * that notices the close the trigger is not on the page yet — only a later run, triggered
   * by the query itself, can see it. Same reasoning as the password form in user-list.
   */
  private pendingFocus: { trigger: 'rename' | 'delete'; id: number } | null = null;

  constructor() {
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

      // Something just opened: put focus in it rather than making the visitor tab onwards.
      if (renaming !== null) {
        this.pendingFocus = null;
        field?.nativeElement.focus();
        return;
      }
      if (confirming !== null) {
        this.pendingFocus = null;
        this.trigger(confirmTriggers, 'ug-confirm-delete', confirming)?.nativeElement.focus();
        return;
      }

      const pending = this.pendingFocus;
      if (pending === null) return;

      const triggers = pending.trigger === 'rename' ? renameTriggers : deleteTriggers;
      const trigger = this.trigger(triggers, `ug-${pending.trigger}`, pending.id);

      // A disabled control cannot take focus, and a save disables its own trigger the moment
      // it starts. Waiting for saving to go back down is what stops focus falling to the
      // body after every rename; the read of saving() above is what brings this effect back.
      if (trigger && !saving) {
        trigger.nativeElement.focus();
        this.pendingFocus = null;
      }
    });
  }

  openRename(group: UserGroup) {
    this.confirmingDeleteId.set(null);
    this.renamingId.set(group.id);
  }

  cancelRename() {
    this.close('rename');
  }

  submitRename(group: UserGroup, field: HTMLInputElement, event: Event) {
    event.preventDefault(); // a (submit) binding does not stop the native GET

    const name = field.value.trim();
    if (!name || name === group.name) {
      this.close('rename');
      return;
    }

    this.rename.emit({ group, name });
    this.close('rename');
  }

  confirmDelete(group: UserGroup) {
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

  /** Closes whichever form is open and leaves the effect to hand focus back to its trigger. */
  private close(trigger: 'rename' | 'delete') {
    const id = trigger === 'rename' ? this.renamingId() : this.confirmingDeleteId();
    if (trigger === 'rename') {
      this.renamingId.set(null);
    } else {
      this.confirmingDeleteId.set(null);
    }
    if (id !== null) this.pendingFocus = { trigger, id };
  }

  submitMember(group: UserGroup, field: HTMLInputElement, event: Event) {
    event.preventDefault();

    const username = field.value.trim();
    if (!username) return;

    this.addMember.emit({ group, username });
    field.value = ''; // the field stays open, ready for the next member
  }

  createGroup(field: HTMLInputElement, event: Event) {
    event.preventDefault();

    const name = field.value.trim();
    if (!name) return;

    this.create.emit(name);
    field.value = '';
  }

  /** The message about this group, or none. The panel-wide one is rendered once, above. */
  statusFor(group: UserGroup): PanelStatus | null {
    const message = this.status();
    return message !== null && message.id === group.id ? message : null;
  }

  /** The message the panel speaks for itself: one loading failed, or a group was deleted. */
  panelStatus(): string {
    const message = this.status();
    return message !== null && message.id === null ? message.text : '';
  }

  /**
   * True once a load has failed. The empty-list message has to keep quiet then: "you have no
   * user groups" under "failed to load your user groups" tells the visitor their groups are
   * gone when the request merely failed.
   */
  failed(): boolean {
    return this.status()?.error === true;
  }

  dropMember(group: UserGroup, username: string) {
    this.removeMember.emit({ group, username });
  }

  private trigger(
    buttons: readonly ElementRef<HTMLButtonElement>[],
    prefix: string,
    id: number
  ): ElementRef<HTMLButtonElement> | undefined {
    return buttons.find(candidate => candidate.nativeElement.id === `${prefix}-${id}`);
  }
}
