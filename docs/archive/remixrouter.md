Remix Router
The @remix-run/router package is a framework-agnostic routing package (sometimes referred to as a browser-emulator) that serves as the heart of React Router and Remix and provides all the core functionality for routing coupled with data loading and data mutations. It comes with built-in handling of errors, race-conditions, interruptions, cancellations, lazy-loading data, and much, much more.

If you're using React Router, you should never import anything directly from the @remix-run/router - you should have everything you need in react-router-dom (or react-router/react-router-native if you're not rendering in the browser). All of those packages should re-export everything you would otherwise need from @remix-run/router.

[!WARNING]

This router is a low-level package intended to be consumed by UI layer routing libraries. You should very likely not be using this package directly unless you are authoring a routing library such as react-router-dom or one of it's other UI ports.

API
A Router instance can be created using createRouter:

// Create and initialize a router.  "initialize" contains all side effects
// including history listeners and kicking off the initial data fetch
let router = createRouter({
  // Required properties
  routes: [{
    path: '/',
    loader: ({ request, params }) => { /* ... */ },
    children: [{
      path: 'home',
      loader: ({ request, params }) => { /* ... */ },
    }]
  },
  history: createBrowserHistory(),

  // Optional properties
  basename, // Base path
  mapRouteProperties, // Map framework-agnostic routes to framework-aware routes
  future, // Future flags
  hydrationData, // Hydration data if using server-side-rendering
}).initialize();
Internally, the Router represents the state in an object of the following format, which is available through router.state. You can also register a subscriber of the signature (state: RouterState) => void to execute when the state updates via router.subscribe();

interface RouterState {
  // False during the initial data load, true once we have our initial data
  initialized: boolean;
  // The `history` action of the most recently completed navigation
  historyAction: Action;
  // The current location of the router.  During a navigation this reflects
  // the "old" location and is updated upon completion of the navigation
  location: Location;
  // The current set of route matches
  matches: DataRouteMatch[];
  // The state of the current navigation
  navigation: Navigation;
  // The state of any in-progress router.revalidate() calls
  revalidation: RevalidationState;
  // Data from the loaders for the current matches
  loaderData: RouteData;
  // Data from the action for the current matches
  actionData: RouteData | null;
  // Errors thrown from loaders/actions for the current matches
  errors: RouteData | null;
  // Map of all active fetchers
  fetchers: Map<string, Fetcher>;
  // Scroll position to restore to for the active Location, false if we
  // should not restore, or null if we don't have a saved position
  // Note: must be enabled via router.enableScrollRestoration()
  restoreScrollPosition: number | false | null;
  // Proxied `preventScrollReset` value passed to router.navigate()
  preventScrollReset: boolean;
}
Navigations
All navigations are done through the router.navigate API which is overloaded to support different types of navigations:

// Link navigation (pushes onto the history stack by default)
router.navigate("/page");

// Link navigation (replacing the history stack)
router.navigate("/page", { replace: true });

// Pop navigation (moving backward/forward in the history stack)
router.navigate(-1);

// Form submission navigation
let formData = new FormData();
formData.append(key, value);
router.navigate("/page", {
  formMethod: "post",
  formData,
});

// Relative routing from a source routeId
router.navigate("../../somewhere", {
  fromRouteId: "active-route-id",
});
Fetchers
Fetchers are a mechanism to call loaders/actions without triggering a navigation, and are done through the router.fetch() API. All fetch calls require a unique key to identify the fetcher.

// Execute the loader for /page
router.fetch("key", "/page");

// Submit to the action for /page
let formData = new FormData();
formData.append(key, value);
router.fetch("key", "/page", {
  formMethod: "post",
  formData,
});
Revalidation
By default, active loaders will revalidate after any navigation or fetcher mutation. If you need to kick off a revalidation for other use-cases, you can use router.revalidate() to re-execute all active loaders.

Future Flags
We use Future Flags in the router to help us introduce breaking changes in an opt-in fashion ahead of major releases. Please check out the blog post and React Router Docs for more information on this process. The currently available future flags in @remix-run/router are:

Flag	Description
v7_normalizeFormMethod	Normalize useNavigation().formMethod to be an uppercase HTTP Method
v7_prependBasename	Prepend the basename to incoming router.navigate/router.fetch paths

[![npm version](https://badge.fury.io/js/@doeixd%2Fcombi-router.svg)](https://badge.fury.io/js/@doeixd%2Fcombi-router) [![TypeScript](https://img.shields.io/badge/-TypeScript-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/) [![Build Status](https://img.shields.io/github/actions/workflow/status/doeixd/combi-router/ci.yml?branch=main)](https://github.com/doeixd/combi-router/actions)

# Combi-Router 🛤️

A composable, type-safe router built on my parser combinator library [Combi Parse](https://github.com/doeixd/combi-parse) that thinks in trees. Routes are defined functionally and composed by reference, creating natural hierarchies that mirror your application structure.

<br />

## 📦 Installation

```bash
npm install @doeixd/combi-router @doeixd/combi-parse zod
```

Combi-Router is built on `@doeixd/combi-parse` for robust URL parsing and uses `zod` for powerful, type-safe parameter validation.

<br />

## ✨ Key Features
&nbsp;&nbsp;🔗 **Type-Safe & Composable**  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Build routes functionally and compose them by reference for perfect type safety and effortless refactoring.

&nbsp;&nbsp;🌳 **Hierarchical & Introspective**  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Routes create natural trees that mirror your app's structure, with built-in utilities to analyze the hierarchy.

&nbsp;&nbsp;⚡ **Powerful Parallel Data Loading**  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Automatically run data loaders for all nested routes in parallel (not sequentially), achieving 2-3x faster page loads. Advanced resource system with Suspense, caching, retries, and invalidation.

&nbsp;&nbsp;🧩 **Composable Layer Architecture**  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Build your ideal router by mixing and matching feature layers (data, performance, dev tools) or creating your own.

&nbsp;&nbsp; 🛡️ **Advanced Navigation & Guards**  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Navigate with detailed results, cancellation support, and robust, type-safe route guards for fine-grained access control.

&nbsp;&nbsp;🎨 **Enhanced View Layer**  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Universal template support with morphdom integration, true nested routing with outlets, and support for any templating system.

&nbsp;&nbsp;🔎 **Integrated SEO & Head Management**  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Dynamically manage document head tags, including titles, meta descriptions, and social cards, directly from your route definitions.

&nbsp;&nbsp; ✂️ **Tree-Shakeable & Modular**  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; A modular design ensures you only bundle the features you use, keeping your app lean and fast.

&nbsp;&nbsp; 🛠️ **Superior Developer Experience**  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Get dev-mode warnings, advanced debugging utilities, and detailed route analysis right out of the box.



<!--
  🔗 **Type-Safe & Composable:** Build routes functionally and compose them by reference for perfect type safety and effortless refactoring.
  
  🌳 **Hierarchical & Introspective:** Routes create natural trees that mirror your app's structure, with built-in utilities to analyze the hierarchy.
  
  ⚡ **Powerful Data Loading:** Run data loaders for nested routes in parallel, with an advanced resource system featuring Suspense, caching, retries, and invalidation.

  🧩 **Composable Layer Architecture:** Build your ideal router by mixing and matching feature layers (data, performance, dev tools) or creating your own.
  
  ✂️ **Tree-Shakeable & Modular:** A modular design ensures you only bundle the features you use, keeping your app lean and fast.
  
  🚀 **Production Ready:** Includes intelligent prefetching, scroll restoration, memory management, and automatic support for the native View Transitions API.
  
  🛠️ **Superior Developer Experience:** Get dev-mode warnings, advanced debugging utilities, and detailed route analysis right out of the box.
  
  🌐 **Framework Agnostic:** Works seamlessly with any framework (React, Vue, Svelte) or vanilla JS, including a set of ready-to-use helpers and Web Components.

### **Core Routing**
- **Reference-Based Navigation**: Navigate using route objects for perfect type safety.
- **Functional Composition**: Build routes by composing pure functions instead of method chaining.
- **Hierarchical Matching**: Routes extend each other by reference, creating intuitive, nested trees.
- **Route Introspection**: Built-in utilities for analyzing route structure (depth, ancestors, static paths).
- **Advanced Navigation**: Detailed NavigationResult with error handling and cancellation support.
- **Typed Guards**: Type-safe route protection with full parameter and context access.

### **Data Loading & Resources**
- **Parallel Data Loading**: Loaders for all active nested routes run concurrently for maximum speed.
- **Suspense & Resources**: Elegant, built-in support for handling asynchronous data states.
- **Advanced Resource System**: Enhanced resources with retry logic, caching, and invalidation strategies.
- **Cache Tags & Invalidation**: Powerful cache management with tag-based invalidation.
- **Global Resource State**: Centralized resource monitoring and observability.

### **Composable Layer Architecture** 🧩
- **Layer-Based Composition**: Build routers by composing independent feature layers using `makeLayered`.
- **Built-in Layers**: Core navigation, data management, dev tools, performance, scroll restoration, transitions.
- **User-Extensible**: Create custom layers for analytics, authentication, or any business logic.
- **Self-Aware Layers**: Layers can call methods from previous layers for powerful orchestration.
- **Conditional Composition**: Apply layers based on environment or feature flags.
- **Type-Safe Extensions**: TypeScript correctly infers the final router shape across all layers.
- **Tree-Shaking Optimized**: Only bundle the layers you actually use.

### **Modular Architecture**
- **Core Module**: Essential routing functionality (`@doeixd/combi-router/core`).
- **Data Module**: Advanced resource and caching features (`@doeixd/combi-router/data`).
- **Features Module**: Production optimizations (`@doeixd/combi-router/features`).
- **Layers Module**: Composable layer system (`@doeixd/combi-router/layers`).
- **Dev Module**: Development tools and debugging (`@doeixd/combi-router/dev`).
- **Utils Module**: Framework-agnostic utilities (`@doeixd/combi-router/utils`).

### **Integrated Layer System**
- **Data Layer**: Advanced caching, resource management, and suspense-based data fetching.
- **Dev Layer**: Comprehensive development tools, debugging, and performance monitoring.
- **Performance Layer**: Intelligent prefetching, viewport-aware loading, and memory management.
- **Scroll Restoration Layer**: Configurable scroll position management with state preservation.
- **Transitions Layer**: Sophisticated page transitions with proper lifecycle management.
- **Head Management Layer**: Dynamic document head management for SEO and social sharing.

### **Developer Experience**
- **Dev Mode Warnings**: Comprehensive development-time validation and conflict detection.
- **Enhanced Debugging**: Advanced debugging utilities with performance monitoring.
- **Route Analysis**: Detailed route structure analysis and optimization suggestions.
- **Type Safety Improvements**: Better StandardSchema integration and parameter inference.

### **Production Features**
- **Performance Optimizations**: Intelligent prefetching, viewport-aware loading, and memory management.
- **Scroll Restoration**: Configurable scroll position management with state preservation.
- **Enhanced Code Splitting**: Advanced lazy loading strategies with priority-based prefetching.
- **Advanced Transition System**: Sophisticated page transitions with proper lifecycle management.
- **View Transitions**: App-like animated page transitions enabled by default in supported browsers.

### **Framework Support**
- **End-to-End Type Safety**: Full TypeScript inference from route definition to data access.
- **Production Ready**: Caching, preloading, guards, lazy-loading, and error boundaries.
- **Framework Agnostic**: Works with React, Vue, Svelte, or vanilla JavaScript.
- **Web Components**: Ready-to-use declarative routing components.

-->

<br />

## 🚀 Quick Start

Let's start simple and build up your understanding step by step.

### Understanding Routes

A **route** in Combi-Router is a blueprint that describes a URL's structure and behavior.

```typescript
import { route, path } from '@doeixd/combi-router';

// This route matches the exact path "/users"
export const usersRoute = route(path('users'));
```

The `route()` function creates a new route from **matchers**. Matchers are small building blocks that each handle one part of a URL.

**Why export routes?** Routes are first-class objects you'll reference throughout your app for navigation, so treating them as exportable values makes them reusable and type-safe.

### Basic Matchers

```typescript
import { route, path, param } from '@doeixd/combi-router';
import { z } from 'zod';

// Static path segment
export const aboutRoute = route(path('about'));  // matches "/about"

// Dynamic parameter with validation
export const userRoute = route(
  path('users'),
  param('id', z.number())  // matches "/users/123" -> params.id is a number
);
```

**Why validation?** URLs are just strings. By validating during route matching, you catch errors early and get proper TypeScript types for your parameters.

### Building Route Trees

The real power comes from **composing routes by reference**. Instead of redefining common parts, you `extend` existing routes:

```typescript
import { extend } from '@doeixd/combi-router';

// Base route
export const dashboardRoute = route(path('dashboard'));

// Extend the base route
export const usersRoute = extend(dashboardRoute, path('users'));
export const userRoute = extend(usersRoute, param('id', z.number()));

// This creates a natural tree:
// /dashboard           <- dashboardRoute
// /dashboard/users     <- usersRoute  
// /dashboard/users/123 <- userRoute
```

**Why extend?** When you change the base route (e.g., to `/admin`), all extended routes automatically update. Your route structure mirrors your application structure.

### Adding Behavior with Higher-Order Functions

Enhance routes with additional behavior using `pipe()` and higher-order functions:

```typescript
import { meta, loader, layout, pipe } from '@doeixd/combi-router';

export const enhancedUserRoute = pipe(
  userRoute,
  meta({ title: 'User Profile' }),
  loader(async ({ params }) => {
    const user = await fetchUser(params.id);
    return { user };
  }),
  layout(ProfileLayout)
);
```

**Why higher-order functions?** They're composable and reusable. You can create your own enhancers and mix them with built-in ones.

### Creating the Router

Once you have routes, create a router instance from an array of all your routes:

```typescript
import { createRouter } from '@doeixd/combi-router';

const router = createRouter([
  dashboardRoute,
  usersRoute,
  enhancedUserRoute
]);

// Reference-based navigation with detailed results
const result = await router.navigate(enhancedUserRoute, { id: 123 });
if (result.success) {
  console.log('Navigation successful');
} else {
  console.error('Navigation failed:', result.error);
}

// Simple navigation for backward compatibility  
const success = await router.navigateSimple(enhancedUserRoute, { id: 123 });

// Type-safe URL building
const userUrl = router.build(enhancedUserRoute, { id: 123 }); // "/dashboard/users/123"
```

**Why route references?** Using actual route objects instead of string names provides perfect type inference and makes refactoring safe. TypeScript knows exactly what parameters each route needs.

<br />

## 🏗️ Core Concepts

### Route Building Improvements

#### Route Introspection Utilities

Routes now provide powerful introspection capabilities to analyze their structure:

```typescript
import { route, extend, path, param } from '@doeixd/combi-router';
import { z } from 'zod';

const dashboardRoute = route(path('dashboard'));
const usersRoute = extend(dashboardRoute, path('users'));
const userRoute = extend(usersRoute, param('id', z.number()));

// Analyze route structure
console.log(userRoute.depth);        // 2 (dashboard -> users -> user)
console.log(userRoute.ancestors);    // [dashboardRoute, usersRoute]
console.log(userRoute.staticPath);   // "/dashboard/users"
console.log(userRoute.paramNames);   // ["id"]
console.log(userRoute.isDynamic);    // true
console.log(userRoute.routeChain);   // [dashboardRoute, usersRoute, userRoute]
```

#### Route Validation at Creation Time

Routes are now validated when created, catching common configuration errors early:

```typescript
import { RouteValidationError } from '@doeixd/combi-router';

try {
  // This will throw if there are duplicate parameter names
  const problematicRoute = extend(
    route(param('id', z.string())),
    param('id', z.number()) // Error: Duplicate parameter name 'id'
  );
} catch (error) {
  if (error instanceof RouteValidationError) {
    console.error('Route configuration error:', error.message);
  }
}
```

#### Parent-Child Relationships

Routes maintain explicit parent-child relationships for better debugging and tooling:

```typescript
console.log(userRoute.parent === usersRoute);     // true
console.log(usersRoute.parent === dashboardRoute); // true
console.log(dashboardRoute.parent);               // null (root route)

// Walk up the hierarchy
let current = userRoute;
while (current) {
  console.log(current.staticPath);
  current = current.parent;
}
// Output: "/dashboard/users", "/dashboard", "/"
```

### Route Matchers

Matchers are the building blocks of routes. Each matcher handles one aspect of URL parsing:

```typescript
// Path segments
path('users')                    // matches "/users"
path.optional('category')        // matches "/category" or ""
path.wildcard('segments')        // matches "/any/number/of/segments"

// Parameters with validation
param('id', z.number())          // matches "/123" and validates as number
param('slug', z.string().min(3)) // matches "/hello" with minimum length

// Query parameters
query('page', z.number().default(1)) // matches "?page=5"
query.optional('search', z.string()) // matches "?search=term"

// Other components
end                              // ensures no remaining path segments
// subdomain(...) and hash(...) can be added with similar patterns
```

### Route Composition

Routes are composed functionally using `extend()`:

```typescript
export const apiRoute = route(path('api'), path('v1'));
export const usersRoute = extend(apiRoute, path('users'));
export const userRoute = extend(usersRoute, param('id', z.number()));

// userRoute now matches /api/v1/users/123
```

Parameters from parent routes are automatically inherited and merged into a single `params` object.

### Parallel Data Loading

Combi-Router automatically executes loaders for all nested routes **in parallel**, not sequentially. This is a key performance feature that makes deeply nested routes load 2-3x faster.

```typescript
// Example: Three-level nested route with loaders
const orgRoute = pipe(
  route(path('org'), param('orgId', z.string())),
  loader(async ({ params }) => {
    // Fetches organization data (500ms)
    return { org: await fetchOrg(params.orgId) };
  })
);

const teamRoute = pipe(
  extend(orgRoute, path('team'), param('teamId', z.string())),
  loader(async ({ params }) => {
    // Fetches team data (400ms)
    return { team: await fetchTeam(params.teamId) };
  })
);

const memberRoute = pipe(
  extend(teamRoute, path('member'), param('memberId', z.string())),
  loader(async ({ params }) => {
    // Fetches member data (300ms)
    return { member: await fetchMember(params.memberId) };
  })
);

// When navigating to /org/1/team/2/member/3:
// ✅ All three loaders execute simultaneously
// ✅ Total load time: 500ms (the slowest loader)
// ❌ Without parallel loading: 1200ms (500+400+300)
```

**Why it matters:** Traditional routers often load data sequentially, causing waterfalls. Combi-Router's parallel loading ensures optimal performance by default, without any configuration needed.

### Higher-Order Route Enhancers

Enhance routes with additional functionality:

```typescript
import { pipe, meta, loader, guard, cache, lazy } from '@doeixd/combi-router';

export const userRoute = pipe(
  route(path('users'), param('id', z.number())),
  meta({ title: (params) => `User ${params.id}` }),
  loader(async ({ params }) => ({ user: await fetchUser(params.id) })),
  guard(async () => await isAuthenticated() || '/login'),
  cache({ ttl: 5 * 60 * 1000 }), // Cache for 5 minutes
  lazy(() => import('./UserProfile'))
);
```

<br />

## 🔧 Modular Architecture

Combi-Router now features a modular architecture optimized for tree-shaking and selective feature adoption.

### Import Paths

```typescript
// Core routing functionality (always included)
import { route, extend, createRouter } from '@doeixd/combi-router';

// Enhanced view layer with morphdom and template support
import { 
  createEnhancedViewLayer,
  enhancedView,
  lazyView,
  conditionalView
} from '@doeixd/combi-router/enhanced-view';

// Advanced data loading and caching
import { createAdvancedResource, resourceState } from '@doeixd/combi-router/data';

// Production features and optimizations
import { 
  PerformanceManager,
  ScrollRestorationManager,
  TransitionManager 
} from '@doeixd/combi-router/features';

// Development tools and debugging
import { 
  createWarningSystem, 
  analyzeRoutes,
  DebugUtils 
} from '@doeixd/combi-router/dev';

// Framework-agnostic utilities
import { 
  createLink, 
  createActiveLink,
  createOutlet 
} from '@doeixd/combi-router/utils';
```

### Module Breakdown

#### Core Module (`@doeixd/combi-router`)
Essential routing functionality including route definition, matching, navigation, and basic data loading.

```typescript
import { 
  route, extend, path, param, query,
  createRouter, pipe, meta, loader, guard
} from '@doeixd/combi-router';
```

#### Data Module (`@doeixd/combi-router/data`)
Advanced resource management with caching, retry logic, and global state management.

```typescript
import { 
  createAdvancedResource,
  resourceState,
  globalCache 
} from '@doeixd/combi-router/data';

// Enhanced resource with retry and caching
const userResource = createAdvancedResource(
  () => api.fetchUser(userId),
  {
    retry: { attempts: 3 },
    cache: { ttl: 300000, invalidateOn: ['user'] },
    staleTime: 60000,
    backgroundRefetch: true
  }
);
```

#### Features Module (`@doeixd/combi-router/features`)
Production-ready features for performance optimization and user experience.

```typescript
import { 
  PerformanceManager,
  ScrollRestorationManager,
  TransitionManager,
  CodeSplittingManager 
} from '@doeixd/combi-router/features';

// Initialize performance monitoring
const performanceManager = new PerformanceManager({
  prefetchOnHover: true,
  prefetchViewport: true,
  enablePerformanceMonitoring: true,
  connectionAware: true
});
```

#### Dev Module (`@doeixd/combi-router/dev`)
Development tools for debugging and route analysis.

```typescript
import { 
  createWarningSystem,
  analyzeRoutes,
  DebugUtils,
  ConflictDetector 
} from '@doeixd/combi-router/dev';

// Create warning system for development
const warningSystem = createWarningSystem(router, {
  runtimeWarnings: true,
  performanceWarnings: true
});

// Quick route analysis
analyzeRoutes(router);
```

#### Utils Module (`@doeixd/combi-router/utils`)
Framework-agnostic utilities for DOM integration.

```typescript
import { 
  createLink,
  createActiveLink,
  createOutlet,
  createMatcher,
  createRouterStore 
} from '@doeixd/combi-router/utils';
```

### Bundle Size Optimization

The modular architecture enables significant bundle size optimization:

```typescript
// Minimal bundle - only core routing
import { route, extend, createRouter } from '@doeixd/combi-router';

// With advanced resources
import { createAdvancedResource } from '@doeixd/combi-router/data';

// With production features
import { PerformanceManager } from '@doeixd/combi-router/features';

// Development tools (excluded in production)
import { createWarningSystem } from '@doeixd/combi-router/dev';
// (dev only)
```

<br />

## 📊 Enhanced Resource System

The new resource system provides production-ready data loading with advanced features.

### Basic Resources with Parallel Loading

```typescript
import { createResource } from '@doeixd/combi-router';

// Simple suspense-based resource with automatic parallel fetching
const userRoute = pipe(
  route(path('users'), param('id', z.number())),
  loader(({ params }) => ({
    // These resources load in parallel automatically
    user: createResource(() => fetchUser(params.id)),
    posts: createResource(() => fetchUserPosts(params.id))
  }))
);

// In your component
function UserProfile() {
  const { user, posts } = router.currentMatch.data;
  
  // These will suspend until data is ready
  const userData = user.read();
  const postsData = posts.read();
  
  return <div>...</div>;
}
```

### Advanced Resources

```typescript
import { createAdvancedResource, resourceState } from '@doeixd/combi-router/data';

// Enhanced resource with all features
const userResource = createAdvancedResource(
  () => api.fetchUser(userId),
  {
    // Retry configuration with exponential backoff
    retry: {
      attempts: 3,
      delay: (attempt) => Math.min(1000 * Math.pow(2, attempt - 1), 10000),
      shouldRetry: (error) => error.status >= 500,
      onRetry: (error, attempt) => console.log(`Retry ${attempt}:`, error)
    },
    
    // Caching with tags for invalidation
    cache: {
      ttl: 300000, // 5 minutes
      invalidateOn: ['user', 'profile'],
      priority: 'high'
    },
    
    // Stale-while-revalidate behavior
    staleTime: 60000, // 1 minute
    backgroundRefetch: true
  }
);

// Check state without suspending
if (userResource.isLoading) {
  console.log('Loading user...');
}

// Non-suspending peek at cached data
const cachedUser = userResource.peek();
if (cachedUser) {
  console.log('Cached user:', cachedUser);
}

// Force refresh
await userResource.refetch();

// Invalidate resource
userResource.invalidate();
```

### Cache Management

```typescript
import { resourceState } from '@doeixd/combi-router/data';

// Global resource state monitoring
const globalState = resourceState.getGlobalState();
console.log('Loading resources:', globalState.loadingCount);

// Event system for observability
const unsubscribe = resourceState.onEvent((event) => {
  switch (event.type) {
    case 'fetch-start':
      console.log('Started loading:', event.resource);
      break;
    case 'fetch-success':
      console.log('Loaded successfully:', event.data);
      break;
    case 'fetch-error':
      console.error('Loading failed:', event.error);
      break;
    case 'retry':
      console.log(`Retry attempt ${event.attempt}:`, event.error);
      break;
  }
});

// Cache invalidation by tags
resourceState.invalidateByTags(['user', 'profile']);
```

<br />

## 🚀 Performance Features

### Intelligent Prefetching

```typescript
import { PerformanceManager } from '@doeixd/combi-router/features';

const performanceManager = new PerformanceManager({
  // Prefetch on hover with delay
  prefetchOnHover: true,
  
  // Prefetch when links enter viewport
  prefetchViewport: true,
  
  // Adjust behavior based on connection
  connectionAware: true,
  
  // Monitor performance metrics
  enablePerformanceMonitoring: true,
  
  // Preload critical routes immediately
  preloadCriticalRoutes: ['dashboard', 'user-profile'],
  
  // Memory management
  memoryManagement: {
    enabled: true,
    maxCacheSize: 50,
    maxCacheAge: 30 * 60 * 1000,
    cleanupInterval: 5 * 60 * 1000
  }
});

// Setup hover prefetching for a link
const cleanup = performanceManager.setupHoverPrefetch(linkElement, 'user-route');

// Setup viewport prefetching
const cleanupViewport = performanceManager.setupViewportPrefetch(linkElement, 'user-route');

// Get performance report
const report = performanceManager.getPerformanceReport();
console.log('Prefetch hit rate:', report.prefetchHitRate);
```

### Scroll Restoration

```typescript
import { ScrollRestorationManager } from '@doeixd/combi-router/features';

const scrollManager = new ScrollRestorationManager({
  enabled: true,
  restoreOnBack: true,
  restoreOnForward: true,
  saveScrollState: true,
  smoothScrolling: true,
  scrollBehavior: 'smooth',
  debounceTime: 100,
  
  // Advanced configuration
  customScrollContainer: '#main-content',
  excludeRoutes: ['modal-routes'],
  persistScrollState: true
});

// Manual scroll position management
scrollManager.saveScrollPosition(routeId);
scrollManager.restoreScrollPosition(routeId);
scrollManager.scrollToTop();
scrollManager.scrollToElement('#section');
```

### Advanced Transitions

```typescript
import { TransitionManager } from '@doeixd/combi-router/features';

const transitionManager = new TransitionManager({
  enabled: true,
  duration: 300,
  easing: 'ease-in-out',
  type: 'fade',
  
  // Per-route transition configuration
  routeTransitions: {
    'user-profile': { type: 'slide-left', duration: 400 },
    'settings': { type: 'fade', duration: 200 }
  },
  
  // Custom transition classes
  transitionClasses: {
    enter: 'page-enter',
    enterActive: 'page-enter-active',
    exit: 'page-exit',
    exitActive: 'page-exit-active'
  }
});

// Manual transition control
await transitionManager.performTransition(fromRoute, toRoute, {
  direction: 'forward',
  customData: { userId: 123 }
});
```

<br />

## 🛠️ Development Experience

### Development Warnings

```typescript
import { createWarningSystem, analyzeRoutes } from '@doeixd/combi-router/dev';

// Create comprehensive warning system
const warningSystem = createWarningSystem(router, {
  runtimeWarnings: true,
  staticWarnings: true,
  performanceWarnings: true,
  severityFilter: ['warning', 'error']
});

// Quick route analysis
analyzeRoutes(router);

// Get warnings programmatically
const warnings = warningSystem.getWarnings();
const conflictWarnings = warningSystem.getWarningsByType('conflicting-routes');
const errorWarnings = warningSystem.getWarningsBySeverity('error');
```

### Debugging Tools

```typescript
import { DebugUtils } from '@doeixd/combi-router/dev';

// Route structure debugging
DebugUtils.logRouteTree(router);
DebugUtils.analyzeRoutePerformance(router);
DebugUtils.checkRouteConflicts(router);

// Navigation debugging
DebugUtils.enableNavigationLogging(router);
DebugUtils.logMatchDetails(currentMatch);

// Performance debugging
DebugUtils.enablePerformanceMonitoring(router);
const metrics = DebugUtils.getPerformanceMetrics();
```

### Enhanced Error Handling

```typescript
import { NavigationErrorType } from '@doeixd/combi-router';

const result = await router.navigate(userRoute, { id: 123 });

if (!result.success) {
  switch (result.error?.type) {
    case NavigationErrorType.RouteNotFound:
      console.error('Route not found');
      break;
    case NavigationErrorType.GuardRejected:
      console.error('Navigation blocked:', result.error.message);
      break;
    case NavigationErrorType.LoaderFailed:
      console.error('Data loading failed:', result.error.originalError);
      break;
    case NavigationErrorType.ValidationFailed:
      console.error('Parameter validation failed');
      break;
    case NavigationErrorType.Cancelled:
      console.log('Navigation was cancelled');
      break;
  }
}
```

<br />

## 🔄 Migration Guide

### From v1.x to v2.x

#### Modular Imports

**Before:**
```typescript
import { createRouter, createResource, createLink } from '@doeixd/combi-router';
```

**After:**
```typescript
// Core functionality
import { createRouter } from '@doeixd/combi-router';

// Advanced resources (optional)
import { createAdvancedResource } from '@doeixd/combi-router/data';

// Utilities (optional)
import { createLink } from '@doeixd/combi-router/utils';
```

#### Enhanced Resources

**Before:**
```typescript
const resource = createResource(() => fetchUser(id));
```

**After:**
```typescript
// Simple resource (same API)
const resource = createResource(() => fetchUser(id));

// Or enhanced resource with more features
const resource = createAdvancedResource(
  () => fetchUser(id),
  {
    retry: { attempts: 3 },
    cache: { ttl: 300000 },
    staleTime: 60000
  }
);
```

#### Navigation API

The navigation API is fully backward compatible. Enhanced error handling is opt-in:

```typescript
// Old way (still works)
const success = await router.navigateSimple(route, params);

// New way (detailed error information)
const result = await router.navigate(route, params);
if (result.success) {
  // Handle success
} else {
  // Handle specific error types
}
```

<br />

## 🎨 Enhanced View Layer

The Enhanced View Layer extends Combi-Router with advanced DOM rendering capabilities, efficient updates through morphdom, and true nested routing support.

### Universal Template Support

Work with any templating system - lit-html, uhtml, Handlebars, or plain strings:

```typescript
import { createEnhancedViewLayer, enhancedView } from '@doeixd/combi-router/enhanced-view';
import { html } from 'lit-html';

// Using lit-html templates
const userRoute = pipe(
  route(path('user'), param('id', z.string()), end),
  enhancedView(({ match }) => html`
    <div class="user-profile">
      <h1>${match.data.user.name}</h1>
      <p>Email: ${match.data.user.email}</p>
    </div>
  `)
);

// Using custom template engines
import Handlebars from 'handlebars';

const template = Handlebars.compile(`
  <div class="product">
    <h2>{{name}}</h2>
    <p>Price: \${{price}}</p>
  </div>
`);

const productRoute = pipe(
  route(path('product'), param('id', z.string()), end),
  enhancedView(({ match }) => ({
    html: template(match.data.product)
  }))
);

// Configure the router with enhanced view layer
const router = createLayeredRouter(routes)
  (createCoreNavigationLayer())
  (createEnhancedViewLayer({
    root: '#app',
    useMorphdom: true,
    templateRenderer: (result, container) => {
      // Custom renderer for your template library
      if (result._$litType$) {
        litRender(result, container);
      }
    }
  }))
  ();
```

### Morphdom Integration

Enable efficient DOM patching that preserves form state, focus, and scroll position:

```typescript
import morphdom from 'morphdom';
import { setMorphdom } from '@doeixd/combi-router/enhanced-view';

// Provide morphdom implementation
setMorphdom(morphdom);

// Configure morphdom behavior
const router = createLayeredRouter(routes)
  (createCoreNavigationLayer())
  (createEnhancedViewLayer({
    root: '#app',
    useMorphdom: true,
    morphdomOptions: {
      onBeforeElUpdated: (fromEl, toEl) => {
        // Preserve focus
        if (fromEl === document.activeElement) {
          return false;
        }
        // Preserve form values
        if (fromEl.tagName === 'INPUT') {
          toEl.value = fromEl.value;
        }
        return true;
      },
      onElUpdated: (el) => {
        // Add animation classes
        el.classList.add('updated');
        setTimeout(() => el.classList.remove('updated'), 300);
      }
    }
  }))
  ();
```

### True Nested Routing with Outlets

Leverage the hierarchical route structure for automatic nested view rendering:

```typescript
// Parent route with outlet
const appRoute = pipe(
  route(path('')),
  enhancedView(() => html`
    <div class="app">
      <header>
        <nav>
          <a href="/">Home</a>
          <a href="/dashboard">Dashboard</a>
        </nav>
      </header>
      <!-- Child routes render here automatically -->
      <main router-outlet></main>
    </div>
  `)
);

// Dashboard with its own nested outlet
const dashboardRoute = pipe(
  extend(appRoute, path('dashboard')),
  enhancedView(({ match }) => html`
    <div class="dashboard">
      <aside>
        <a href="/dashboard/overview">Overview</a>
        <a href="/dashboard/analytics">Analytics</a>
      </aside>
      <!-- Nested child routes render here -->
      <section router-outlet router-outlet-parent="${match.route.id}">
      </section>
    </div>
  `)
);

// Child routes automatically render in parent outlets
const overviewRoute = pipe(
  extend(dashboardRoute, path('overview'), end),
  enhancedView(() => html`
    <div class="overview">
      <h2>Dashboard Overview</h2>
      <p>Your stats and metrics...</p>
    </div>
  `)
);
```

### Parallel Data Loading in Nested Routes

One of Combi-Router's most powerful features is **automatic parallel data fetching** for nested routes. When navigating to a deeply nested route, all loaders execute simultaneously, not sequentially.

#### How It Works

```typescript
// Each route has its own loader
const workspaceRoute = pipe(
  extend(appRoute, path('workspace'), param('workspaceId', z.string())),
  loader(async ({ params }) => {
    const workspace = await fetchWorkspace(params.workspaceId); // Takes 500ms
    return { workspace };
  })
);

const projectRoute = pipe(
  extend(workspaceRoute, path('project'), param('projectId', z.string())),
  loader(async ({ params }) => {
    const project = await fetchProject(params.projectId); // Takes 400ms
    return { project };
  })
);

const taskRoute = pipe(
  extend(projectRoute, path('task'), param('taskId', z.string())),
  loader(async ({ params }) => {
    const task = await fetchTask(params.taskId); // Takes 300ms
    return { task };
  })
);

// When navigating to /workspace/123/project/456/task/789:
// ALL three loaders start simultaneously!
// Total time: ~500ms (the longest loader), NOT 1200ms!
```

#### Performance Impact

- **Sequential Loading**: 500ms + 400ms + 300ms = **1200ms** ❌
- **Parallel Loading**: max(500ms, 400ms, 300ms) = **500ms** ✅

This results in **2-3x faster page loads** for deeply nested routes!

#### Configuration

```typescript
const router = createLayeredRouter(routes)
  (createCoreNavigationLayer())
  (createLoaderLayer({
    parallelLoading: true,  // Enabled by default
    loaderTimeout: 10000,   // Timeout applies to each loader individually
  }))
  ();
```

#### Best Practices

```typescript
// ✅ Good: Independent loaders using URL params
const teamRoute = pipe(
  extend(orgRoute, path('team'), param('teamId', z.string())),
  loader(async ({ params }) => {
    // Uses teamId from URL, doesn't wait for parent data
    const team = await fetchTeam(params.teamId);
    return { team };
  })
);

// ✅ Good: Access parent data after parallel loading
const projectView = enhancedView(({ match }) => {
  // All data is available after parallel loading completes
  const workspace = match.parent?.data?.workspace;
  const project = match.data.project;
  
  return html`
    <h1>${workspace.name} / ${project.name}</h1>
  `;
});
```

#### Outlet Configuration

```html
<!-- Basic outlet -->
<div router-outlet></div>

<!-- Outlet with specific parent route -->
<div router-outlet router-outlet-parent="42"></div>

<!-- Outlet with transitions -->
<div 
  router-outlet
  router-outlet-enter="fade-in"
  router-outlet-leave="fade-out"
  router-outlet-duration="300">
</div>

<!-- Preserve scroll position -->
<div router-outlet router-outlet-preserve-scroll></div>
```

### Advanced View Functions

#### Lazy Loading Views

```typescript
const route = pipe(
  route(path('heavy'), end),
  lazyView(
    () => import('./heavy-view').then(m => m.default),
    () => '<div>Loading...</div>' // Loading view while importing
  )
);
```

#### Conditional Views

```typescript
const route = pipe(
  route(path('profile'), param('id'), end),
  conditionalView(
    ({ match }) => match.data.user.isAdmin,
    ({ match }) => html`<admin-dashboard user="${match.data.user}"></admin-dashboard>`,
    ({ match }) => html`<user-profile user="${match.data.user}"></user-profile>`
  )
);
```

#### Error Boundary Views

```typescript
const route = pipe(
  route(path('fragile'), end),
  errorBoundaryView(
    ({ match }) => riskyRenderFunction(match),
    (error) => html`
      <div class="error">
        <h2>Something went wrong</h2>
        <p>${error.message}</p>
      </div>
    `
  )
);
```

#### Composed Views

```typescript
const route = pipe(
  route(path('complex'), end),
  composeViews({
    header: ({ match }) => html`<header>${match.data.title}</header>`,
    sidebar: () => html`<nav>Menu items...</nav>`,
    content: ({ match }) => html`<main>${match.data.content}</main>`
  }, (parts) => html`
    <div class="layout">
      ${parts.header}
      <div class="body">
        ${parts.sidebar}
        ${parts.content}
      </div>
    </div>
  `)
);
```

#### Cached Views

```typescript
const route = pipe(
  route(path('expensive'), param('id'), end),
  cachedView(
    ({ match }) => expensiveRender(match.data),
    ({ match }) => `cache-${match.params.id}`, // Cache key
    60000 // Cache for 1 minute
  )
);
```

### Configuration Options

```typescript
interface EnhancedViewLayerConfig {
  // Root element for rendering (required)
  root: HTMLElement | string;
  
  // Enable morphdom for efficient updates
  useMorphdom?: boolean;
  
  // Morphdom configuration
  morphdomOptions?: MorphdomOptions;
  
  // Custom template renderer for your library
  templateRenderer?: (result: any, container: HTMLElement) => void;
  
  // State views
  loadingView?: () => any;
  errorView?: (error: NavigationError) => any;
  notFoundView?: () => any;
  
  // Nested routing support
  enableOutlets?: boolean;
  outletAttribute?: string; // default: 'router-outlet'
}
```

### Why Enhanced View Layer?

The enhanced view layer solves common SPA rendering challenges:

- **No Template Lock-in**: Use lit-html, uhtml, Handlebars, or any other template system
- **Efficient Updates**: Morphdom ensures only changed DOM nodes are updated
- **True Nested Routing**: Hierarchical routes automatically manage nested views through outlets
- **Progressive Enhancement**: Start with simple string templates, upgrade to advanced features as needed
- **Performance Optimized**: Built-in caching, lazy loading, and smart update strategies
- **Developer Friendly**: Intuitive outlet system mirrors your route hierarchy

### Enhanced View Layer API Reference

#### Core Functions

##### `createEnhancedViewLayer(config)`
Creates an enhanced view layer with morphdom support and nested routing.

```typescript
function createEnhancedViewLayer(config: EnhancedViewLayerConfig): RouterLayer

interface EnhancedViewLayerConfig {
  root: HTMLElement | string;              // Root element for rendering (required)
  useMorphdom?: boolean;                   // Enable morphdom for efficient updates
  morphdomOptions?: MorphdomOptions;       // Morphdom configuration
  templateRenderer?: (result: TemplateResult, container: HTMLElement) => void;
  loadingView?: () => string | Node | TemplateResult;
  errorView?: (error: NavigationError) => string | Node | TemplateResult;
  notFoundView?: () => string | Node | TemplateResult;
  linkSelector?: string;                   // Custom link selector (default: 'a[href]')
  disableLinkInterception?: boolean;       // Disable automatic SPA navigation
  enableOutlets?: boolean;                 // Enable nested routing outlets
  outletAttribute?: string;                // Outlet attribute name (default: 'router-outlet')
}
```

##### `enhancedView(factory)`
Creates an enhanced view for a route supporting multiple template formats.

```typescript
function enhancedView<TParams>(
  factory: (context: ViewContext<TParams>) => 
    string | Node | TemplateResult | HTMLTemplateResult | Promise<any>
): (route: Route<TParams>) => Route<TParams>

interface ViewContext<TParams> {
  match: RouteMatch<TParams>;  // Full route match with params, data, etc.
}
```

##### `htmlTemplate(html, options)`
Creates an HTML template result with lifecycle hooks.

```typescript
function htmlTemplate(
  html: string,
  options?: {
    afterRender?: (element: HTMLElement) => void;
    beforeRender?: () => void;
  }
): HTMLTemplateResult
```

##### `lazyView(loader, loadingView)`
Creates a lazily loaded view with optional loading state.

```typescript
function lazyView<TParams>(
  loader: () => Promise<EnhancedViewFactory<TParams>>,
  loadingView?: EnhancedViewFactory<TParams>
): (route: Route<TParams>) => Route<TParams>
```

##### `conditionalView(condition, trueView, falseView)`
Renders different views based on a condition.

```typescript
function conditionalView<TParams>(
  condition: (context: ViewContext<TParams>) => boolean,
  trueView: EnhancedViewFactory<TParams>,
  falseView: EnhancedViewFactory<TParams>
): (route: Route<TParams>) => Route<TParams>
```

##### `errorBoundaryView(view, errorView)`
Wraps a view with error handling.

```typescript
function errorBoundaryView<TParams>(
  view: EnhancedViewFactory<TParams>,
  errorView: (error: Error) => string | Node | TemplateResult
): (route: Route<TParams>) => Route<TParams>
```

##### `composeViews(parts, composer)`
Composes multiple view parts into a single view.

```typescript
function composeViews<TParams, TParts extends Record<string, any>>(
  parts: { [K in keyof TParts]: EnhancedViewFactory<TParams> },
  composer: (parts: TParts) => string | Node | TemplateResult
): (route: Route<TParams>) => Route<TParams>
```

##### `cachedView(factory, keyFn, ttl)`
Caches rendered views for performance.

```typescript
function cachedView<TParams>(
  factory: EnhancedViewFactory<TParams>,
  keyFn: (context: ViewContext<TParams>) => string,
  ttl?: number  // Time to live in milliseconds (default: 60000)
): (route: Route<TParams>) => Route<TParams>
```

##### `streamingView(generator)`
Creates a streaming view that updates progressively.

```typescript
function streamingView<TParams>(
  generator: (context: ViewContext<TParams>) => 
    AsyncGenerator<string | Node | TemplateResult>
): (route: Route<TParams>) => Route<TParams>
```

#### Morphdom Integration

##### `setMorphdom(morphdom)`
Sets the morphdom implementation to use.

```typescript
function setMorphdom(morphdom: MorphdomFn): void

type MorphdomFn = (
  fromNode: Element,
  toNode: Element | string,
  options?: MorphdomOptions
) => Element
```

##### `createMorphdomIntegration(options)`
Creates a morphdom configuration with defaults.

```typescript
function createMorphdomIntegration(options?: Partial<MorphdomOptions>): {
  morphdom: MorphdomFn;
  options: MorphdomOptions;
}

interface MorphdomOptions {
  childrenOnly?: boolean;
  onBeforeElUpdated?: (fromEl: Element, toEl: Element) => boolean;
  onElUpdated?: (el: Element) => void;
  onBeforeNodeAdded?: (node: Node) => Node | boolean;
  onNodeAdded?: (node: Node) => void;
  onBeforeNodeDiscarded?: (node: Node) => boolean;
  onNodeDiscarded?: (node: Node) => void;
  onBeforeElChildrenUpdated?: (fromEl: Element, toEl: Element) => boolean;
}
```

#### Nested Routing

##### `createNestedRouter(config)`
Creates a nested router for parent-child route relationships.

```typescript
function createNestedRouter(config: NestedRouterConfig): {
  parent: Route<any>;
  children: Route<any>[];
  outlets: Map<string, RouterOutlet>;
  findChildMatch: (match: RouteMatch | null) => RouteMatch | null;
  renderChild: (match: RouteMatch | null, outlet?: HTMLElement) => void;
  destroy: () => void;
}

interface NestedRouterConfig {
  parentRoute: Route<any>;
  childRoutes: Route<any>[];
  outlet?: HTMLElement | string;
  autoManageOutlet?: boolean;
}
```

##### `createRouterOutlet(router, config)`
Creates a router outlet for automatic child route rendering.

```typescript
function createRouterOutlet(
  router: ComposableRouter<any>,
  config: OutletConfig
): RouterOutlet & {
  update: (match: RouteMatch | null) => void;
  clear: () => void;
  destroy: () => void;
}

interface OutletConfig {
  element: HTMLElement;
  parentRouteId?: number;
  render?: (match: RouteMatch | null, element: HTMLElement) => void;
  transition?: {
    enter?: string;
    leave?: string;
    duration?: number;
  };
  preserveScroll?: boolean;
  loadingView?: () => string | Node;
  errorView?: (error: Error) => string | Node;
}
```

##### `setupAutoOutlets(router, routes, container, attribute)`
Automatically discovers and sets up outlets in a container.

```typescript
function setupAutoOutlets(
  router: ComposableRouter<any>,
  routes: Route<any>[],
  container?: HTMLElement,  // default: document.body
  attribute?: string        // default: 'router-outlet'
): () => void  // Returns cleanup function
```

#### Layer Extensions

The enhanced view layer provides these methods on the router:

```typescript
interface EnhancedViewLayerExtensions {
  rerender(): void;                                    // Re-render current view
  getRootElement(): HTMLElement | null;                // Get root element
  updateConfig(config: Partial<EnhancedViewLayerConfig>): void;
  registerOutlet(outlet: RouterOutlet): void;          // Register outlet
  unregisterOutlet(outlet: RouterOutlet): void;        // Unregister outlet
  morphUpdate(content: string | Node): void;           // Force morphdom update
}

// Access layer extensions
const viewLayer = router.getLayer('EnhancedViewLayer');
viewLayer.rerender();
viewLayer.morphUpdate('<div>New content</div>');
```

#### Type Definitions

```typescript
// Template result types for various libraries
interface TemplateResult {
  strings?: TemplateStringsArray;
  values?: unknown[];
  _$litType$?: number;  // lit-html marker
  [key: string]: any;
}

interface HTMLTemplateResult {
  template?: HTMLTemplateElement;
  render?: () => Node | string;
  html?: string;
  dom?: DocumentFragment;
}

// Enhanced view factory supporting multiple return types
type EnhancedViewFactory<TParams = any> = (
  context: ViewContext<TParams>
) => string | Node | TemplateResult | HTMLTemplateResult | Promise<any>;

// Router outlet interface
interface RouterOutlet {
  element: HTMLElement;
  parentRouteId?: number;
  render: (match: RouteMatch | null) => void;
}
```

<br />

## 🗂️ Advanced Features

### Document Head Management

The head management module provides comprehensive document head tag management with support for dynamic content, SEO optimization, and server-side rendering.

#### Basic Head Management

```typescript
import { head, seoMeta } from '@doeixd/combi-router/features';

// Static head data
const aboutRoute = pipe(
  route(path('about')),
  head({
    title: 'About Us',
    meta: [
      { name: 'description', content: 'Learn more about our company' },
      { name: 'keywords', content: 'about, company, team' }
    ],
    link: [
      { rel: 'canonical', href: 'https://example.com/about' }
    ]
  })
);

// Dynamic head data based on route parameters
const userRoute = pipe(
  route(path('users'), param('id', z.number())),
  head(({ params }) => ({
    title: `User Profile - ${params.id}`,
    meta: [
      { name: 'description', content: `Profile page for user ${params.id}` }
    ]
  }))
);
```

#### SEO Optimization

```typescript
// Complete SEO setup with Open Graph and Twitter Cards
const productRoute = pipe(
  route(path('products'), param('id', z.number())),
  head(({ params }) => ({
    title: `Product ${params.id}`,
    titleTemplate: 'Store | %s', // Results in: "Store | Product 123"
    
    // Basic SEO
    ...seoMeta.basic({
      description: `Amazing product ${params.id}`,
      keywords: ['product', 'store', 'shopping'],
      robots: 'index,follow'
    }),
    
    // Open Graph tags
    ...seoMeta.og({
      title: `Product ${params.id}`,
      description: 'The best product you will ever buy',
      image: `https://example.com/products/${params.id}/image.jpg`,
      url: `https://example.com/products/${params.id}`,
      type: 'product'
    }),
    
    // Twitter Cards
    ...seoMeta.twitter({
      card: 'summary_large_image',
      title: `Product ${params.id}`,
      description: 'An amazing product',
      image: `https://example.com/products/${params.id}/twitter.jpg`
    })
  }))
);
```

#### Advanced Features

```typescript
// Scripts, styles, and HTML attributes
const dashboardRoute = pipe(
  route(path('dashboard')),
  head({
    title: 'Dashboard',
    script: [
      { src: 'https://analytics.example.com/track.js', async: true },
      { innerHTML: 'window.config = { theme: "dark" };' }
    ],
    style: [
      { innerHTML: 'body { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }' }
    ],
    htmlAttrs: { lang: 'en', 'data-theme': 'dark' },
    bodyAttrs: { class: 'dashboard dark-mode' }
  })
);
```

#### DOM Integration

```typescript
import { HeadManager, resolveHeadData } from '@doeixd/combi-router/features';

