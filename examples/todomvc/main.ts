import { createMount, withViteHMR, type ViteHotContext } from "effect-atom-jsx";
import { TodoMvcApp } from "./App.js";
import { TodoApiLive } from "./todo-service.js";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element found");

const mountTodoApp = createMount(TodoApiLive);
const dispose = mountTodoApp(() => TodoMvcApp(), root);
const hot = (import.meta as ImportMeta & { hot?: ViteHotContext }).hot;
withViteHMR(dispose, hot, "example:todomvc");
