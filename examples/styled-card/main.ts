import { renderWithHMR, type ViteHotContext } from "effect-atom-jsx/internals";
import { App } from "./App.js";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element found");

const hot = (import.meta as ImportMeta & { hot?: ViteHotContext }).hot;
renderWithHMR(() => App(), root, hot, "example:styled-card");
