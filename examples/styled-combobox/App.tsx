import { StyledComposables } from "effect-atom-jsx";

const UserPicker = StyledComposables.createStyledCombobox<string>({
  filter: (item, query) => item.toLowerCase().includes(query.toLowerCase()),
  multiple: true,
});

const users = ["Ada Lovelace", "Grace Hopper", "Margaret Hamilton", "Joan Clarke"] as const;

export function App() {
  return (
    <main style="font-family: ui-sans-serif, system-ui; padding: 16px; max-width: 640px; margin: 0 auto;">
      <h1>Styled Combobox (Headless + Style.attach)</h1>
      <p>This example uses `createStyledCombobox` and renders with a custom view.</p>

      <UserPicker items={users}>
        {(cb) => (
          <section>
            <p>
              <button onClick={() => cb.toggle()}>Toggle</button>
              <button onClick={() => cb.clearSelection()}>Clear Selection</button>
            </p>

            <p>
              <input
                value={cb.query()}
                onInput={(e) => cb.input.emit("input", (e.currentTarget as HTMLInputElement).value)}
                onKeyDown={(e) => cb.handleInputKeyDown({ key: e.key })}
                placeholder="Search users"
              />
            </p>

            <p>
              <small>
                slot style: trigger borderRadius={String(cb.trigger.getStyle("borderRadius"))},
                content shadow={JSON.stringify(cb.content.getStyle("shadow"))}
              </small>
            </p>

            {cb.isOpen() && (
              <ul>
                {cb.filtered().map((item, index) => {
                  const option = cb.getOptionHandle(index);
                  return (
                    <li key={item}>
                      <button
                        onClick={() => option.emit("press")}
                        style={cb.isSelected(item) ? "font-weight:700" : "font-weight:400"}
                      >
                        {item}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <p>Selected: {cb.selected().join(", ") || "(none)"}</p>
          </section>
        )}
      </UserPicker>
    </main>
  );
}
