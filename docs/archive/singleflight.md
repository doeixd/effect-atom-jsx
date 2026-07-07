Now I have a thorough picture. Let me lay out how all of these pieces fit together.

---

## The Core Idea: Start with the Platform, Then Enhance

All three frameworks share a philosophical commitment to *the web platform*. The baseline is plain HTML: `<form method="POST">` and `<a href="...">` work without any JavaScript at all. Then, when JS loads, the frameworks intercept these native behaviors and upgrade them — preventing full page reloads, adding optimistic UI, enabling streaming, and enabling single-flight mutations. The degree to which each framework leans into this varies.

---

## 1. Server Functions: The Foundation

Server functions are the mechanism that makes everything else possible. They're functions that *always run on the server* but can be called from client code as if they were local. The framework's build tooling replaces client-side references with RPC calls (usually fetch requests to generated HTTP endpoints).

### SolidStart

Actions are defined by wrapping data-mutation logic with the `action` function from Solid Router. They can be triggered in two ways: using an HTML `<form>` element or programmatically using the `useAction` primitive. Server functions are created by adding `"use server"` as the first line of a function body. The compiler detects this directive and splits the code so the function body only exists on the server, while the client gets an RPC stub.

```ts
const myAction = action(async (formData: FormData) => {
  "use server";
  // This only runs on the server
  await db.insert(/* ... */);
  return redirect("/list");
});
```

SolidStart's server functions are deeply integrated with the router. The router knows about them, assigns them HTTP endpoints, and handles the serialization protocol — including streaming data back when single-flight mutations are active.

### TanStack Start

Server functions are created with `createServerFn()` and can specify an HTTP method. They provide server capabilities like database access and environment variables while maintaining type safety across the network boundary.

```ts
const saveData = createServerFn({ method: 'POST' })
  .validator((data) => schema.parse(data))
  .handler(async ({ data }) => {
    await db.insert(data);
    return { success: true };
  });
```

TanStack Start's approach is more explicit and builder-pattern-oriented. You chain `.validator()` for input validation and `.handler()` for the logic. Server functions can also be composed with middleware for authentication, logging, and shared logic. Critically, each server function exposes a `.url` property — a stable URL for the generated endpoint — which becomes important for progressive enhancement.

### SvelteKit

SvelteKit has *two* systems, reflecting its evolution:

**Form actions** (the stable API): You export named functions from `+page.server.ts` that receive `FormData` when a form is submitted. Form actions are the preferred way to send data to the server, since they can be progressively enhanced. These are route-scoped — they live alongside specific pages.

**Remote functions** (the newer experimental API): Remote functions are exported from a `.remote.ts` file and come in four flavors: `query`, `form`, `command`, and `prerender`. On the client, the exported functions are transformed into fetch wrappers that invoke their server counterparts via generated HTTP endpoints. These can live anywhere and be imported into any component, more like SolidStart's and TanStack's approach.

---

## 2. Progressive Enhancement: Forms Without JavaScript

The question here is: what happens when JS hasn't loaded yet (or is disabled)?

### SvelteKit — The Gold Standard

SvelteKit was designed around progressive enhancement from the start. SvelteKit has always cared about progressive enhancement, promoting things like SSR and native form behavior.

The baseline works like a traditional multi-page app:

1. You write a `<form method="POST">` with a standard `action` attribute
2. The browser submits it natively as a full POST request
3. SvelteKit runs the action on the server in `+page.server.ts`
4. The server responds with a redirect (302/303) or re-renders the page with updated data
5. The browser does a full page reload to show the new state

Each time you add or remove a to-do the page reloads. This is the default form behavior once you submit it — this means the form works without JavaScript.

Then you add `use:enhance`:

```svelte
<script>
  import { enhance } from '$app/forms';
</script>
<form method="POST" use:enhance>
  <!-- fields -->
</form>
```

When you submit the form the `use:enhance` action is going to update the `form` and `$page.form` and `$page.status` properties, reset the `<form>` element, and rerun the load function for the page by using `invalidateAll`. It intercepts the native submission, sends it via `fetch` instead, and updates the page reactively — no full reload. You can also customize this callback to add optimistic UI, loading states, and custom error handling.

For the newer **remote functions** system, SvelteKit's `form()` helper generates an object you spread onto a `<form>` element. It works with native HTML forms as the baseline and enhances with JS.

### SolidStart — Progressive Enhancement via `<Form>`

