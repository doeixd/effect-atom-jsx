/** @jsxImportSource effect-atom-jsx */

import type { JSX } from "../jsx-runtime.js";

const input = (
  <input
    type="text"
    value="hello"
    required
    data-test-id="field"
    aria-label="Name"
    onInput={(event) => {
      const element: HTMLInputElement = event.currentTarget;
      const inputEvent: InputEvent = event;
      void element;
      void inputEvent;
    }}
  />
);
void input;

const button = (
  <button
    type="button"
    disabled={false}
    onClick={(event) => {
      const element: HTMLButtonElement = event.currentTarget;
      const mouseEvent: MouseEvent = event;
      void element;
      void mouseEvent;
    }}
  >
    Save
  </button>
);
void button;

const link = (
  <a href="/docs" target="_blank" rel="noreferrer">
    Docs
  </a>
);
void link;

const label = <label for="name">Name</label>;
void label;

const form = (
  <form action="/submit" method="post" onSubmit={(event) => {
    const element: HTMLFormElement = event.currentTarget;
    const submitEvent: SubmitEvent = event;
    void element;
    void submitEvent;
  }}>
    <textarea rows={4} value="hello" onInput={(event) => {
      const element: HTMLTextAreaElement = event.currentTarget;
      void element;
    }} />
    <select multiple value={["a"]} onChange={(event) => {
      const element: HTMLSelectElement = event.currentTarget;
      void element;
    }}>
      <option value="a" selected>A</option>
    </select>
  </form>
);
void form;

const image = <img src="/logo.png" alt="Logo" width={32} height="32" loading="lazy" />;
void image;

// Unknown/custom elements keep the migration escape hatch.
const custom = <af-widget href={5} onBogus={() => undefined} />;
void custom;

// @ts-expect-error non-custom unknown tags are not accepted by the migration escape hatch
const unknownTag = <widget href={5} />;
void unknownTag;

// @ts-expect-error known divs do not accept anchor-only href
const divHref = { href: "/nope" } satisfies JSX.IntrinsicElements["div"];
void divHref;

// @ts-expect-error known inputs reject non-string/number/array value payloads
const inputObjectValue = { value: { bad: true } } satisfies JSX.IntrinsicElements["input"];
void inputObjectValue;

// @ts-expect-error known buttons reject invalid button type values
const badButtonType = { type: "primary" } satisfies JSX.IntrinsicElements["button"];
void badButtonType;

// @ts-expect-error known form methods reject arbitrary strings
const badFormMethod = { method: "put" } satisfies JSX.IntrinsicElements["form"];
void badFormMethod;

// @ts-expect-error known images reject invalid loading modes
const badImageLoading = { loading: "fast" } satisfies JSX.IntrinsicElements["img"];
void badImageLoading;

// @ts-expect-error known elements reject unknown event names
const badEventName = { onBogus: () => undefined } satisfies JSX.IntrinsicElements["input"];
void badEventName;

type InputHandler = NonNullable<JSX.InputHTMLAttributes["onInput"]>;
const annotatedWithSupertype: InputHandler = (event: Event) => {
  void event;
};
void annotatedWithSupertype;