// Initialize head manager
const headManager = new HeadManager(document);

// Update head tags on navigation
router.onNavigate((match) => {
  if (match?.route._head) {
    const resolvedHead = resolveHeadData(match.route._head, match);
    headManager.apply(resolvedHead);
  }
});
```

For complete documentation, see [Head Management Guide](docs/head-management.md).

### Navigation Improvements

#### NavigationResult with Detailed Error Handling

The `navigate()` method now returns a `NavigationResult` object with comprehensive information about the navigation attempt:

```typescript
import { NavigationErrorType } from '@doeixd/combi-router';

const result = await router.navigate(userRoute, { id: 123 });

if (result.success) {
  console.log('Navigation completed successfully');
  console.log('Active match:', result.match);
} else {
  // Handle different types of navigation errors
  switch (result.error?.type) {
    case NavigationErrorType.RouteNotFound:
      console.error('Route not found');
      break;
    case NavigationErrorType.GuardRejected:
      console.error('Navigation blocked by guard:', result.error.message);
      break;
    case NavigationErrorType.LoaderFailed:
      console.error('Data loading failed:', result.error.originalError);
      break;
    case NavigationErrorType.ValidationFailed:
      console.error('Parameter validation failed');
      break;
    case NavigationErrorType.Cancelled:
      console.log('Navigation was cancelled');
      break;
  }
}
```

#### Navigation Cancellation with NavigationController

Long-running navigations can now be cancelled, which is especially useful for preventing race conditions:

```typescript
// Start a navigation and get a controller
const controller = router.currentNavigation;

