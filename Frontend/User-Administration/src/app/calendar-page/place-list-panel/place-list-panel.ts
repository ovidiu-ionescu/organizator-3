import { Component, ElementRef, effect, input, output, signal, viewChild, viewChildren } from '@angular/core';
import { Coordinates, formatCoordinates, mapUrl, parseCoordinates } from '../coordinates';
import { PanelStatus } from '../../panel-status';

/**
 * A name the panel lists.
 *
 * The coordinates are absent for a list that has none — a date type is only a name. Where they
 * are there, they are carried back unchanged on a change, because the server replaces the whole
 * row: a field the form does not hold would be emptied by a save that did not mention it.
 */
export interface PlaceOnAList {
  id: number;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  timezone?: string | null;
}

/**
 * One of the two name lists the entry form picks from: where an entry happened, and what kind of
 * thing it was.
 *
 * Both lists are the same thing — names the visitor owns, each with an edit and a delete beside
 * it and a field for the next one — so this is one component rendered twice with different words,
 * rather than two that would have to be kept in step. Everything that differs between them is an
 * input, including the id prefix, because a location and a date type can share a number.
 *
 * A location may also carry a latitude and longitude. They are typed or pasted as the pair a map
 * hands you, and shown with a link out to that point on Google Maps — a plain URL, so there is no
 * key and no third-party script in the page.
 *
 * A name an entry still uses cannot be deleted: the server refuses and says how many entries hold
 * it. Nothing is guarded here beyond the inline confirm — the refusal arrives as a message, and
 * it is the server's rule to enforce.
 */
@Component({
  selector: 'app-place-list-panel',
  imports: [],
  templateUrl: './place-list-panel.html',
  styleUrl: './place-list-panel.css',
})
export class PlaceListPanel {
  /** What this list is called, and what one of its rows is: "Locations" / "New location". */
  heading = input.required<string>();
  newLabel = input.required<string>();
  placeholder = input.required<string>();
  /** Shown when the list is empty and the read did not fail. */
  emptyText = input.required<string>();
  /** Prefix for every element id, so the two panels on the page cannot collide. */
  idPrefix = input.required<string>();
  /** Whether a row can carry a place on the earth, which only a location can. */
  withCoordinates = input(false);

  places = input<PlaceOnAList[]>([]);
  loading = input(false);
  saving = input(false);
  status = input<PanelStatus | null>(null);

  create = output<{ name: string; coordinates: Coordinates | null }>();
  edit = output<{ place: PlaceOnAList; name: string; coordinates: Coordinates | null }>();
  remove = output<PlaceOnAList>();

  /** The row whose field is open, or whose deletion is being confirmed. */
  editingId = signal<number | null>(null);
  confirmingDeleteId = signal<number | null>(null);

  /**
   * Set when the coordinate field held something that is not a pair. Kept here rather than sent
   * on: there is nothing to ask the server, and the visitor's typing has to stay where it is.
   */
  coordinateError = signal<string | null>(null);

  /** The words for the row action, which differ because a date type has only its name. */
  actionLabel = () => (this.withCoordinates() ? 'Edit' : 'Rename');

  readonly formatCoordinates = formatCoordinates;
  readonly mapUrl = mapUrl;

  private editField = viewChild<ElementRef<HTMLInputElement>>('editName');
  /** The coordinate box of the form that is open — the row being edited, or the create row. */
  private coordinateField = viewChild<ElementRef<HTMLInputElement>>('coordinates');
  private editCoordinateField = viewChild<ElementRef<HTMLInputElement>>('editCoordinates');

  /** Where focus goes when a delete removes the row that had it. */
  private panelHeading = viewChild<ElementRef<HTMLHeadingElement>>('panelHeading');

  /** Every row's triggers. Only the idle rows render them, which is why these are not viewChild. */
  private editButtons = viewChildren<ElementRef<HTMLButtonElement>>('editButton');
  private deleteButtons = viewChildren<ElementRef<HTMLButtonElement>>('deleteButton');
  private confirmButtons = viewChildren<ElementRef<HTMLButtonElement>>('confirmDeleteButton');

  /**
   * Set when a form closes, cleared once focus is back on that row's trigger. It has to outlive a
   * single effect run: the effect fires before the view is updated, so on the run that notices the
   * close the trigger is not on the page yet — only a later run, triggered by the query itself,
   * can see it. Same reasoning as the password form in user-list.
   */
  private pendingFocus: { trigger: 'edit' | 'delete'; id: number } | null = null;

  constructor() {
    effect(() => {
      const editing = this.editingId();
      const confirming = this.confirmingDeleteId();
      const field = this.editField();
      const editTriggers = this.editButtons();
      const deleteTriggers = this.deleteButtons();
      const confirmTriggers = this.confirmButtons();
      // Read so that this effect runs again when a save finishes — that is when the trigger
      // becomes focusable again, having been disabled for the length of the request.
      const saving = this.saving();

      // Something just opened: put focus in it rather than making the visitor tab onwards.
      if (editing !== null) {
        this.pendingFocus = null;
        field?.nativeElement.focus();
        return;
      }
      if (confirming !== null) {
        this.pendingFocus = null;
        this.trigger(confirmTriggers, 'confirm-delete', confirming)?.nativeElement.focus();
        return;
      }

      const pending = this.pendingFocus;
      if (pending === null) return;

      const triggers = pending.trigger === 'edit' ? editTriggers : deleteTriggers;
      const trigger = this.trigger(triggers, pending.trigger, pending.id);

      // A disabled control cannot take focus, and a save disables its own trigger the moment it
      // starts. Waiting for saving to go back down is what stops focus falling to the body after
      // every save; the read of saving() above is what brings this effect back.
      if (trigger && !saving) {
        trigger.nativeElement.focus();
        this.pendingFocus = null;
      }
    });
  }

