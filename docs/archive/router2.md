The route tree is the component tree. When a URL matches, we know every matched component from root to leaf before rendering starts. Each component can have a `Route.loader` in its pipe. Because we know all matched loaders upfront, we can run them all in parallel as Effects. No waterfalls. No "parent loads then child loads." Everything starts at once.

**Route.loader as a pipe:**

```ts
const UserProfile = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  (props) => Effect.gen(function* () {
    // loader data is available in setup via Route.loaderData
    const user = yield* Route.loaderData<User>();
    return { user };
  }),
  (props, { user }) => (
    <Box>
      <Text slot="name">{user().name}</Text>
      <Text slot="email">{user().email}</Text>
    </Box>
  ),
).pipe(
  Component.route("/:userId", {
    params: Schema.Struct({
      userId: Schema.String.pipe(Schema.nonEmpty()),
    }),
  }),
  Route.loader((params) =>
    Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.findUser(params.userId);
    })
  ),
);
```

`Route.loader` takes a function from parsed params to an Effect. The Effect's return type becomes the loader data type. The Effect's error type flows into the route's `E`. The Effect's requirements flow into the route's `R`. All type-safe.

The loader's type signature:

```ts
declare function loader<P, A, E, R>(
  fn: (params: P) => Effect.Effect<A, E, R>,
  options?: LoaderOptions,
): <Props, Req, Err>(
  route: RoutedComponent<Props, Req, Err, P, any>,
) => RoutedComponent<Props, Req | R, Err | E, P, any>;
```

The return type `A` becomes what `Route.loaderData<A>()` yields in the component's setup. TypeScript infers `A` from the loader function. If the loader returns `Effect<User, HttpError, Api>`, then `Route.loaderData<User>()` yields `User`, `HttpError` joins the route's error channel, and `Api` joins its requirements.

**Parallel loading — the router runs all matched loaders concurrently:**

When the URL is `/users/alice`, the router matches:

```
App           → /          (no loader)
UsersLayout   → /users     (loader: fetch user stats)
UserProfile   → /:userId   (loader: fetch user by id)
```

The router collects all matched route loaders and runs them in parallel:

```ts
// Internal router behavior on navigation
const handleNavigation = (url: URL) =>
  Effect.gen(function* () {
    // 1. Match all routes from root to leaf
    const matched = matchRouteTree(url, routeTree);
    // [App, UsersLayout, UserProfile]

    // 2. Parse params for each matched route
    const parsed = matched.map((route) => ({
      route,
      params: parseParams(route.pattern, url),
    }));

    // 3. Run ALL loaders in parallel
    const loaderResults = yield* Effect.all(
      parsed
        .filter((m) => m.route.loader)
        .map((m) => m.route.loader!(m.params).pipe(
          Effect.map((data) => ({ routeId: m.route.id, data })),
          // Tag errors with which route they came from
          Effect.mapError((error) => ({
            routeId: m.route.id,
            error,
          })),
        )),
      { concurrency: "unbounded" },  // all loaders run at once
    );

    // 4. Distribute loader data to each component
    for (const result of loaderResults) {
      loaderDataStore.set(result.routeId, result.data);
    }

    // 5. Now render — all data is already available
  });
```

No waterfalls. `UsersLayout` loader and `UserProfile` loader start at the same instant. The page only renders once all loaders have settled (or individually as they complete, with streaming).

**Nested loaders that depend on parent data:**

Sometimes a child's loader needs data from a parent's loader. For example, a user's posts loader might need the user ID that the parent loader resolved:

```ts
const UserProfile = Component.make(/* ... */).pipe(
  Component.route("/:userId", {
    params: Schema.Struct({ userId: Schema.String }),
  }),
  Route.loader((params) =>
    Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.findUser(params.userId);
    })
  ),
);

const UserPosts = Component.make(/* ... */).pipe(
  Component.route("/posts", {
    params: Schema.Struct({}),
  }),
  // This loader depends on the parent's loader data
  Route.loader(
    (_params, deps) =>
      Effect.gen(function* () {
        // deps.parent gives access to the parent route's loader data
        const user = deps.parent<User>();
        const api = yield* Api;
        return yield* api.listPosts(user.id);
      }),
    { dependsOnParent: true },
  ),
);
```

