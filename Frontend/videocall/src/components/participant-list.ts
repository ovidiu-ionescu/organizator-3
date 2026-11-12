import { el, initial } from "../dom";
import { short_quality } from "../quality";
import type { Quality } from "../quality";

export type ParticipantView = {
  id: string;
  name: string;
  self: boolean;
  audio: boolean;
  video: boolean;
  screen: boolean;
  quality: Quality;
};

/**
 * The room roster. It is rebuilt rather than patched: a room holds a handful of people, and the
 * list is the one place where "who is here and what is on" has to be true at a glance.
 */
export class ParticipantList extends HTMLElement {
  constructor() {
    super();
    this.classList.add("participant-list");
  }

  set participants(people: ParticipantView[]) {
    const list = el("ul", "participant-list-items");
    for (const person of people) {
      const item = el("li", "participant");
      if (person.self) item.classList.add("self");

      const avatar = el("span", "participant-avatar", initial(person.name));
      avatar.setAttribute("aria-hidden", "true");

      const body = el("span", "participant-body");
      const name = el("span", "participant-name", person.name);
      if (person.self) name.append(el("span", "participant-you", " (you)"));
      const status = el("span", "participant-status");
      const flags: string[] = [];
      if (person.screen) flags.push("Sharing screen");
      if (!person.audio) flags.push("Muted");
      if (!person.video) flags.push("Camera off");

      // The local preview has no connection of its own to measure.
      if (!person.self) {
        const dot = el("span", `quality-dot quality-${person.quality}`);
        dot.title = short_quality(person.quality);
        status.append(dot, el("span", "", short_quality(person.quality)));
        if (flags.length > 0) {
          status.append(el("span", "participant-flag", ` · ${flags.join(" · ")}`));
        }
      } else if (flags.length > 0) {
        status.append(el("span", "participant-flag", flags.join(" · ")));
      }
      status.hidden = status.childElementCount === 0;

      body.append(name, status);
      item.append(avatar, body);
      list.append(item);
    }
    this.replaceChildren(list);
  }
}

if (customElements.get("vc-participant-list") === undefined) {
  customElements.define("vc-participant-list", ParticipantList);
}
