# Resumable Action Browser Proof

This fixture proves the first resumability vertical slice against a production
browser bundle:

- the server imports and renders `server/save-button.ts`;
- SSR collection emits the DOM event marker and versioned resume manifest;
- the initial client bundle installs the delegated resumer without importing
  the server component or action implementation;
- the first interaction dynamically imports only `actions/save-action.ts`;
- concurrent interactions share the in-flight module load but execute as
  distinct events;
- the component itself has a separate addressable activation entry and remains
  unloaded until `ClientInstallation.activate("c0")` claims its SSR region;
- concurrent activation requests share one component load and one mount, and
  disposal closes that mount exactly once;
- lazy loader failures are normalized by the resolver rather than escaping as
  unobserved promise defects;
- client disposal removes the delegated listener and interrupts owned work.

Run it with:

```sh
npm run test:browser
```

The example deliberately uses a hand-authored resolver manifest. Generating
that mapping is Milestone 7 compiler/bundler work; core wire records continue
to carry stable logical code IDs rather than asset URLs.
