import "./styles.css";

import { start } from "./app";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) {
  throw new Error("The page has no #app element to mount the video call into.");
}
void start(root);
