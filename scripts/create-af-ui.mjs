#!/usr/bin/env node
/**
 * create-af-ui — minimal project + slot-contract component scaffold.
 *
 * Usage:
 *   npx create-af-ui <project-dir>
 *   node scripts/create-af-ui.mjs <project-dir>
 *   node scripts/create-af-ui.mjs --component <Name> [out-dir]
 */
import fs from "node:fs";
import path from "node:path";

function usage() {
  console.log(`Usage:
  create-af-ui <project-dir>
  create-af-ui --component <Name> [out-dir]
`);
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  console.log("wrote", file);
}

function scaffoldComponent(name, outDir) {
  const file = path.join(outDir, `${name}.tsx`);
  write(
    file,
    `import { Effect } from "effect";
import { Behavior, Component, Element, Style, View } from "effect-atom-jsx";

export const ${name}Slots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  label: { capability: Element.Capability.Container },
  input: {
    capability: Element.Capability.TextInput,
    allowedEvents: [View.Event.Input, View.Event.Focus],
  },
});

export const ${name} = Component.make(
  Component.props<{ readonly label: string }>(),
  Component.require<never>(),
  () => Effect.succeed({}),
  (props) =>
    View.fromSlots(${name}Slots, (
      <label>
        <span>{props.label}</span>
        <input />
      </label>
    )),
).pipe(Component.withSlots(${name}Slots));

export const ${name}Style = Style.forSlots(${name}Slots)({
  root: Style.slot({ display: "grid", gap: "sm" }),
  label: Style.slot({ fontWeight: 600 }),
  input: Style.slot({ padding: "sm" }),
});

export const ${name}Behavior = Behavior.forSlots(${name}Slots)((elements) =>
  Effect.succeed({
    focus: () => elements.input.focus?.(),
  }),
);

export const Styled${name} = ${name}.pipe(
  Style.attachToSlots(${name}Style, ${name}Slots),
  Behavior.attachToSlots(${name}Behavior, ${name}Slots),
);
`,
  );
}

function scaffoldProject(dir) {
  const root = path.resolve(dir);
  write(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: path.basename(root),
        private: true,
        type: "module",
        scripts: {
          typecheck: "tsc --noEmit",
          dev: "echo Configure bundler + babel-plugin-jsx-dom-expressions (see README)",
        },
        dependencies: {
          "effect-atom-jsx": "latest",
          effect: "^4.0.0-beta.29",
        },
        devDependencies: {
          typescript: "^7.0.2",
        },
      },
      null,
      2,
    ) + "\n",
  );
  write(
    path.join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "preserve",
          jsxImportSource: "effect-atom-jsx",
          strict: true,
          skipLibCheck: true,
        },
        include: ["src"],
      },
      null,
      2,
    ) + "\n",
  );
  write(
    path.join(root, "README.md"),
    `# ${path.basename(root)}

Scaffolded by \`create-af-ui\`.

- JSX: \`jsxImportSource: effect-atom-jsx\`
- Babel: \`babel-plugin-jsx-dom-expressions\` with \`moduleName: "effect-atom-jsx/runtime"\`
- Golden path: \`docs/SLOT_CONTRACT_GOLDEN_PATH.md\` in effect-atom-jsx
`,
  );
  scaffoldComponent("Field", path.join(root, "src"));
  write(
    path.join(root, "src", "App.tsx"),
    `import { render } from "effect-atom-jsx";
import { StyledField } from "./Field.js";

function App() {
  return <StyledField label="Name" />;
}

const root = document.getElementById("root");
if (root) render(() => <App />, root);
`,
  );
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  usage();
  process.exit(0);
}
if (args[0] === "--component") {
  const name = args[1];
  if (!name) {
    usage();
    process.exit(1);
  }
  scaffoldComponent(name, path.resolve(args[2] ?? "src"));
  process.exit(0);
}
scaffoldProject(args[0]);