if (controller) {
  console.log('Navigating to:', controller.route);
  
  // Cancel the navigation if needed
  setTimeout(() => {
    if (!controller.cancelled) {
      controller.cancel();
      console.log('Navigation cancelled');
    }
  }, 1000);
  
  // Wait for the result
  const result = await controller.promise;
  if (result.cancelled) {
    console.log('Navigation was cancelled');
  }
}
```

#### Backward Compatibility with navigateSimple()

For simple use cases, the `navigateSimple()` method provides the traditional boolean return value:

```typescript
// Simple boolean result for straightforward cases
const success = await router.navigateSimple(userRoute, { id: 123 });
if (success) {
  console.log('Navigation successful');
} else {
  console.log('Navigation failed');
}

// Still get full details when needed
const detailedResult = await router.navigate(userRoute, { id: 123 });
```

### Typed Guards

#### Enhanced Guard Context and Type Safety

The new `typedGuard()` function provides better type safety and more context for route protection:

```typescript
import { typedGuard, GuardContext } from '@doeixd/combi-router';
import { z } from 'zod';

// Define a route with parameters
const adminUserRoute = route(
  path('admin'), 
  path('users'), 
  param('userId', z.string())
);

// Create a typed guard with full context access
const adminGuard = typedGuard<{ userId: string }>(({ params, to, from, searchParams }) => {
  // Full type safety on params
  const userId = params.userId; // TypeScript knows this is a string
  
  // Access to route context
  console.log('Navigating to:', to.url);
  console.log('Coming from:', from?.url || 'initial load');
  console.log('Search params:', searchParams.get('redirect'));
  
  // Return boolean for allow/deny or string for redirect
  if (!isCurrentUserAdmin()) {
    return '/login?redirect=' + encodeURIComponent(to.url);
  }
  
  // Additional validation based on the user ID
  if (!canAccessUser(userId)) {
    return false; // Block navigation
  }
  
  return true; // Allow navigation
});

