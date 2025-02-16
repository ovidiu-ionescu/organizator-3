/**
 * @prettier
 *
 * Inlines an SVG image so that it can be manipulated by CSS
 */

export class ImgInlineSvg extends HTMLElement {
  _color() {
    const fillColor = getComputedStyle(this).color || "white";
    const svg = this.shadowRoot.querySelector("svg");
    if (svg) {
      svg.style.fill = fillColor;
    }
  }

  constructor() {
    super();
    const imgSrc = this.getAttribute("src");
    const shadow = this.attachShadow({ mode: "open" });
    fetch(imgSrc)
      .then((response) => response.text())
      .then((text) => {
        const mySvg = text;
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
        ${mySvg}
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
