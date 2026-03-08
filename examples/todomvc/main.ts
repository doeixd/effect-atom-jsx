import { mount } from "effect-atom-jsx";
import { TodoMvcApp } from "./App.js";
import { TodoApiLive } from "./todo-service.js";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element found");

const dispose = mount(() => TodoMvcApp(), root, TodoApiLive);

const hot = (import.meta as ImportMeta & { hot?: { dispose: (cb: () => void) => void } }).hot;
if (hot) {
  hot.dispose(dispose);
}