SolidStart uses uppercase component versions of HTML elements — capital `A` for anchor and capital `F` for Form — as a convention for progressively enhanced versions that work with or without JavaScript.

The recommended approach is to use a `<form>` element, which ensures a robust user experience with progressive enhancement since the form works even without JavaScript. For cases where a form is not suitable, the `useAction` primitive can be used to trigger the action programmatically.

Without JS, a SolidStart form does a standard HTML POST. With no JavaScript on the client, every navigation and form submission requires a full page load and round trip to the server so that everything is rendered server-side each time. The server runs the action, possibly returns errors or a redirect, and the browser re-renders the full page.

With JS loaded, the `<Form>` component (from Solid Router) intercepts the submission. All SolidStart interactivity can be based on forms so it can operate without client-side JavaScript. However, when capabilities in excess of the minimum are available, they are used to enhance the user experience. The enhanced path gives you optimistic updates, streaming responses, pending/error states via `useSubmission`, and — crucially — single-flight mutations.

### TanStack Start — URL-Based Progressive Enhancement

TanStack Start takes a different approach since it's React-based and React doesn't have built-in progressive form enhancement like Svelte's `use:enhance`.

You can use server functions without JavaScript by leveraging the `.url` property with HTML forms. Every `createServerFn()` exposes a `.url` that points to the generated server endpoint. You set this as the `action` attribute of a standard HTML form:

```tsx
<form action={handleForm.url} method="post" encType="multipart/form-data">
  <!-- fields -->
</form>
```

Without JavaScript, submitting the form sends data to the server function's URL endpoint, but the browser redirects to that URL rather than staying on the page. To stay on the same page, you need cookies and a redirect. This means the no-JS experience requires more manual wiring — setting cookies for flash data, redirecting back, and re-rendering with any error state. It's *possible* but more ceremonial than SvelteKit or SolidStart.

With JS loaded, the `<ClientOnly>` component and standard React event handlers take over. TanStack Start's execution model documentation shows building components that work without JavaScript and enhancing with client-side functionality, using patterns like `<ClientOnly>` with fallbacks. The JS path typically uses TanStack Query's `useMutation` or `useServerFn` to call the server function via fetch, completely bypassing the native form submission.

---

## 3. Links and Navigation

Progressive enhancement isn't just forms — it's navigation too.

**SvelteKit** automatically intercepts `<a>` tags. Every link does a full-page navigation without JS. With JS loaded, SvelteKit performs client-side routing: it calls the `load` functions for the target route, fetches the data, and swaps the content without a full reload. You can control this with `data-sveltekit-*` attributes (e.g., `data-sveltekit-preload-data` for preloading on hover).

**SolidStart** does the same with its uppercase `<A>` component. Without JS it's a standard anchor. With JS, the router handles the navigation client-side, prefetching data and updating only the parts of the page that changed — taking advantage of Solid's fine-grained reactivity.

**TanStack Start** builds on TanStack Router, which supports `<Link>` components with type-safe routes. The router handles client-side transitions with `defaultPreload: "intent"` to prefetch on hover. Without JS, standard `<a>` tags still work for navigation, but the enhanced experience (preloading, route-level data loading, pending states) requires JS.

---

## 4. How It All Combines with Single-Flight Mutations

Here's where it gets interesting: progressive enhancement and single-flight mutations exist on a **spectrum of capability**. The no-JS path is always multi-flight (or full-page-reload). Single-flight mutations are inherently a JS-enhanced feature. The progression looks like:

### Layer 1: No JavaScript (Full Page Reload)

In all three frameworks, a form submits as a native HTML POST. The server runs the mutation, then either redirects (causing a fresh GET for the new page, which loads all data from scratch) or re-renders the current page with updated data. This is always **multi-round-trip**: the mutation is one request, and the browser's GET for the redirect target is another.

### Layer 2: JavaScript Loaded, No Single-Flight

With JS, the form is intercepted and submitted via `fetch`. After the mutation response comes back:

- **SvelteKit** calls `invalidateAll()` by default, which re-runs all `load` functions. This triggers *separate* fetch requests for each load function — still multiple round trips after the initial mutation.
- **SolidStart** revalidates all active cache entries by default — again, separate fetches.
- **TanStack Start** would typically call `queryClient.invalidateQueries()` to mark cached data as stale, triggering refetches.

### Layer 3: Single-Flight Mutations (Fewest Round Trips)

This is the payoff. The mutation and the data refresh happen in the *same* HTTP response:

**SolidStart**: After the action completes on the server, the framework diffs which cache keys are active on the current page, re-runs those loaders on the server, and streams the fresh data back in the same response. This happens automatically — the developer just uses actions and cache/revalidation as normal. The protocol bundles everything together.

**SvelteKit**: Inside the form handler, you call `getPosts().refresh()` to re-run a query on the server and send the refreshed data back with the form response. Or you call `getPost(id).set(result)` to push a value directly without re-fetching. The client-driven alternative uses `submit().updates(getPosts())` via the `enhance` callback. By default a form submission refetches all queries. For more efficiency, adding a refresh call inside the form handler creates a single-flight mutation — the server sends back the updated data in the same response.

**TanStack Start**: The developer defines middleware that inspects TanStack Query's cache, figures out which server functions need to be called to refresh the specified query keys, and executes them on the server alongside the mutation. The middleware receives query keys specifying what to re-fetch, looks up the corresponding server functions in TanStack Query's internal cache, calls them on the server, and pipes the results back in the same response.

---

## Summary: The Enhancement Ladder

| Capability | No JS | JS (basic) | JS + Single-Flight |
|---|---|---|---|
| **Form submission** | Native POST, full reload | `fetch`-intercepted, no reload | Same as basic JS path |
| **Data refresh** | Full page re-render from server | `invalidateAll` / refetch (separate requests) | Bundled in mutation response |
| **Network trips** | 2+ (POST → redirect → GET) | 2+ (POST → refetch GETs) | 1 (POST returns mutation result + fresh data) |
| **Optimistic UI** | Not possible | Possible with manual state | Possible, resolves faster |
| **Streaming** | N/A | Possible | Data streams back as available |

The beautiful architectural insight across all three frameworks is that each layer of enhancement is *additive*. The server functions are the same whether you're handling a native form POST or a sophisticated single-flight mutation with streaming. The form action code doesn't change — what changes is the *transport layer* and how much work gets bundled into a single round trip. You write the mutation logic once, and the framework gives you graceful degradation for free and single-flight optimization when you opt in.


Now I have a thorough picture. Here's an explanation of the architecture.

---

## What Is a Single-Flight Mutation?

A single-flight mutation means you mutate data and update the UI with just one round trip to the network. The key insight is that network round trips are typically the most expensive part of a web application. In a traditional SPA, a mutation flow often looks like this:

1. **POST** the mutation to the server
2. Wait for the response
3. **GET** the fresh data you need to update the UI
4. Re-render

That's at least two network round trips. A single-flight mutation collapses steps 1–3 into a single request: the server performs the mutation *and* fetches/returns the updated data in the same response. SvelteKit, TanStack Start, and SolidStart have all adopted this pattern as part of what Ryan Carniato (SolidJS creator) calls "Isomorphic First" architecture — SSR-capable apps where the core code runs in both environments, leveraging newer tools without a full architecture change.

---

## SolidStart: The Pioneer

SolidStart originated this pattern in the isomorphic SPA world. Ryan Carniato has described how this architecture started with SolidStart and has since propagated to SvelteKit and TanStack Start.

**How it works:** SolidStart uses *actions* (from Solid Router) combined with *server functions* and a *cache/revalidation* protocol. When a form submits, a single POST request goes to the server. The server runs the mutation, and then — because it knows which cache keys are active on the current page — it also re-runs the relevant data loaders and streams the results back in the same HTTP response.

The v0.6.0 release introduced single-flight mutations as a combined Start + Solid Router feature. Inspired by React Server Components' ability to send back the next page in the same request with server actions, SolidStart added the ability to send back the *data* for the next page (or a refresh of the current page) instead — and to stream it back as it becomes available.

The feature requires no new API and no code changes on the developer's part. It supports granular revalidation: by default all data on the next page is revalidated, but you can use the `revalidate` option in router helpers (`reload`, `redirect`, `json`) to select only certain cache keys.

So the concrete flow in SolidStart is:

1. A form calls an `action` (a server function wrapped with `action()` from Solid Router)
2. The server executes the mutation
3. The server checks which cache keys are active on the client's current page (or the redirect target)
4. It re-runs those data loaders on the server and streams the fresh data back in the same response
5. The client receives the mutation result *and* fresh data together, updating reactively via `createAsync`

In the egghead lesson on this topic, the instructor demonstrates that after converting from a manual fetch-then-navigate flow to a form action with redirect, the network tab shows only one request — that's the single-flight mutation in action.