// Apply the guard to the route
const protectedRoute = pipe(
  adminUserRoute,
  guard(adminGuard)
);
```

### Nested Routes and Parallel Data Loading

When a nested route like `/dashboard/users/123` is matched, Combi-Router builds a tree of match objects. If both `dashboardRoute` and `userRoute` have a `loader`, they are executed **in parallel**, and you can access data from any level of the hierarchy.

```typescript
// dashboard-layout.ts
const dashboardRoute = pipe(
  route(path('dashboard')),
  loader(async () => ({ stats: await fetchDashboardStats() })),
  layout(DashboardLayout) // Layout component with <Outlet />
);

// user-profile.ts
const userRoute = pipe(
  extend(dashboardRoute, path('users'), param('id', z.number())),
  loader(async ({ params }) => ({ user: await fetchUser(params.id) }))
);

// In your view for the user route, you can access both sets of data:
const dashboardData = router.currentMatch.data; // { stats: ... }
const userData = router.currentMatch.child.data; // { user: ... }
```

### Predictive Preloading

Improve perceived performance by loading a route's code and data *before* the user clicks a link. The `router.peek()` method is perfect for this.

```typescript
// Preload on hover to make navigation feel instantaneous
myLink.addEventListener('mouseenter', () => {
  router.peek(userRoute, { id: 123 });
});