When `dependsOnParent: true`, the router runs the parent loader first, then the child loader. But sibling loaders at the same depth still run in parallel:

```
URL: /users/alice/posts

Parallel batch 1:
  - UsersLayout loader (stats)
  - UserProfile loader (user)     ← UserPosts depends on this

Parallel batch 2 (after batch 1 completes):
  - UserPosts loader (posts)      ← runs with user data available

Total: 2 round-trips instead of 3 sequential
```

Without `dependsOnParent`, all three would run in parallel (3 loaders in 1 round-trip). With it, dependent loaders wait for their parent but siblings are still parallel. The router builds a dependency graph from the loader declarations and resolves it with maximum parallelism.

```ts
// Internal: build loader dependency graph
const buildLoaderGraph = (matched: MatchedRoute[]) => {
  const independent: LoaderTask[] = [];
  const dependent: Map<string, LoaderTask[]> = new Map();

  for (const route of matched) {
    if (!route.loader) continue;
    if (route.loaderOptions?.dependsOnParent) {
      const parentId = route.parent?.id;
      if (parentId) {
        const deps = dependent.get(parentId) ?? [];
        deps.push(route);
        dependent.set(parentId, deps);
      }
    } else {
      independent.push(route);
    }
  }

  return { independent, dependent };
};

// Run with maximum parallelism respecting dependencies
const runLoaders = (graph: LoaderGraph) =>
  Effect.gen(function* () {
    // Run all independent loaders in parallel
    const results = yield* Effect.all(
      graph.independent.map((route) =>
        route.loader!(route.params).pipe(
          Effect.map((data) => ({ routeId: route.id, data })),
        )
      ),
      { concurrency: "unbounded" },
    );

    // Store results
    for (const r of results) loaderDataStore.set(r.routeId, r.data);

    // Run dependent loaders (their parents have completed)
    const dependentTasks = graph.independent.flatMap((parent) => {
      const children = graph.dependent.get(parent.id) ?? [];
      return children.map((child) =>
        child.loader!(child.params, {
          parent: () => loaderDataStore.get(parent.id),
        }).pipe(
          Effect.map((data) => ({ routeId: child.id, data })),
        )
      );
    });

    if (dependentTasks.length > 0) {
      const depResults = yield* Effect.all(dependentTasks, {
        concurrency: "unbounded",
      });
      for (const r of depResults) loaderDataStore.set(r.routeId, r.data);
    }
  });
```

**Streaming — render as loaders complete:**

Instead of waiting for all loaders before rendering, stream the page. Components whose loaders have completed render immediately. Components whose loaders are still pending show their loading fallback.

```ts
const UserProfile = Component.make(/* ... */).pipe(
  Component.route("/:userId", {
    params: Schema.Struct({ userId: Schema.String }),
  }),
  Route.loader(
    (params) => Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.findUser(params.userId);
    }),
    {
      // Streaming: render the shell immediately, stream this data when ready
      streaming: true,
    },
  ),
);
```

When `streaming: true`, the component receives loader data as a `Result` instead of a resolved value. The component starts rendering with `Result.Loading`, and when the loader completes, it reactively updates to `Result.Success`.

How this works in setup:

```ts
(props) => Effect.gen(function* () {
  // With streaming: true, loaderData is Result<User, HttpError>
  // With streaming: false (default), loaderData is User (blocks until loaded)
  const userData = yield* Route.loaderData<User>();
  return { userData };
}),

(props, { userData }) => (
  // If streaming, userData is Result<User, HttpError>
  <Async
    result={userData()}
    loading={() => <ProfileSkeleton />}
    success={(user) => <ProfileView user={user} />}
  />
),
```

For SSR, streaming means the server sends the HTML shell immediately and streams the data as `<script>` tags that hydrate the results:

```ts
// Server-side streaming response
const streamPage = (url: URL) =>
  Effect.gen(function* () {
    const matched = matchRouteTree(url, routeTree);

    // Start all loaders
    const loaderFibers = yield* Effect.forEach(
      matched.filter((r) => r.loader),
      (route) => Effect.fork(route.loader!(route.params)),
    );

    // Render shell immediately with loading states
    const shellHtml = yield* renderShell(matched);
    yield* sendChunk(shellHtml);

    // As each loader completes, stream its data
    for (const [i, fiber] of loaderFibers.entries()) {
      const result = yield* Fiber.join(fiber);
      const routeId = matched[i].id;

      // Stream a script tag that hydrates this loader's data
      yield* sendChunk(`
        <script>
          window.__LOADER_DATA__["${routeId}"] = ${JSON.stringify(result)};
          window.__HYDRATE_ROUTE__("${routeId}");
        </script>
      `);
    }

    yield* sendChunk("</body></html>");
  });
```

The browser receives the HTML shell first. Users see the layout with loading skeletons. As each loader's data arrives (streamed as `<script>` tags), the corresponding component hydrates and displays real content. Fast loaders resolve first. Slow loaders stream later. No blank page waiting for the slowest query.

**Prefetching — start loaders before navigation:**

When the user hovers over a link, start the target route's loaders. By the time they click, data might already be cached:

```ts
// Route.Link with prefetch
<Route.Link
  to={userProfileLink}
  params={{ userId: "alice" }}
  prefetch="hover"
>
  Alice
</Route.Link>
```

`prefetch` options:

```ts
interface PrefetchOptions {
  // When to start prefetching
  trigger:
    | "hover"           // on mouse enter (desktop)
    | "focus"           // on focus (keyboard nav)
    | "visible"         // when link enters viewport (intersection observer)
    | "idle"            // when browser is idle (requestIdleCallback)
    | "intent"          // on hover + after short delay (avoids false positives)
    | "none";           // don't prefetch

  // What to prefetch
  scope:
    | "loader"          // only run the loader Effect
    | "component"       // also load the code chunk (if lazy)
    | "full";           // loader + component + child loaders
}
```

Implementation inside `Route.Link`:

```ts
const Link = Component.make(
  Component.props<{
    to: RouteLink<any, any>;
    params: any;
    prefetch?: "hover" | "focus" | "visible" | "intent" | "none";
    children: ViewNode;
  }>(),
  Component.require(Router),

  (props) => Effect.gen(function* () {
    const router = yield* Router;

    const href = yield* Component.derived(() =>
      props.to(props.params)
    );

    const prefetchData = () =>
      Effect.gen(function* () {
        // Find the target route
        const targetRoute = findRouteByLink(props.to);
        if (!targetRoute?.loader) return;

        // Check if data is already cached
        const cached = loaderCache.get(targetRoute.id, props.params);
        if (cached && !isStale(cached)) return;

        // Run the loader in a detached scope
        const data = yield* targetRoute.loader(props.params).pipe(
          Effect.timeout("5 seconds"),
          Effect.catchAll(() => Effect.void),
        );

        // Cache the result
        loaderCache.set(targetRoute.id, props.params, data);
      }).pipe(Effect.forkDaemon);

    return { href, prefetchData };
  }),

  (props, { href, prefetchData }) => (
    
      slot="link"
      href={href()}
      onClick={(e) => {
        e.preventDefault();
        router.navigate(href());
      }}
      onMouseEnter={() => {
        if (props.prefetch === "hover" || props.prefetch === "intent") {
          prefetchData();
        }
      }}
      onFocus={() => {
        if (props.prefetch === "focus") {
          prefetchData();
        }
      }}
    >
      {props.children}
    </a>
  ),
);
```

When the user eventually navigates, the router checks the loader cache first:

```ts
const handleNavigation = (url: URL) =>
  Effect.gen(function* () {
    const matched = matchRouteTree(url, routeTree);

    const loaderResults = yield* Effect.all(
      matched
        .filter((m) => m.route.loader)
        .map((m) => {
          // Check cache first
          const cached = loaderCache.get(m.route.id, m.params);
          if (cached && !isStale(cached)) {
            // Cache hit — instant
            return Effect.succeed({ routeId: m.route.id, data: cached.data });
          }
          // Cache miss — run loader
          return m.route.loader!(m.params).pipe(
            Effect.map((data) => ({ routeId: m.route.id, data })),
          );
        }),
      { concurrency: "unbounded" },
    );
    // ...
  });
```