SolidStart's non-blocking async and parallelized load/cache patterns mean the server starts fetching data for the next page after an update and streams it back on the same response while the client handles the redirect — effectively eliminating unnecessary waterfalls.

---

## TanStack Start: Query-Key-Driven Middleware

TanStack Start takes a different mechanical approach that's tightly integrated with TanStack Query (react-query).

In TanStack Start, the approach is to define refetching middleware that you attach to any server function. The middleware receives TanStack Query keys specifying what data needs to be re-fetched, and handles everything from there.

The architecture works in layers:

**1. Server Functions** are the mutation primitive — functions that run on the server but can be called from the client. They're the "outbound flight."

**2. TanStack Query** manages all client-side data caching with its hierarchical key system. Each query has options that include a `meta` field where you can attach a `__revalidate` payload containing the server function and its arguments:

The query options include a `meta` section with the server function and argument needed for refetching. The middleware then looks up queries in the TanStack Query cache by key, extracts the revalidation payload, and calls the corresponding server functions on the server side.

**3. Middleware** is the glue. TanStack Start's `createMiddleware` API lets you build a reusable `refetchMiddleware` that:
- Runs on the **client** first: it inspects the query cache for the requested keys, extracts the server function references, and sends that information to the server as context
- The **server** receives the mutation call *plus* the revalidation instructions, executes the mutation, then calls the specified server functions to get fresh data
- The fresh data rides back in the same response as the mutation result
- Back on the **client**, the middleware injects the returned payloads directly into the TanStack Query cache

The middleware also tells TanStack Query to invalidate (but not refetch) any inactive queries matching the specified keys. This way, if you later navigate to a page that uses those queries, fresh data will be fetched at that point.

The developer experience looks like calling a server function with configuration specifying which query keys to refetch:

```ts
await updateEpic({
  data: { id, name },
  context: {
    refetch: [["epics", "list", page], ["epics", "summary"]]
  }
});
```

This is more explicit and manual than SolidStart's automatic approach, but it leverages the query-key system developers already know from react-query, and it's composable via middleware.

---

## SvelteKit: Remote Functions with `refresh()` and `set()`

SvelteKit's approach arrived more recently via the experimental **remote functions** feature. Remote functions are exported from `.remote.ts` files and come in four flavors: `query`, `form`, `command`, and `prerender`. On the client, these are transformed into fetch wrappers that invoke their server counterparts via generated HTTP endpoints.

SvelteKit provides two ways to achieve single-flight mutations:

**Server-driven (inside the form handler):**
You can call `refresh()` on a query inside the form handler on the server. This tells SvelteKit to re-run that query on the server and send the refreshed data back with the form response, preventing a second round-trip.

Alternatively, you can call `set()` on a query to directly provide an updated value — for example, if the mutation API already returns the updated record, you can push it into the query cache without re-fetching at all.

```ts
// Inside a form handler on the server:
await getPosts().refresh();         // re-run and send back
await getPost(post.id).set(result); // set directly, no re-fetch
```

**Client-driven (via `enhance`):**
The second approach drives the single-flight mutation from the client using `submit().updates(...)`, where you pass the queries that should be refreshed.

```svelte
<form {...createPost.enhance(async ({ submit }) => {
  await submit().updates(getPosts());
})}>
```

By default, a form submission refetches all queries to keep data fresh. For more efficiency, adding a refresh call inside the form handler creates a single-flight mutation — the server sends back the updated data in the same response.

---

## Architectural Comparison

All three frameworks solve the same fundamental problem — eliminating the second network round trip after a mutation — but they differ in mechanism:

**SolidStart** is the most *automatic*. The router knows which cache keys are active on the page. When a mutation completes and triggers a redirect or reload, the server automatically re-runs the relevant loaders and streams data back. Developers don't have to explicitly wire up refetching.

**TanStack Start** is the most *explicit and composable*. It uses middleware + TanStack Query keys as its coordination layer. Developers define exactly which queries to refetch per mutation, and the middleware handles the server/client coordination. This gives maximum flexibility but requires more setup.

**SvelteKit** sits in between. Its remote functions system gives you `refresh()` and `set()` as server-side primitives, plus client-driven `submit().updates(...)`. The developer chooses which queries to update, but the framework handles the transport automatically.

The shared architectural principle across all three is the same: the server function protocol carries *both* the mutation result and the fresh query data in a single HTTP response, with the framework runtime on the client knowing how to route that data back into the appropriate reactive stores or cache entries.