// Navigate as usual on click
myLink.addEventListener('click', (e) => {
  e.preventDefault();
  router.navigate(userRoute, { id: 123 });
});
```

### View Transitions

Combi-Router automatically uses the browser's native [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API) for smooth, app-like page transitions. To enable it, simply add a CSS `view-transition-name` to elements that should animate between pages.

```css
/* On a list page */
.product-thumbnail {
  view-transition-name: product-image-123;
}

/* On a detail page */
.product-hero-image {
  view-transition-name: product-image-123; /* Same name! */
}
```

The router handles the rest. No JavaScript changes are needed.

<br />

## 🧩 Vanilla JS Utilities

Combi-Router is framework-agnostic at its core. To help you integrate it into a vanilla JavaScript project, we provide a set of utility functions. These helpers bridge the gap between the router's state and the DOM, making it easy to create navigable links, render nested views, and react to route changes.

### Link & Navigation Helpers

#### `createLink(router, route, params, options)`

Creates a fully functional `<a>` element that navigates using the router. It automatically sets the `href` and intercepts click events to trigger client-side navigation. Each created link comes with a `destroy` function to clean up its event listeners.

```typescript
import { createLink } from '@doeixd/combi-router/utils';

const { element, destroy } = createLink(
  router,
  userRoute,
  { id: 123 },
  { children: 'View Profile', className: 'btn' }
);
document.body.appendChild(element);