Prefetched data makes navigation instant. The loader cache is shared between prefetch and navigation. Stale data is re-fetched.

**Viewport-based prefetching — for infinite scroll and content-heavy pages:**

```ts
// Prefetch all visible links automatically
const NavLink = Component.make(/* ... */).pipe(
  Route.prefetchOnVisible({ rootMargin: "200px" }),
  // When the link scrolls within 200px of the viewport, start prefetching
);
```

Implementation uses `IntersectionObserver` (on web) or equivalent on other platforms:

```ts
Route.prefetchOnVisible = (options) =>
  Behavior.make(
    Behavior.elements({ link: Element.Any }),
    (els) => Effect.gen(function* () {
      const renderer = yield* Renderer;

      yield* renderer.observeIntersection(
        els.link,
        { rootMargin: options?.rootMargin ?? "0px" },
        (entry) => {
          if (entry.isIntersecting) {
            // Start prefetching this link's target
            prefetchRoute(els.link.getAttr("href"));
          }
        },
      );
    }),
  );
```

**Lazy loading — code split route components:**

```ts
const AdminPanel = Component.lazy(
  () => import("./AdminPanel"),
).pipe(
  Component.route("/admin"),
  Route.loader((params) =>
    Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.getAdminDashboard();
    })
  ),
  Route.loading(() => <AdminSkeleton />),
);
```

`Component.lazy` wraps a dynamic import. The route pattern and loader are defined upfront — they don't need the component code to run. When the route matches:

