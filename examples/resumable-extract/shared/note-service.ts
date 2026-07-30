import { Effect, Context } from "effect";

export interface NoteService {
  readonly record: (note: string) => Effect.Effect<void>;
}

export const NoteService = Context.Service<NoteService>(
  "examples/resumable-extract/NoteService",
);