// Later, when the element is removed from the DOM:
// destroy();
```

#### `createActiveLink(router, route, params, options)`

Builds on `createLink` to create an `<a>` element that automatically updates its CSS class when its route is active. This is perfect for navigation menus.

- `activeClassName`: The CSS class to apply when the link is active.
- `exact`: If `true`, the class is applied only on an exact route match. If `false` (default), it's also applied for any active child routes.

```typescript
import { createActiveLink } from '@doeixd/combi-router/utils';

const { element } = createActiveLink(router, dashboardRoute, {}, {
  children: 'Dashboard',
  className: 'nav-link',
  activeClassName: 'font-bold' // Applied on /dashboard, /dashboard/users, etc.
});
document.querySelector('nav').appendChild(element);
```

#### `attachNavigator(element, router, route, params)`

Makes any existing HTML element navigable. This is useful for turning buttons, divs, or other non-anchor elements into type-safe navigation triggers.

```typescript
import { attachNavigator } from '@doeixd/combi-router/utils';

const myButton = document.getElementById('home-button');
const { destroy } = attachNavigator(myButton, router, homeRoute, {});
```

### Conditional Rendering

#### `createOutlet(router, parentRoute, container, viewMap)`

Provides a declarative "outlet" for nested routing, similar to `<Outlet>` in React Router or `<router-view>` in Vue. It listens for route changes and renders the correct child view into a specified container element.

- `parentRoute`: The route of the component that *contains* the outlet.
- `container`: The DOM element where child views will be rendered.
- `viewMap`: An object mapping `Route.id` to an `ElementFactory` function `(match) => Node`.

```typescript
// In your dashboard layout component
import { createOutlet } from '@doeixd/combi-router/utils';
import { dashboardRoute, usersRoute, settingsRoute } from './routes';
import { UserListPage, SettingsPage } from './views';

const outletContainer = document.querySelector('#outlet');
createOutlet(router, dashboardRoute, outletContainer, {
  [usersRoute.id]: (match) => new UserListPage(match.data), // Pass data to the view
  [settingsRoute.id]: () => new SettingsPage(),
});
```

#### `createMatcher(router)`

Creates a fluent, type-safe conditional tool that reacts to route changes. It's a powerful way to implement declarative logic that isn't tied directly to rendering.

```typescript
import { createMatcher } from '@doeixd/combi-router/utils';

// Update the document title based on the active route
createMatcher(router)
  .when(homeRoute, () => {
    document.title = 'My App | Home';
  })
  .when(userRoute, (match) => {
    document.title = `Profile for User ${match.params.id}`;
  })
  .otherwise(() => {
    document.title = 'My App';
  });
```

### State Management

#### `createRouterStore(router)`

Creates a minimal, framework-agnostic reactive store for the router's state (`currentMatch`, `isNavigating`, `isFetching`). This is useful for integrating with UI libraries or building your own reactive logic in vanilla JS.

```typescript
import { createRouterStore } from '@doeixd/combi-router/utils';

const store = createRouterStore(router);

const unsubscribe = store.subscribe(() => {
  const { isNavigating } = store.getSnapshot();
  // Show a global loading indicator while navigating
  document.body.style.cursor = isNavigating ? 'wait' : 'default';
});

// To clean up:
// unsubscribe();
```

<br />

## 🎨 Web Components

For even simpler integration, Combi-Router provides ready-to-use Web Components that handle routing declaratively in your HTML:

```html
<!DOCTYPE html>
<html>
<head>
    <script type="module">
        // Import standalone components (no setup required!)
        import '@doeixd/combi-router/components-standalone';
    </script>
</head>
<body>
    <!-- Define your routes declaratively -->
    <view-area match="/users/:id" view-id="user-detail"></view-area>
    <view-area match="/about" view-id="about-page"></view-area>

    <!-- Define your templates with automatic head management -->
    <template is="view-template" view-id="user-detail">
        <!-- Head automatically discovered and linked to view-area -->
        <view-head 
            title="User Profile"
            title-template="My App | %s"
            description="View user profile and details"
            og-title="User Profile"
            og-description="Comprehensive user profile page"
            og-type="profile">
        </view-head>
        
        <h1>User Details</h1>
        <p>User ID: <span class="user-id"></span></p>
    </template>

    <template is="view-template" view-id="about-page">
        <!-- Each template can have its own head configuration -->
        <view-head 
            title="About Us"
            description="Learn more about our company and mission"
            keywords="about, company, mission, team"
            canonical="https://myapp.com/about"
            og-title="About Our Company"
            og-description="Discover our story and values">
        </view-head>
        
        <h1>About</h1>
        <p>This is the about page.</p>
    </template>

    <!-- Navigation works automatically -->
    <nav>
        <a href="/users/123">User 123</a>
        <a href="/about">About</a>
    </nav>
</body>
</html>
```

### Advanced Example with Nested Routes

```html
<!-- Nested route structure -->
<view-area match="/dashboard" view-id="dashboard"></view-area>
<view-area match="/dashboard/users" view-id="users-list"></view-area>
<view-area match="/dashboard/users/:id" view-id="user-detail"></view-area>