1. Loader starts immediately (it's defined upfront, not in the lazy chunk)
2. Component chunk starts loading in parallel
3. `Route.loading` fallback shows while both are in-flight
4. When both complete, the component renders with loader data

The loader and the component code load in parallel. This is crucial — you don't wait for the JS chunk to load before starting data fetching. Both happen simultaneously.

```ts
// Internal: how lazy route navigation works
const handleLazyRoute = (route: LazyRoute, params: Params) =>
  Effect.gen(function* () {
    // Start both in parallel
    const [component, data] = yield* Effect.all([
      // Load the component chunk
      Effect.promise(() => route.importFn()).pipe(
        Effect.map((mod) => mod.default),
      ),
      // Run the loader (defined upfront, not in the chunk)
      route.loader
        ? route.loader(params)
        : Effect.succeed(undefined),
    ], { concurrency: 2 });

    // Both ready — render
    return { component, data };
  });
```

**Prefetching lazy chunks:**

```tsx
<Route.Link
  to={adminLink}
  params={{}}
  prefetch="hover"
>
  Admin Panel
</Route.Link>
```

On hover, both the loader AND the component chunk are prefetched:

```ts
const prefetchLazyRoute = (route: LazyRoute, params: Params) =>
  Effect.gen(function* () {
    yield* Effect.all([
      // Prefetch the JS chunk
      Effect.promise(() => route.importFn()).pipe(
        Effect.catchAll(() => Effect.void), // don't fail on prefetch error
      ),
      // Prefetch loader data
      route.loader
        ? route.loader(params).pipe(
            Effect.tap((data) => loaderCache.set(route.id, params, data)),
            Effect.catchAll(() => Effect.void),
          )
        : Effect.void,
    ], { concurrency: 2 });
  }).pipe(Effect.forkDaemon);
```

When the user clicks, both the code and data are already cached. Navigation is instant.

**Loader caching and invalidation:**

Loader data participates in the `Reactivity` system. Loaders can declare reactivity keys:

```ts
Route.loader(
  (params) => Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.findUser(params.userId);
  }),
  {
    // Cache configuration
    staleTime: "5 minutes",          // data is fresh for 5 minutes
    cacheTime: "30 minutes",         // keep in cache for 30 minutes (serve stale)
    reactivityKeys: ["users"],       // invalidate when "users" key is invalidated

    // Revalidation
    revalidateOnFocus: true,         // refetch when tab regains focus
    revalidateOnReconnect: true,     // refetch when network reconnects
  },
),
```

When a mutation invalidates `["users"]` via `Reactivity`, all loaders with `reactivityKeys: ["users"]` revalidate. If the user is on the page, the loader re-runs and the component updates. If the user navigated away, the cached data is marked stale so the next visit triggers a fresh load.

```ts
// Mutation invalidates loader cache via Reactivity
const deleteUser = apiRuntime.action(
  Effect.fn(function* (userId: string) {
    const api = yield* Api;
    yield* api.deleteUser(userId);
    // This invalidates all loaders watching "users"
    yield* Reactivity.invalidate(["users"]);
  }),
  { reactivityKeys: ["users"] },
);
```

**Optimistic navigation — show stale data immediately, revalidate in background:**

```ts
Route.loader(
  (params) => Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.findUser(params.userId);
  }),
  {
    staleTime: "5 minutes",
    // When navigating to this route with stale cache:
    // Show stale data immediately, revalidate in background
    staleWhileRevalidate: true,
  },
),
```

When the user navigates to `/users/alice` and there's stale cached data:

1. Component renders immediately with cached data
2. Loader runs in background
3. When fresh data arrives, component reactively updates
4. `isPending` is true during revalidation

The user sees content instantly. No loading spinner for previously-visited pages.

**SEO — metadata from loaders:**

Loader data feeds SEO metadata. The `Route.meta` pipe can access loader data:

```ts
const UserProfile = Component.make(/* ... */).pipe(
  Component.route("/:userId", {
    params: Schema.Struct({ userId: Schema.String }),
  }),
  Route.loader((params) =>
    Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.findUser(params.userId);
    })
  ),
  // Meta receives loader data — typed
  Route.meta((loaderData: User) => ({
    title: `${loaderData.name} — Profile`,
    description: `View ${loaderData.name}'s profile and activity`,
    openGraph: {
      title: loaderData.name,
      description: `${loaderData.name} — ${loaderData.bio}`,
      image: loaderData.avatarUrl,
      type: "profile",
    },
    twitter: {
      card: "summary",
      title: loaderData.name,
      description: loaderData.bio,
      image: loaderData.avatarUrl,
    },
    canonical: `/users/${loaderData.id}`,
    jsonLd: {
      "@type": "Person",
      name: loaderData.name,
      image: loaderData.avatarUrl,
      url: `/users/${loaderData.id}`,
    },
  })),
);
```

`Route.meta` receives the loader's return type. TypeScript verifies that the meta function accesses valid fields on the loader data. If the loader returns `User`, the meta function gets `User`.

**How meta renders on the server:**

During SSR, the router collects all matched routes' meta and renders them into `<head>`:

```ts
const renderPage = (url: URL) =>
  Effect.gen(function* () {
    const matched = matchRouteTree(url, routeTree);

    // Run all loaders
    const loaderResults = yield* runLoaders(matched);

    // Collect meta from all matched routes
    const meta = matched
      .filter((route) => route.meta)
      .map((route) => {
        const data = loaderResults.get(route.id);
        return route.meta!(data);
      });

    // Merge meta — deeper routes override shallower ones
    const mergedMeta = mergeMeta(meta);

    // Render head
    const headHtml = renderMeta(mergedMeta);

    // Render body
    const bodyHtml = yield* renderComponentTree(matched, loaderResults);

    return `
      <!DOCTYPE html>
      <html lang="${mergedMeta.lang ?? "en"}">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${mergedMeta.title}</title>
          <meta name="description" content="${mergedMeta.description}" />
          ${mergedMeta.canonical ? `<link rel="canonical" href="${mergedMeta.canonical}" />` : ""}
          ${renderOpenGraphTags(mergedMeta.openGraph)}
          ${renderTwitterTags(mergedMeta.twitter)}
          ${mergedMeta.jsonLd ? `<script type="application/ld+json">${JSON.stringify(mergedMeta.jsonLd)}</script>` : ""}
          ${renderStyleSheets()}
        </head>
        <body>
          <div id="root">${bodyHtml}</div>
          <script>window.__LOADER_DATA__ = ${JSON.stringify(Object.fromEntries(loaderResults))}</script>
          <script src="/app.js"></script>
        </body>
      </html>
    `;
  });