  createPlace(nameField: HTMLInputElement, event: Event) {
    event.preventDefault(); // a (submit) binding does not stop the native GET

    const name = nameField.value.trim();
    if (!name) return; // a blank name never reaches the server

    const coordinates = this.readCoordinates(this.coordinateField());
    if (coordinates === undefined) return; // refused, and said so, without sending anything

    this.create.emit({ name, coordinates });
    nameField.value = ''; // cleared at once; a refusal is shown in the status line
    if (this.coordinateField()) this.coordinateField()!.nativeElement.value = '';
  }

  openEdit(place: PlaceOnAList) {
    this.coordinateError.set(null);
    this.confirmingDeleteId.set(null);
    this.editingId.set(place.id);
  }

  cancelEdit() {
    this.close('edit');
  }

  submitEdit(place: PlaceOnAList, nameField: HTMLInputElement, event: Event) {
    event.preventDefault();

    const name = nameField.value.trim();
    if (!name) return;

    const coordinates = this.readCoordinates(this.editCoordinateField());
    if (coordinates === undefined) return;

    // A save that would change nothing is not a change: the server would write the same row back
    // and say it had, so the form closes and nothing is asked of it. Same rule for the pair.
    if (name === place.name && samePoint(coordinates, this.coordinatesOf(place))) {
      this.close('edit');
      return;
    }

    this.edit.emit({ place, name, coordinates });
    this.close('edit');
  }

  confirmDelete(place: PlaceOnAList) {
    if (this.confirmingDeleteId() === place.id) {
      // The row is about to go, so its trigger cannot take focus back: the heading can, and it
      // tells a screen reader which list it has landed in.
      this.confirmingDeleteId.set(null);
      this.pendingFocus = null;
      this.panelHeading()?.nativeElement.focus();
      this.remove.emit(place);
      return;
    }
    this.editingId.set(null);
    this.confirmingDeleteId.set(place.id);
  }

  cancelDelete() {
    this.close('delete');
  }

  /** Closes whichever form is open and leaves the effect to hand focus back to its trigger. */
  private close(trigger: 'edit' | 'delete') {
    const id = trigger === 'edit' ? this.editingId() : this.confirmingDeleteId();
    if (trigger === 'edit') {
      this.editingId.set(null);
    } else {
      this.confirmingDeleteId.set(null);
    }
    if (id !== null) this.pendingFocus = { trigger, id };
  }

  /** The element id of a row's control, built from the panel's prefix so the two cannot clash. */
  controlId(kind: string, place: PlaceOnAList): string {
    return `${this.idPrefix()}-${kind}-${place.id}`;
  }

  controlIdOfNewField(kind: string): string {
    return `${this.idPrefix()}-new-${kind}`;
  }

  /** The row's coordinates, or null when it has none. */
  coordinatesOf(place: PlaceOnAList): Coordinates | null {
    if (place.latitude === null || place.latitude === undefined) return null;
    if (place.longitude === null || place.longitude === undefined) return null;
    return { latitude: place.latitude, longitude: place.longitude };
  }

  /** The row's coordinates as the field shows them when it opens, ready to be changed. */
  coordinatesText(place: PlaceOnAList): string {
    const at = this.coordinatesOf(place);
    return at === null ? '' : formatCoordinates(at);
  }

  /** The message about this row, or none. The panel-wide one is rendered once, above. */
  statusFor(place: PlaceOnAList): PanelStatus | null {
    const message = this.status();
    return message !== null && message.id === place.id ? message : null;
  }

  /** What the panel says about itself: a paste it could not read, or what the page reported. */
  panelStatus(): string {
    const complaint = this.coordinateError();
    if (complaint !== null) return complaint;

    const message = this.status();
    return message !== null && message.id === null ? message.text : '';
  }

  /** Whether what the panel is saying is a failure, so that it is coloured as one. */
  panelFailed(): boolean {
    return this.coordinateError() !== null || this.status()?.error === true;
  }

  /**
   * True once a load has failed. The empty-list message has to keep quiet then: "you have no
   * locations" under "could not read your locations" tells the visitor their locations are gone
   * when the request merely failed.
   */
  loadFailed(): boolean {
    return this.status()?.error === true;
  }

  /**
   * What the coordinate field holds: the pair, null when it was left empty, or undefined when it
   * held something that is not a pair — which is reported here rather than sent to the server,
   * and which leaves what was typed where it is.
   */
  private readCoordinates(field: ElementRef<HTMLInputElement> | undefined): Coordinates | null | undefined {
    if (field === undefined) return null;

    const text = field.nativeElement.value.trim();
    if (text === '') return null;

    const at = parseCoordinates(text);
    if (at !== null) {
      this.coordinateError.set(null);
      return at;
    }

    this.coordinateError.set(
      `“${text}” is not a latitude and longitude. Paste them as 44.4268, 26.1025.`
    );
    return undefined;
  }

  private trigger(
    buttons: readonly ElementRef<HTMLButtonElement>[],
    kind: string,
    id: number
  ): ElementRef<HTMLButtonElement> | undefined {
    const wanted = `${this.idPrefix()}-${kind}-${id}`;
    return buttons.find(candidate => candidate.nativeElement.id === wanted);
  }
}

/** Whether two points are the same, treating two absences as the same point. */
function samePoint(a: Coordinates | null, b: Coordinates | null): boolean {
  if (a === null || b === null) return a === b;
  return a.latitude === b.latitude && a.longitude === b.longitude;
}
