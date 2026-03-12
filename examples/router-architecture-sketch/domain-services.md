# Domain Services Sketch

```ts
import { Effect, Layer, Schema } from "effect";
import { Atom, Reactivity } from "effect-atom-jsx";

export type User = {
  readonly id: string;
  readonly name: string;
  readonly bio: string;
};

export const SaveUserInput = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});
export type SaveUserInput = Schema.Schema.Type<typeof SaveUserInput>;

export class UsersService extends Effect.Tag("UsersService")<
  UsersService,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<User>>;
    readonly byId: (id: string) => Effect.Effect<User>;
    readonly save: (input: SaveUserInput) => Effect.Effect<User>;
  }
>() {}

const usersState = Atom.value<ReadonlyArray<User>>([]);
const usersStore = usersState.pipe(Atom.withReactivity(["users"]));

export const UsersLive = Layer.succeed(UsersService, {
  list: () => Reactivity.tracked(
    Effect.sync(() => usersStore()),
    { keys: ["users"] },
  ),

  byId: (id) => Reactivity.tracked(
    Effect.sync(() => usersStore().find((user) => user.id === id)!),
    { keys: ["users", `user:${id}`] },
  ),

  save: (input) => Reactivity.invalidating(
    Effect.sync(() => {
      const next = { id: input.id, name: input.name, bio: "Updated" };
      usersState.update((prev) => prev.map((user) => user.id === input.id ? next : user));
      return next;
    }),
    (user) => ["users", `user:${user.id}`],
  ),
});
```

Why this matters:

- services own tracked reads and invalidating writes
- Reactivity remains the only freshness graph
- routes and runtime consume those signals instead of maintaining a second invalidation system