```

On the client, `Route.meta` updates `document.title` and meta tags when navigating:

```ts
// Client-side meta update on navigation
const updateMeta = (meta: RouteMeta) =>
  Effect.sync(() => {
    document.title = meta.title;

    // Update meta tags
    updateMetaTag("description", meta.description);
    updateMetaTag("og:title", meta.openGraph?.title);
    updateMetaTag("og:description", meta.openGraph?.description);
    updateMetaTag("og:image", meta.openGraph?.image);
    updateMetaTag("twitter:title", meta.twitter?.title);
    updateMetaTag("twitter:description", meta.twitter?.description);

    // Update canonical
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical && meta.canonical) {
      canonical.setAttribute("href", meta.canonical);
    }

    // Update JSON-LD
    const jsonLd = document.querySelector('script[type="application/ld+json"]');
    if (jsonLd && meta.jsonLd) {
      jsonLd.textContent = JSON.stringify(meta.jsonLd);
    }
  });
```

**Structured data and sitemap generation:**

Because routes have typed params and loaders, you can generate a sitemap by crawling the route tree:

```ts
const generateSitemap = Effect.gen(function* () {
  const routes = Route.collectAll(App);
  const urls: SitemapUrl[] = [];

  for (const route of routes) {
    if (route.meta?.noIndex) continue;

    if (route.isDynamic) {
      // Dynamic routes need their params enumerated
      // Use the loader's data source to enumerate all possible params
      if (route.sitemapParams) {
        const params = yield* route.sitemapParams();
        for (const p of params) {
          urls.push({
            loc: route.link(p),
            lastmod: route.meta?.lastmod,
            changefreq: route.meta?.changefreq ?? "weekly",
            priority: route.meta?.priority ?? 0.5,
          });
        }
      }
    } else {
      // Static routes
      urls.push({
        loc: route.pattern,
        changefreq: route.meta?.changefreq ?? "monthly",
        priority: route.meta?.priority ?? 0.5,
      });
    }
  }

  return renderSitemapXml(urls);
});
```

Provide sitemap params via pipe:

```ts
const UserProfile = Component.make(/* ... */).pipe(
  Component.route("/:userId", { params: userParamsSchema }),
  Route.loader(loadUser),
  Route.meta(userMeta),
  // For sitemap generation — enumerate all valid params
  Route.sitemapParams(() =>
    Effect.gen(function* () {
      const api = yield* Api;
      const users = yield* api.listAllUserIds();
      return users.map((id) => ({ userId: id }));
    })
  ),
);
```

**Static generation (SSG) — build all pages at build time:**

```ts
const generateStaticSite = Effect.gen(function* () {
  const routes = Route.collectAll(App);
  const fs = yield* FileSystem;

  // Enumerate all pages
  const pages: { url: string; params: any }[] = [];

  for (const route of routes) {
    if (route.isDynamic) {
      if (route.sitemapParams) {
        const params = yield* route.sitemapParams();
        for (const p of params) {
          pages.push({ url: route.link(p), params: p });
        }
      }
    } else {
      pages.push({ url: route.pattern, params: {} });
    }
  }

  // Generate all pages in parallel
  yield* Effect.forEach(
    pages,
    (page) => Effect.gen(function* () {
      const html = yield* renderPage(new URL(page.url, "https://mysite.com"));
      const filePath = `dist${page.url === "/" ? "/index" : page.url}.html`;
      yield* fs.writeFile(filePath, html);
    }),
    { concurrency: 10 },
  );

  // Generate sitemap
  const sitemap = yield* generateSitemap;
  yield* fs.writeFile("dist/sitemap.xml", sitemap);

  // Generate robots.txt
  yield* fs.writeFile("dist/robots.txt", `
    User-agent: *
    Allow: /
    Sitemap: https://mysite.com/sitemap.xml
  `);
});
```

Ten pages generated in parallel, each with its own loaders running concurrently, all typed, all using the same component and loader code that runs in the browser.

**Incremental static regeneration (ISR):**

```ts
Route.loader(
  (params) => Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.findUser(params.userId);
  }),
  {
    // ISR: regenerate this page every 5 minutes
    revalidate: "5 minutes",
  },
),
```

The server serves the cached static page and revalidates in the background:

```ts
const handleRequest = (req: Request) =>
  Effect.gen(function* () {
    const url = new URL(req.url);
    const matched = matchRouteTree(url, routeTree);

    // Check static cache
    const cached = yield* staticCache.get(url.pathname);

    if (cached && !isExpired(cached, matched)) {
      // Serve from cache
      // Trigger background revalidation if stale
      if (isStale(cached, matched)) {
        yield* revalidateInBackground(url, matched).pipe(Effect.forkDaemon);
      }
      return new Response(cached.html, {
        headers: {
          "Content-Type": "text/html",
          "X-Cache": isStale(cached, matched) ? "STALE" : "HIT",
          "Cache-Control": `s-maxage=${getMaxAge(matched)}, stale-while-revalidate`,
        },
      });
    }

    // Cache miss — render fresh
    const html = yield* renderPage(url);
    yield* staticCache.set(url.pathname, html);
    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
        "X-Cache": "MISS",
      },
    });
  });