<!-- Templates with automatic head discovery -->
<template is="view-template" view-id="dashboard">
    <!-- Parent template head - automatically merges with child heads -->
    <view-head 
        title="Dashboard"
        title-template="Admin | %s"
        description="Admin dashboard overview">
    </view-head>
    
    <h1>Dashboard</h1>
    <nav>
        <a href="/dashboard/users">Users</a>
        <a href="/dashboard/analytics">Analytics</a>
    </nav>
    <main class="dashboard-content"></main>
</template>

<template is="view-template" view-id="users-list">
    <!-- Child template head - merges with parent -->
    <view-head 
        title="Users"
        description="Manage users and permissions"
        robots="noindex">
    </view-head>
    
    <h2>Users</h2>
    <div class="users-grid"></div>
</template>

<!-- External template with dynamic head loading -->
<template is="view-template" view-id="user-detail" src="/views/user-detail.html"></template>

<!-- You can still use manual linking for external head configs -->
<view-head head-id="external-head" src="/head-configs/user-detail.js"></view-head>
<view-area match="/special/:id" view-id="special-view" head-id="external-head"></view-area>
```

### Key Benefits

- **Zero JavaScript Configuration**: Just import and use
- **Declarative Routing**: Define routes in HTML attributes
- **Automatic Navigation**: Links work out of the box
- **SEO-Ready**: Built-in head management with Open Graph and Twitter Cards
- **Automatic Head Discovery**: Place `view-head` inside templates - no manual linking needed
- **Nested Head Management**: Head tags merge hierarchically for complex layouts
- **Dynamic Content**: Load head configurations from external modules
- **Flexible Linking**: Choose automatic discovery or manual `head-id` linking
- **Progressive Enhancement**: Works with or without JavaScript
- **Dynamic Route Management**: Add/remove routes programmatically when needed

[Learn more →](docs/COMPONENTS.md)

<br />

## ⚙️ Configuration & API

## 🧰 Composable Layer Architecture

Combi-Router now features a revolutionary **layer-based composition system** using our custom `makeLayered` implementation, enabling true user extensibility while maintaining backwards compatibility.

### Why Layers?

Traditional routers force you to choose between their built-in features or build everything from scratch. With layers, you can:

- **Mix and match** built-in features exactly as needed
- **Create custom layers** for your specific business logic  
- **Compose layers conditionally** based on environment or feature flags
- **Build orchestrated systems** where layers can call each other's methods
- **Maintain type safety** with full TypeScript inference across all layers

### Basic Layer Composition

```typescript
import { 
  createLayeredRouter, 
  createCoreNavigationLayer,
  withPerformance, 
  withScrollRestoration 
} from '@doeixd/combi-router';

// Compose exactly the router you need
const router = createLayeredRouter(routes)
  (createCoreNavigationLayer())           // Base navigation
  (withPerformance({ prefetchOnHover: true }))  // Performance optimizations
  (withScrollRestoration({ strategy: 'smooth' })) // Scroll management
  ();

// All layer methods are now available
router.navigate('/user/123');
router.prefetchRoute('about');
router.saveScrollPosition();
```

### Custom Layer Creation

Create your own layers for analytics, authentication, or any business logic:

```typescript
const withAnalytics = (config: { trackingId: string }) => (self: any) => {
  // Register lifecycle hooks
  if ('_registerLifecycleHook' in self) {
    self._registerLifecycleHook('onNavigationStart', (context: any) => {
      console.log(`[Analytics] Navigation started: ${context.to?.path}`);
    });

    self._registerLifecycleHook('onNavigationComplete', (match: any) => {
      console.log(`[Analytics] Page view: ${match.path}`);
    });
  }

  return {
    trackEvent: (event: string, data?: any) => {
      console.log(`[Analytics] Event: ${event}`, data);
    },
    
    trackError: (error: Error, context?: any) => {
      console.log(`[Analytics] Error: ${error.message}`, context);
    }
  };
};

// Use your custom layer
const router = createLayeredRouter(routes)
  (createCoreNavigationLayer())
  (withPerformance())
  (withAnalytics({ trackingId: 'GA-123456-7' }))
  ();

// Your custom methods are now available
router.trackEvent('button_click', { button: 'signup' });
```

### Layer Orchestration

Layers can call methods from previously applied layers, enabling powerful composition patterns:

```typescript
const withSmartNavigation = (self: any) => ({
  // Enhanced navigation that uses multiple layers
  smartNavigate: async (path: string, options: any = {}) => {
    // Track with analytics (if analytics layer is present)
    if ('trackEvent' in self) {
      self.trackEvent('navigation_intent', { path });
    }

    // Save scroll position (if scroll restoration layer is present)
    if ('saveScrollPosition' in self) {
      self.saveScrollPosition();
    }

    // Perform the navigation using core layer
    const result = await self.navigate(path, options);
    
    if (result && 'trackEvent' in self) {
      self.trackEvent('navigation_complete', { path });
    }
    
    return result;
  }
});

const router = createLayeredRouter(routes)
  (createCoreNavigationLayer())
  (withPerformance())
  (withScrollRestoration())
  (withAnalytics({ trackingId: 'GA-123' }))
  (withSmartNavigation)  // Orchestrates all previous layers
  ();

// One method that uses multiple layer capabilities
router.smartNavigate('/dashboard');
```

### Conditional Layer Application

Apply layers based on environment, feature flags, or any condition:

```typescript
import { conditionalLayer } from '@doeixd/combi-router';

const isDev = process.env.NODE_ENV === 'development';
const isProd = process.env.NODE_ENV === 'production';
const hasAnalytics = config.features.analytics;

const router = createLayeredRouter(routes)
  (createCoreNavigationLayer())
  
  // Only add performance layer in production
  (conditionalLayer(isProd, withPerformance({
    prefetchOnHover: true,
    enablePerformanceMonitoring: true
  })))
  
  // Only add debug layer in development
  (conditionalLayer(isDev, (self: any) => ({
    debug: () => console.log('Router state:', self.currentMatch),
    logAllNavigation: true
  })))
  
  // Conditional analytics
  (conditionalLayer(hasAnalytics, withAnalytics({ 
    trackingId: config.analytics.trackingId 
  })))
  ();
```

### Built-in Layer Types

- **Core Navigation** (`createCoreNavigationLayer`): Essential routing functionality
- **Performance** (`withPerformance`): Prefetching, monitoring, memory management
- **Scroll Restoration** (`withScrollRestoration`): Automatic scroll position management
- **Transitions** (`withTransitions`): Smooth page transitions
- **Code Splitting** (`withCodeSplitting`): Dynamic route loading

### Migration from Configuration-Based Approach

**⚠️ Deprecation Notice**: The configuration-based feature system (`RouterOptions.features`) is deprecated in favor of the new layer system. The old API continues to work but will be removed in the next major version.

```typescript
// ❌ Old way (deprecated)
const router = new CombiRouter(routes, {
  features: {
    performance: { prefetchOnHover: true },
    scrollRestoration: { strategy: 'smooth' }
  }
});

// ✅ New way (recommended)
const router = createLayeredRouter(routes)
  (createCoreNavigationLayer())
  (withPerformance({ prefetchOnHover: true }))
  (withScrollRestoration({ strategy: 'smooth' }))
  ();
```

The new layer system provides:
- **Better tree-shaking**: Only bundle layers you use
- **User extensibility**: Create custom layers for your needs
- **Better composition**: Mix and match features freely
- **Type safety**: Full TypeScript inference across layers
- **Self-aware layers**: Layers can interact with each other

### Router Creation (Legacy)

For backwards compatibility, the traditional configuration-based approach still works:

```typescript
const router = createRouter(
  [homeRoute, usersRoute, userRoute], // An array of all routes
  {
    baseURL: 'https://myapp.com', // For running in a subdirectory
    hashMode: false, // Use `/#/path` style URLs
    features: { // ⚠️ Deprecated - use layer system instead
      performance: { prefetchOnHover: true }
    }
  }
);
```

### Error Handling

```typescript
// Define a fallback route for any URL that doesn't match
router.fallback(notFoundRoute);

// Define a global error handler for failures during navigation
router.onError(({ error, to, from }) => {
  console.error('Navigation error:', error);
  // Send to an error tracking service
});
```

### 🧰 Advanced: Creating Custom Matchers

While Combi-Router provides a comprehensive set of built-in matchers like `path`, `param`, and `query`, its true power lies in its composable foundation. The router is designed to be fully extensible, allowing you to create your own custom matchers using the full power of the underlying `@doeixd/combi-parse` library.

This is an advanced feature for when you need to parse complex URL structures that go beyond simple static or dynamic segments.

#### The `RouteMatcher` Contract

At its core, a matcher is an object that fulfills the `RouteMatcher` contract. It tells the router two things:
1.  **How to parse a URL segment**: This is done with a `combi-parse` parser. The parser's job is to recognize a part of the URL and, if it captures a value, return it as an object (e.g., `{ myParam: 'value' }`).
2.  **How to build a URL segment**: This is the inverse operation, handled by a `build` function. Given a `params` object, it constructs the corresponding URL string.

#### Example: A Version Matcher (`/v1/` or `/v2/`)

Imagine you have an API that can be versioned, and you want a single route definition to handle both `/api/v1/posts` and `/api/v2/posts`, capturing the version as a parameter.

You can create a custom `version()` matcher to handle this.

```typescript
// in my-matchers.ts
import { str, choice } from '@doeixd/combi-parse';
import type { RouteMatcher } from '@doeixd/combi-router';

/**
 * A custom matcher that recognizes /v1 or /v2 and captures the result.
 * @param paramName The name for the captured version parameter.
 */
export function version(paramName: string): RouteMatcher {
  // 1. The Parser: Use `choice` to accept 'v1' or 'v2'.
  // It must return an object with the parameter name as the key.
  const versionParser = str('/')
    .keepRight(choice([str('v1'), str('v2')]))
    .map(parsedVersion => ({ [paramName]: parsedVersion }));

  // 2. The Builder: The inverse of the parser.
  const buildFn = (params: Record<string, any>): string | null => {
    const apiVersion = params[paramName];
    if (apiVersion === 'v1' || apiVersion === 'v2') {
      return `/${apiVersion}`;
    }
    // Return null if the required param is missing or invalid.
    return null;
  };

  // 3. The Contract: Return an object that fulfills the RouteMatcher interface.
  return {
    type: 'customVersion', // A unique type for debugging
    parser: versionParser,
    build: buildFn,
    paramName: paramName,
  };
}
```

#### Using Your Custom Matcher

Now, you can import and use `version()` in your route definitions just like any built-in matcher.

```typescript
// in my-routes.ts
import { route, path, param, createRouter } from '@doeixd/combi-router';
import { version } from './my-matchers'; // Import your custom matcher

