import { Effect } from "effect";
import * as Atom from "../Atom.js";
import * as Reactivity from "../Reactivity.js";

// Literal names are preserved through make/child/family
const Users = Reactivity.Key.make("users");
const users: "users" = Users.name;
void users;

const alice = Users.child("alice");
const aliceName: "users:alice" = alice.name;
void aliceName;

const item = Users.child(42);
const itemName: `users:${number}` = item.name;
void itemName;

const todo = Reactivity.Key.family("todo");
const member = todo("a1");
const memberName: "todo:a1" = member.name;
void memberName;
const familyParent: "todo" = todo.key.name;
void familyParent;

// KeyNameOf extraction
type UsersName = Reactivity.KeyNameOf<typeof Users>;
const usersName: UsersName = "users";
void usersName;

type TodoFamilyName = Reactivity.KeyNameOf<typeof todo>;
const todoFamilyName: TodoFamilyName = "todo";
void todoFamilyName;

// Witnesses and strings mix anywhere ReactivityKeysInput is accepted
Reactivity.tracked(Effect.void, { keys: [Users, "extra"] });
Reactivity.invalidating(Effect.void, [alice, todo(2), "plain"]);
Reactivity.invalidating(Effect.void, (_: void) => [Users]);
Atom.invalidateReactivity([Users, "plain"]);

// The record form remains valid alongside witnesses
Reactivity.tracked(Effect.void, { keys: { users: ["alice", 42] } });

// Wrong shapes are rejected
// @ts-expect-error numbers are not keys
Reactivity.invalidating(Effect.void, [42]);
// @ts-expect-error arbitrary objects are not key witnesses
Reactivity.tracked(Effect.void, { keys: [{ name: "users" }] });

// Child derivation on a widened witness still yields a witness
const widened: Reactivity.ReactivityKeyWitness = Users;
const widenedChild = widened.child("x");
const widenedChildName: string = widenedChild.name;
void widenedChildName;
