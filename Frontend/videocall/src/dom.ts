/** A small helper so building a view reads as the view, not as `document.createElement` lines. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  class_name?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (class_name !== undefined) node.className = class_name;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The first letter of a name, for the avatar shown while a camera is off. */
export function initial(name: string): string {
  const first = [...name.trim()][0];
  return first === undefined ? "?" : first.toUpperCase();
}