```

**Streaming SSR with loader priorities:**

Not all loaders are equally important. The user's name should appear immediately. Their activity feed can stream later:

```ts
const UserProfile = Component.make(/* ... */).pipe(
  Component.route("/:userId", { params: userParamsSchema }),
  // Critical loader — blocks initial render
  Route.loader(
    (params) => Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.findUser(params.userId);
    }),
    { priority: "critical" },  // render waits for this
  ),
);

const UserActivity = Component.make(/* ... */).pipe(
  Component.route("/activity", {}),
  // Deferred loader — streams after initial render
  Route.loader(
    (params, deps) => Effect.gen(function* () {
      const user = deps.parent<User>();
      const api = yield* Api;
      return yield* api.getUserActivity(user.id);
    }),
    {
      priority: "deferred",    // render doesn't wait for this
      dependsOnParent: true,
    },
  ),
);
```

The SSR stream sends the shell and critical data first, then streams deferred data:

```
Browser receives:
1. <html><head>...</head><body>     ← immediate
2. <div id="root">                  ← immediate
3.   <nav>...</nav>                 ← immediate (no loader)
4.   <div class="profile">         ← immediate (critical loader completed)
5.     <h1>Alice</h1>              ← immediate (from critical loader data)
6.     <div class="activity">      ← immediate (shell with skeleton)
7.       <div class="skeleton"/>   ← immediate (loading state)
8.     </div>                      ← immediate
9.   </div>                        ← immediate
10. </div>                         ← immediate

... time passes while deferred loader runs ...

