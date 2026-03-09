import { render } from "effect-atom-jsx";
import { App } from "./App.js";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element found");

const dispose = render(() => App({}), root);

if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}
