/**
 * @prettier
 *
 * Inlines an SVG image so that it can be manipulated by CSS
 */
import konsole from "./console_log.js";

export class ImgInlineSvg extends HTMLElement {
  _color() {
    const fillColor = getComputedStyle(this).color || "white";
    // No shadow root yet means no svg to colour — which is the case for an element whose src was
    // set after it was built, and is not worth throwing over.
    const svg = this.shadowRoot?.querySelector("svg");
    if (svg) {
      svg.style.fill = fillColor;
    }
  }

  constructor() {
    super();
    const imgSrc = this.getAttribute("src");
    if(!imgSrc) {
      konsole.error("ImgInlineSvg needs a src");
      return
    }
    const shadow = this.attachShadow({ mode: "open" });
    fetch(imgSrc)
      .then((response) => response.text())
      .then((svgText) => {
        shadow.innerHTML = `
        <style>
        :host {
            display: inline-block;
        }
        svg {
            width: 100%;
            height: 100%;
        }
        </style>        
        ${svgText}
        `;
        this._color();
      });
  }

  connectedCallback() {
    this._color();
  }

  static get observedAttributes() {
    return ["src", "style"];
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (name === "style") {
      this._color();
    }
  }
}
customElements.define("img-inline-svg", ImgInlineSvg);