11. <script>                        ← streamed when deferred loader completes
12.   window.__LOADER_DATA__["activity"] = [...]
13.   window.__HYDRATE_ROUTE__("activity")
14. </script>
15. </body></html>                  ← final
```

The user sees the profile name immediately (from critical loader). The activity feed shows a skeleton and fills in when its data streams in.

**Error handling for loaders:**

Loader errors should be catchable at the route level:

```ts
const UserProfile = Component.make(/* ... */).pipe(
  Component.route("/:userId", { params: userParamsSchema }),
  Route.loader(loadUser),
  // Loader error handler — renders instead of the component when loader fails
  Route.loaderError({
    // Specific error handling
    UserNotFound: (error, params) => (
      <Box>
        <Text>User "{params.userId}" not found</Text>
        <Route.Link to={userListLink} params={{}}>Back to users</Route.Link>
      </Box>
    ),
    // Generic error fallback
    _: (error) => (
      <Box>
        <Text>Failed to load user profile</Text>
        <Button onPress={() => Route.reload()}>Retry</Button>
      </Box>
    ),
  }),
);
```

Loader errors are tagged (because Effect errors are tagged). The error handler can pattern-match on error types. Unhandled errors propagate to the nearest `TypedBoundary`.

For SSR, loader errors produce appropriate HTTP status codes:

```ts
Route.loaderError({
  UserNotFound: {
    status: 404,
    render: (error, params) => <NotFoundPage />,
  },
  Unauthorized: {
    status: 401,
    redirect: loginLink({}),
  },
  _: {
    status: 500,
    render: (error) => <ErrorPage />,
  },
}),
```

**Loader actions — mutations that revalidate loaders:**

When a mutation succeeds, relevant loaders should revalidate. This is already handled by `Reactivity` keys, but loaders add route-scoped actions for convenience:

```ts
const UserProfile = Component.make(
  Component.props<{}>(),
  Component.require(Api),
  (props) => Effect.gen(function* () {
    const user = yield* Route.loaderData<User>();

    // Route.action creates a mutation that automatically revalidates this route's loader
    const updateUser = yield* Route.action(
      Effect.fn(function* (data: Partial<User>) {
        const api = yield* Api;
        yield* api.updateUser(user().id, data);
        // No need for Reactivity.invalidate — Route.action handles it
      }),
    );

    return { user, updateUser };
  }),
  // ...
).pipe(
  Component.route("/:userId", { params: userParamsSchema }),
  Route.loader(loadUser, { reactivityKeys: ["users"] }),
);
```

`Route.action` creates an action that, on success, invalidates the current route's loader automatically. You don't need to wire `reactivityKeys` manually — the action knows which route it belongs to.

For cross-route invalidation, use `reactivityKeys` explicitly:

```ts
const deleteUser = yield* Route.action(
  Effect.fn(function* (userId: string) {
    const api = yield* Api;
    yield* api.deleteUser(userId);
  }),
  {
    // Invalidate the current route AND the user list route
    reactivityKeys: ["users"],
    // Navigate after deletion
    onSuccess: () => router.navigate(userListLink({})),
  },
);
```

**The complete loader pipeline:**

```
Navigation triggered (click, programmatic, back/forward)
  │
  ├── 1. Match route tree (root → leaf)
  │     URL → [App, UsersLayout, UserProfile]
  │
  ├── 2. Check loader cache
  │     For each matched route with a loader:
  │       Cache hit + fresh → use cached data
  │       Cache hit + stale → use cached, revalidate in background
  │       Cache miss → need to run loader
  │
  ├── 3. Build loader dependency graph
  │     Independent loaders → parallel batch 1
  │     Dependent loaders → wait for parent, then parallel batch 2
  │
  ├── 4. Run loaders (Effect.all with concurrency: "unbounded")
  │     ├── Loader A (users stats)  → ─┐
  │     ├── Loader B (user profile) → ─┼── all in parallel
  │     └── Loader C (user posts)   → ─┘   (or batched by dependency)
  │
  ├── 5. Handle results
  │     Success → cache data, provide to component via Route.loaderData
  │     Error → Route.loaderError fallback or propagate to boundary
  │     Timeout → configurable per-loader
  │
  ├── 6. Render
  │     Streaming:
  │       Critical loaders block initial render
  │       Deferred loaders stream via script tags
  │     Non-streaming:
  │       All loaders complete → render
  │
  └── 7. Hydration (SSR → client)
        Loader data serialized in __LOADER_DATA__
        Client reads from cache on first render (no re-fetch)
        Subsequent navigations use client-side loaders

Invalidation:
  Mutation → Reactivity.invalidate(keys) → matching loaders revalidate
  Route.action → auto-invalidates current route's loader
  Tab focus → revalidateOnFocus loaders re-run
  Network reconnect → revalidateOnReconnect loaders re-run
  Timer → staleTime expiry marks cache entry as stale

Prefetching:
  Link hover/focus/visible → run target route's loader(s) + load lazy chunks
  Results cached → navigation is instant

SEO:
  Route.meta(loaderData => meta) → typed meta from loader data
  SSR renders <head> with title, description, OG, Twitter, JSON-LD
  Client-side nav updates meta tags
  Route.sitemapParams → enumerate all pages for sitemap.xml
  SSG → generate all pages at build time with parallel loaders
```

Every piece is an Effect. Loaders are Effects. Loader error handling is typed. Loader caching uses `Reactivity` for invalidation. Prefetching is fire-and-forget Effects. Streaming uses Effect fibers. SSG uses `Effect.forEach` with concurrency. Meta functions receive typed loader data. Sitemap params are Effects that enumerate all valid route parameters.

The same loader code runs everywhere — browser, server, static generation, tests. The same component code renders everywhere. The same typed params, typed errors, typed meta. One codebase, every rendering strategy.