const postsRoute = route(
  path('api'),
  version('apiVersion'), // Your custom matcher in action!
  path('posts'),
  param('id', z.number())
);

const router = createRouter([postsRoute]);

// --- Matching ---
const matchV1 = router.match('/api/v1/posts/123');
// matchV1.params -> { apiVersion: 'v1', id: 123 }

const matchV2 = router.match('/api/v2/posts/456');
// matchV2.params -> { apiVersion: 'v2', id: 456 }

// --- Building ---
const urlV1 = router.build(postsRoute, { apiVersion: 'v1', id: 123 });
// -> "/api/v1/posts/123"

const urlV2 = router.build(postsRoute, { apiVersion: 'v2', id: 456 });
// -> "/api/v2/posts/456"
```

By creating your own domain-specific matchers, you can build highly expressive, reusable, and type-safe routing grammars that are perfectly tailored to your application's needs.

### API Reference

#### Core Functions

- `route(...matchers)`: Creates a new base route.
- `extend(baseRoute, ...matchers)`: Creates a new child route from a base.
- `createRouter(routes, options?)`: Creates the router instance.
- `createResource(promiseFn)`: Wraps an async function in a suspense-ready resource.
- `createAdvancedResource(promiseFn, config?)`: Creates an enhanced resource with retry, caching, and state management.
- `typedGuard<TParams>(guardFn)`: Creates a type-safe guard function with enhanced context.

#### Route Matchers

- `path(segment)`: Matches a static path segment.
- `path.optional(segment)`: Matches an optional path segment.
- `path.wildcard(name?)`: Matches all remaining path segments into an array.
- `param(name, schema)`: Matches a dynamic parameter with Zod validation.
- `query(name, schema)`: Declares a required query parameter with Zod validation.
- `query.optional(name, schema)`: Declares an optional query parameter.
- `end`: Ensures the path has no remaining segments.

#### Higher-Order Enhancers

- `pipe(route, ...enhancers)`: Applies a series of enhancers to a route.
- `meta(metadata)`: Attaches arbitrary metadata to a route.
- `loader(loaderFn)`: Adds a data-loading function to a route.
- `layout(component)`: Associates a layout component with a route.
- `guard(...guardFns)`: Protects a route with one or more guard functions.
- `cache(options)`: Adds caching behavior to a route's loader.
- `lazy(importFn)`: Makes a route's component lazy-loaded.

#### Router Methods

- `navigate(route, params)`: Programmatically navigates to a route, returns `Promise<NavigationResult>`.
- `navigateSimple(route, params)`: Simple navigation that returns `Promise<boolean>` for backward compatibility.
- `build(route, params)`: Generates a URL string for a route.
- `match(url)`: Matches a URL and returns the corresponding `RouteMatch` tree.
- `peek(route, params)`: Proactively loads a route's code and data.
- `subscribe(listener)`: Subscribes to route changes.
- `addRoute(route)`: Dynamically adds a route to the router.
- `removeRoute(route)`: Dynamically removes a route from the router.
- `cancelNavigation()`: Cancels the current navigation if one is in progress.

#### Router Properties

- `currentMatch`: The currently active `RouteMatch` object tree, or `null`.
- `currentNavigation`: The active `NavigationController` if a navigation is in progress, or `null`.
- `isNavigating`: A boolean indicating if a navigation is in progress.
- `isFetching`: A boolean indicating if any route loaders are active.
- `routes`: A flat array of all registered route objects.

#### Route Properties (Introspection)

- `route.depth`: The depth of the route in the hierarchy (0 for root routes).
- `route.ancestors`: Array of all ancestor routes from root to parent.
- `route.staticPath`: The static path parts (non-parameter segments).
- `route.paramNames`: Array of all parameter names defined by the route.
- `route.isDynamic`: Boolean indicating if the route has dynamic parameters.
- `route.hasQuery`: Boolean indicating if the route has query parameters.
- `route.routeChain`: Array of routes from root to this route (including this route).
- `route.parent`: The parent route, or `null` for root routes.

#### Error Types

- `RouteValidationError`: Thrown when route validation fails during creation.
- `NavigationErrorType`: Enum of possible navigation error types (`RouteNotFound`, `GuardRejected`, `LoaderFailed`, `ValidationFailed`, `Cancelled`, `Unknown`).
- `NavigationError`: Interface describing detailed navigation error information.
- `NavigationResult`: Interface describing the result of a navigation attempt.
- `NavigationController`: Interface for managing ongoing navigation.
- `GuardContext<TParams>`: Context object passed to typed guard functions.
- `TypedRouteGuard<TParams>`: Type for typed guard functions.

<br />

## 🏗️ Layered Router Architecture

### Creating Layered Routers

The layered router architecture allows you to compose routers from independent, reusable layers:

```typescript
import { 
  createLayeredRouter, 
  dataLayer, 
  devLayer, 
  performanceLayer 
} from '@doeixd/combi-router';

// Basic layered router
const router = createLayeredRouter(routes)
  (dataLayer())     // Add data management capabilities
  (devLayer())      // Add development tools (dev mode only)
  ();               // Finalize the router

// Advanced configuration
const advancedRouter = createLayeredRouter(routes, {
  baseURL: '/app',
  hashMode: false
})
  (dataLayer({
    autoCleanup: true,
    cleanupInterval: 300000,
    logResourceEvents: true
  }))
  (devLayer({
    exposeToWindow: true,
    autoAnalyze: true,
    performanceMonitoring: true
  }))
  (performanceLayer({
    prefetchOnHover: true,
    prefetchViewport: true,
    connectionAware: true
  }))
  ();
```

### Data Layer Features

The data layer provides advanced data management capabilities:

```typescript
// Access data layer features
const router = createLayeredRouter(routes)(dataLayer())();

// Advanced caching with tags
router.cache.set('user:123', userData, {
  ttl: 300000,
  invalidateOn: ['user', 'profile'],
  priority: 'high'
});

// Create suspense-compatible resources
const userResource = router.createResource(() => 
  fetch(`/api/users/${params.id}`).then(r => r.json())
);

// Advanced resources with retry and caching
const advancedResource = router.createAdvancedResource(
  () => api.fetchUser(userId),
  {
    retry: { attempts: 3 },
    cache: { ttl: 300000, invalidateOn: ['user'] },
    staleTime: 60000,
    backgroundRefetch: true
  }
);

// Global resource monitoring
const globalState = router.getGlobalResourceState();
if (globalState.isLoading) {
  showLoadingSpinner();
}

// Cache invalidation
router.invalidateByTags(['user', 'profile']);

// Route preloading
router.preloadRoute('user-dashboard', { id: userId });
```

### Development Layer Features

The development layer provides comprehensive debugging and development tools:

```typescript
// Access dev tools (development mode only)
const router = createLayeredRouter(routes)(devLayer())();

// Run comprehensive analysis
router.runDevAnalysis();

// Get detailed development report
const report = router.getDevReport();
console.log(`Performance score: ${report.performance?.score}/100`);
console.log(`Found ${report.warnings.length} warnings`);

// Log formatted report
router.logDevReport();

// Export debug data
const debugData = router.exportDevData();
localStorage.setItem('router-debug', debugData);

// Access via window (if exposeToWindow: true)
window.combiRouterDev?.analyze();
window.combiRouterDev?.report();
```

### Quick Setup Functions

For common use cases, use the quick setup functions:

```typescript
import { quickDataLayer, quickDevLayer } from '@doeixd/combi-router';

// Production-ready setup
const router = createLayeredRouter(routes)
  (quickDataLayer())  // Optimized data management
  (quickDevLayer())   // All dev tools (dev mode only)
  ();

// Equivalent to full configuration
const router = createLayeredRouter(routes)
  (dataLayer({
    autoCleanup: true,
    cleanupInterval: 300000,
    logResourceEvents: process.env.NODE_ENV !== 'production'
  }))
  (devLayer({
    exposeToWindow: true,
    autoAnalyze: true,
    warnings: true,
    conflictDetection: true,
    performanceMonitoring: true,
    routeValidation: true,
    debugMode: true
  }))
  ();
```

### Backwards Compatibility

The new layered system is fully backwards compatible:

```typescript
// Original API still works
const router = new CombiRouter(routes, options);

// Automatically includes:
// - Data layer for resource management
// - Dev layer in development mode
// - All existing functionality
```

<br />

## 🎁 Benefits of Reference-Based Approach

- **Perfect Type Safety**: Impossible to make typos in route names or pass incorrect parameter types.
- **Better IDE Support**: Get autocompletion for routes and `go-to-definition` that works.
- **Confident Refactoring**: Rename a route or change its parameters, and TypeScript will instantly show you everywhere that needs to be updated.
- **Functional Composition**: Routes are first-class values that can be imported, exported, and composed with pure functions.
- **Framework Agnostic**: The core logic is pure TypeScript, allowing for simple integration with any framework or vanilla JS.
- **Tree-Shakable**: Import only the features you need for optimal bundle size.
- **Production Ready**: Built-in performance optimizations, error handling, and monitoring.

<br />

## 📈 Performance

Combi-Router is designed for performance with several optimization strategies:

### Bundle Size
- **Core**: ~12KB gzipped (essential routing functionality)
- **+Data**: ~4KB gzipped (advanced resources and caching)
- **+Features**: ~6KB gzipped (performance optimizations)
- **+Utils**: ~3KB gzipped (DOM utilities)
- **Dev Tools**: ~3KB gzipped (excluded in production builds)

### Runtime Performance
- **Tree-shaking optimized**: Only bundle what you use
- **Lazy route loading**: Code splitting at the route level
- **Intelligent prefetching**: Connection-aware prefetching strategies
- **Memory management**: Automatic cleanup of unused cache entries
- **Performance monitoring**: Built-in Web Vitals tracking

### Best Practices
1. Use modular imports to minimize bundle size
2. Enable connection-aware prefetching for mobile users
3. Configure cache TTL based on data volatility
4. Use scroll restoration for better UX
5. Enable performance monitoring in development

<br />

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details.

<br />

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.
