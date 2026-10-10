import { describe, it, expect, afterEach } from "vitest";
// The palettes. Imported here as the page imports them, so that a mistake in the stylesheet —
// a selector that matches nothing, a variable named differently from the one the editor reads —
// shows up as a failing expectation rather than as a memo that is quietly still dark.
import "../../src/html/themes.css";
import { raspandac } from "@dom/events.js";
// Registered by the import; the type comes separately, as with the other elements.
import "@dom/theme-list.js";
import type { ThemeList } from "@dom/theme-list.js";
import {
  apply_theme,
  current_theme,
  stored_theme,
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
} from "@dom/theme.js";

// The theme is a preference the app keeps on the device: an attribute on <html> for the stylesheet
// to key off, and the same name in localStorage for the next start. Nothing here goes near memo
// data — a theme is how this device displays memos, not something about a memo.

const make_picker = (): ThemeList => {
  document.body.innerHTML = '<theme-list id="list"></theme-list>';
  return document.getElementById("list") as ThemeList;
};

const select_of = (picker: ThemeList): HTMLSelectElement =>
  picker.shadowRoot?.querySelector("#main_select") as HTMLSelectElement;

describe("Themes", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    // Both have to go: a theme left on <html> would follow the next test into the stylesheet, and
    // one left in storage would decide the next test's default.
    delete document.documentElement.dataset.theme;
    localStorage.clear();
  });

  it("should start on the default when nothing has been chosen", () => {
    expect(stored_theme()).to.be.equal(DEFAULT_THEME);
    expect(current_theme()).to.be.equal(DEFAULT_THEME);
  });

  it("should not trust a stored value that is not a theme", () => {
    // An older name, or something typed into storage by hand. A page keyed off a theme that does
    // not exist has no colours at all, so anything unrecognised is the default.
    localStorage.setItem(THEME_STORAGE_KEY, "banana");
    expect(stored_theme()).to.be.equal(DEFAULT_THEME);

    const picker = make_picker();
    expect(select_of(picker).value).to.be.equal(DEFAULT_THEME);
    expect(document.documentElement.dataset.theme).to.be.equal(DEFAULT_THEME);
  });

  it("should apply a theme to the page, keep it, and say so", () => {
    const heard: string[] = [];
    const listener = (event: CustomEvent<string>) => heard.push(event.detail);
    raspandac.on("themeChanged", listener as (event: CustomEvent<string>) => void);

    apply_theme("paper");

    raspandac.removeEventListener("themeChanged", listener);
    expect(document.documentElement.dataset.theme).to.be.equal("paper");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).to.be.equal("paper");
    expect(heard).to.deep.equal(["paper"]);
  });

  it("should give every theme a palette", () => {
    // The variables the editor and the page read. If a theme block is misspelled, or a variable is
    // named differently on the two sides, this is what says so.
    const wanted = [
      "--memo-bg",
      "--memo-fg",
      "--memo-font",
      "--memo-link",
      "--memo-border",
      "--memo-link-hover-bg",
    ];
    for (const theme of THEMES) {
      document.documentElement.dataset.theme = theme.id;
      const style = getComputedStyle(document.documentElement);
      for (const variable of wanted) {
        expect(style.getPropertyValue(variable).trim(), `${theme.id} ${variable}`).not.to.be.equal("");
      }
    }
  });

  it("should offer every theme in the picker", () => {
    const picker = make_picker();
    const options = Array.from(select_of(picker).options).map((option) => option.value);
    expect(options).to.deep.equal(THEMES.map((theme) => theme.id));
  });

  it("should show and apply the theme the picker is changed to", () => {
    const picker = make_picker();
    const select = select_of(picker);
    expect(select.value).to.be.equal(DEFAULT_THEME);

    select.value = "links";
    select.dispatchEvent(new Event("change"));

    expect(document.documentElement.dataset.theme).to.be.equal("links");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).to.be.equal("links");
    // And it is the picker's answer, so reopening the app comes back to it.
    expect(stored_theme()).to.be.equal("links");
  });
});
