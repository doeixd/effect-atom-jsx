/**
 * R2 type surface: route sources are explicit, head/loader-cache stores are
 * values, and the loader handoff is a schema-validated envelope.
 */
import { Effect } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import * as Serialization from "../Serialization.js";
import { LoaderCacheTag, currentLoaderCacheStore, runCachedLoader, type LoaderCacheStore } from "../router-runtime.js";

const Base = Component.from<{}>(() => null);
const Tree = Route.path("/r2/:id")(Base);
const Node = Route.page("/r2-node", Base);
const Registry = Route.registry([Base.pipe(Component.route("/r2-registry"))]);

// A route tree root, a route node, and an explicit registry are all sources.
const _sources: ReadonlyArray<Route.RouteSource> = [Tree, Node, Registry];

// Every loader/sitemap entry point takes a source first; there is no global set.
const _loaders: Effect.Effect<
  ReadonlyArray<{ readonly routeId: string; readonly result: unknown }>,
  never,
  never
> = Route.runMatchedLoaders(Tree, new URL("http://test.local/r2/1"));
const _registryLoaders = Route.runMatchedLoaders(Registry, new URL("http://test.local/r2-registry"));
const _streaming = Route.runStreamingNavigation(Registry, new URL("http://test.local/r2-registry"));
const _sitemap: Effect.Effect<ReadonlyArray<{ readonly loc: string }>, never, never> =
  Route.collectSitemapEntries(Tree, "https://example.com");
const _prefetch: Effect.Effect<void, never, never> =
  Route.prefetch(Tree, Route.link(Tree), { id: "1" });

// @ts-expect-error a bare URL is no longer a route source
Route.runMatchedLoaders(new URL("http://test.local/r2/1"));
// @ts-expect-error a bare base URL is no longer accepted
Route.collectSitemapEntries("https://example.com");

// Resolving a source never adds a requirement, and may find nothing.
const _resolved: Effect.Effect<Route.RouteSource | undefined, never, never> = Route.resolveRouteSource();

// Head state is a store value, resolvable without adding a requirement.
const _headStore: Effect.Effect<Route.RouteHeadStore, never, never> = Route.currentRouteHeadStore;
const _madeHeadStore: Route.RouteHeadStore = Route.makeRouteHeadStore({ applyToDocument: false });
const _headId: string = Route.createRouteHeadId(_madeHeadStore);
const _head: Route.RouteHead = Route.resolveRouteHeadOf(_madeHeadStore);
// @ts-expect-error head mutation is store-scoped: the store is required
Route.setRouteHead({ id: "x", depth: 0 });

// Loader cache is an injectable service whose resolution keeps `R = never`.
const _cacheStore: Effect.Effect<LoaderCacheStore, never, never> = currentLoaderCacheStore;
const _cached: Effect.Effect<unknown, never, never> = runCachedLoader("id", {}, Effect.succeed(1));
declare const someStore: LoaderCacheStore;
const _scoped: Effect.Effect<unknown, never, never> = runCachedLoader("id", {}, Effect.succeed(1)).pipe(
  Effect.provideService(LoaderCacheTag, someStore),
);
const _entries: ReadonlyArray<Route.RegisteredRoute> = Route.collectAll(Tree);

// The handoff decodes through the injectable Serialization service and fails
// typed, never as a defect.
const _handoff: Effect.Effect<Route.LoaderHandoff, unknown, Serialization.SerializationService> =
  Route.readLoaderHandoff();
const _hydrate: Effect.Effect<void, unknown, Serialization.SerializationService> =
  Route.hydrateLoaderHandoff(Tree);
const _version: 1 = Route.loaderHandoffVersion;

export type _R2TypeChecks = [
  typeof _sources,
  typeof _loaders,
  typeof _registryLoaders,
  typeof _streaming,
  typeof _sitemap,
  typeof _prefetch,
  typeof _resolved,
  typeof _headStore,
  typeof _headId,
  typeof _head,
  typeof _cacheStore,
  typeof _cached,
  typeof _scoped,
  typeof _entries,
  typeof _handoff,
  typeof _hydrate,
  typeof _version,
];
