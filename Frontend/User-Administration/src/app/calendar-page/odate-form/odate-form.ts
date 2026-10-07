import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Markdown } from '../../markdown';
import { NewOdate, Odate, OdateLocation, OdateType } from '../../odate-api';

/**
 * Whether the device points with something coarse — a finger rather than a mouse. Guards the
 * property too, because `matchMedia` is not there in every environment the tests run in.
 */
function pointsWithAFinger(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/**
 * Epoch milliseconds as the value a `datetime-local` field wants: a wall-clock string with no
 * zone, in the browser's own zone. Built from the local getters rather than from `toISOString`,
 * which answers in UTC and would shift the time by the offset without saying so.
 */
function toLocalInput(ms: number): string {
  const at = new Date(ms);
  const pad = (part: number) => String(part).padStart(2, '0');
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

/** Just enough of a field to be given a value, whatever kind of control it is. */
type FieldRef = { nativeElement: { value: string } } | undefined;

/**
 * The form for a calendar entry — a new one, or one being changed.
 *
 * Folded away behind a button until it is wanted. The button and the form replace one another
 * rather than the form appearing below a button that stays put, so there is one thing to press
 * either way round: "Add an entry" while it is closed, "Cancel" while it is open. Focus follows
 * — into the first field on opening, back to the button on closing — so a keyboard is not left
 * on an element that has gone.
 *
 * Which of the two it is doing comes from `editing`: an entry to change, or null to make a new
 * one. It is a `model` so that closing the form clears it in the page that opened it.
 *
 * The two times are the only things it insists on; the server insists on one more that the
 * browser cannot check — that the end comes after the start — and says so in its own words, so
 * there is no second copy of that rule here.
 */
@Component({
  selector: 'app-odate-form',
  imports: [],
  templateUrl: './odate-form.html',
  styleUrl: './odate-form.css',
})
export class OdateForm {
  private markdown = inject(Markdown);

  locations = input<OdateLocation[]>([]);
  types = input<OdateType[]>([]);
  saving = input(false);

  /** The entry being changed, or null when the form is for a new one. */
  editing = model<Odate | null>(null);

  create = output<NewOdate>();
  update = output<{ id: number; entry: NewOdate }>();

  /** Whether the form is open for a *new* entry. Editing opens it by itself. */
  private makingNew = signal(false);

  /** Whether the notes are being shown rendered rather than as markdown. */
  previewing = signal(false);

  /**
   * The notes text as it was when the preview was opened. Taken then rather than bound live,
   * because the textarea is read from the DOM: a preview that updated as you type would need the
   * value in a signal, and the whole form reads its fields the one way.
   */
  previewSource = signal('');

  /** Null until the renderer has loaded, so the caller knows to show the text as it stands. */
  previewHtml = computed(() => this.markdown.render(this.previewSource()));

  expanded = computed(() => this.editing() !== null || this.makingNew());
  isEditing = computed(() => this.editing() !== null);

  /**
   * What the two dropdowns offer: the caller's own list, plus whatever the entry being changed
   * names if it is not already in it.
   *
   * A select whose value matches no option falls back to the first one, which here means "No
   * location" — so an entry whose location was missing from a list that failed to load would be
   * shown as having none, and saving it would quietly take the location away. Adding it to the
   * options is what stops a failed read becoming a lost field.
   */
  locationOptions = computed<OdateLocation[]>(() => {
    const list = this.locations();
    const current = this.editing()?.location;
    if (!current || list.some(place => place.id === current.id)) return list;

    // An entry's location carries a little less than the list's own does — no timezone, and no
    // last_used — so those are filled in. Its point is carried through: an option only needs the
    // name, but throwing away where it is would be a lie about a value that came back.
    return [...list, { ...current, timezone: null, last_used: null }];
  });

  typeOptions = computed<OdateType[]>(() => {
    const list = this.types();
    const current = this.editing()?.type;
    if (!current || list.some(type => type.id === current.id)) return list;

    return [...list, current];
  });

  private triggerButton = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private startField = viewChild<ElementRef<HTMLInputElement>>('newStart');
  private endField = viewChild<ElementRef<HTMLInputElement>>('newEnd');
  private descriptionField = viewChild<ElementRef<HTMLInputElement>>('newDescription');
  private notesField = viewChild<ElementRef<HTMLTextAreaElement>>('newNotes');
  private locationSelect = viewChild<ElementRef<HTMLSelectElement>>('newLocation');
  private typeSelect = viewChild<ElementRef<HTMLSelectElement>>('newType');

  /**
   * Set when the form closes, cleared once focus has been handed back to the button. It has to
   * outlive a single effect run: the effect fires before the view is updated, so on the run that
   * notices the close the button is not on the page yet — only a later run, triggered by the
   * query itself, can see it.
   */
  private returningFocus = false;

  constructor() {
    effect(() => {
      const expanded = this.expanded();
      const field = this.startField();
      const trigger = this.triggerButton();

      if (expanded) {
        this.returningFocus = false;
        // Not on a touch screen. There, moving focus into a field opens the soft keyboard — or,
        // for a date field, the date picker — so opening the form would put the picker over the
        // form before anyone had read it. The fields are there to be tapped instead.
        if (!pointsWithAFinger()) field?.nativeElement.focus();
        return;
      }

      if (this.returningFocus && trigger) {
        trigger.nativeElement.focus();
        this.returningFocus = false;
      }
    });

    effect(() => {
      const entry = this.editing();
      if (entry === null) return;

      // Reading a field is what makes this effect run again once the view has rendered them;
      // on the run that notices the entry there is nothing to fill yet.
      if (!this.startField()) return;
      this.previewing.set(false); // a preview of the last entry is not a preview of this one
      this.fill(entry);
    });
  }

  open() {
    this.makingNew.set(true);
  }

  /**
   * Gives an entry that has no end yet the start it was given, an hour later.
   *
   * The hour is the difference between a suggestion and a refusal: an end equal to the start is
   * an entry of no length, which the server turns down in its own words — "An entry has to end
   * after it starts" — and this form has never kept a second copy of that rule. An hour is a
   * guess, but it is an entry somebody can correct rather than one they have to correct.
   *
   * Done on arriving in the field rather than by watching the one above it: the point is not to
   * type the same date twice, and by the time somebody is in this field they have already said
   * when the entry starts. A second thought about the start must not move the end, so an end
   * that has been given — which is every end on a form opened to change an entry — is left
   * exactly as it is.
   */
  fillEndFromStart() {
    const start = this.startField()?.nativeElement;
    const end = this.endField()?.nativeElement;
    if (!start || !end) return;
    if (start.value === '' || end.value !== '') return;

    // Through a Date and back out in the field's own form: an hour added across midnight lands
    // on the next day, and across a daylight-saving change on a time that exists, which adding
    // an hour to the text would not. A datetime-local value carries no zone, so it is read as
    // local time — the one date form that is, and the reason this is safe.
    const anHourOn = new Date(start.value).getTime() + 60 * 60 * 1000;
    end.value = toLocalInput(anHourOn);
  }

  /**
   * Swaps the notes between markdown and its rendering. The textarea is hidden rather than
   * removed, so what has been typed is still there — and still there to be read at submit.
   */
  togglePreview() {
    if (!this.previewing()) {
      this.previewSource.set(this.notesField()?.nativeElement.value ?? '');
      // Kicked off here as well as on the page, so the button works even if that load failed.
      void this.markdown.load();
    }
    this.previewing.update(on => !on);
  }

  close() {
    this.editing.set(null);
    this.makingNew.set(false);
    this.previewing.set(false);
    this.returningFocus = true;
  }

  submit(event: Event) {
    event.preventDefault(); // a (submit) binding does not stop the native GET

    const entry = this.readFields();
    if (entry === null) return;

    const editing = this.editing();
    if (editing) this.update.emit({ id: editing.id, entry });
    else this.create.emit(entry);
  }

  /** The fields as an entry, or null when the times are not filled in well enough to send. */
  private readFields(): NewOdate | null {
    const start = new Date(this.startField()?.nativeElement.value ?? '').getTime();
    const end = new Date(this.endField()?.nativeElement.value ?? '').getTime();
    // An empty or half-typed box is not a date; the browser's own `required` catches most of
    // that, and this catches the rest rather than sending NaN as a time.
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

    const description = this.descriptionField()?.nativeElement.value.trim() ?? '';
    const notes = this.notesField()?.nativeElement.value.trim() ?? '';
    const locationId = Number(this.locationSelect()?.nativeElement.value);
    const typeId = Number(this.typeSelect()?.nativeElement.value);

    return {
      start_time: start,
      end_time: end,
      // Left out rather than sent empty: the columns are nullable, and an empty box means "none"
      // rather than an empty string.
      ...(description ? { description } : {}),
      ...(notes ? { memo_text: notes } : {}),
      ...(locationId ? { location_id: locationId } : {}),
      ...(typeId ? { type: typeId } : {}),
    };
  }

  /** Puts an entry into the fields, so it can be changed rather than typed again. */
  private fill(entry: Odate) {
    const values: [FieldRef, string][] = [
      [this.startField(), toLocalInput(entry.start_time)],
      [this.endField(), toLocalInput(entry.end_time)],
      [this.descriptionField(), entry.description ?? ''],
      [this.notesField(), entry.memo_text ?? ''],
      // The empty option is "no location", so an entry without one selects that.
      [this.locationSelect(), entry.location ? String(entry.location.id) : ''],
      [this.typeSelect(), entry.type ? String(entry.type.id) : ''],
    ];

    for (const [field, value] of values) {
      if (field) field.nativeElement.value = value;
    }
  }

  /**
   * Empties the fields, for the page to call once the server has taken a new entry. The form
   * stays open, so a second one can be typed straight away; the fields are read from the DOM at
   * submit, so this is the only place that clears them.
   */
  clear() {
    this.previewing.set(false);
    for (const field of [
      this.startField(),
      this.endField(),
      this.descriptionField(),
      this.notesField(),
    ]) {
      if (field) field.nativeElement.value = '';
    }
  }
}
