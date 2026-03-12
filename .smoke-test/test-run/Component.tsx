import { createComponent } from "effect-atom-jsx/runtime";

export function SmokeComponent({ count }) {
  return (
    <div>Count: {count()}</div>
  );
}
