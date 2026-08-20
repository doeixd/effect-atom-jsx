/**
 * `@affe/permissive` — Qwik-parity as a configuration, not a fork.
 *
 * Owning plan: `docs/PERMISSIVE_PACKAGE_PLAN.md`. This package builds against
 * **public `effect-atom-jsx` subpaths only** — that constraint IS the adapter
 * SPI test M9 requires, and the enforcement test in `src/__tests__/` fails on
 * any deep import.
 *
 * This is the BUILD/SERVER entry: `permissive()` constructs the compiler
 * plugin, so importing it belongs in vite configs and server code. Client
 * bundles import `@affe/permissive/client` instead, which carries only the
 * codec layer and the hydration registry.
 */

export {
  permissive,
  type PermissiveOptions,
  type PermissivePreset,
} from "./preset.js";
export {
  createHandleRegistry,
  type HandleRegistry,
} from "./registry.js";
export {
  permissiveClient,
  type PermissiveClient,
  type PermissiveClientOptions,
} from "./client.js";
export {
  SpiVersionMismatchError,
  assertSpiCompatible,
  spiVersion,
  supportedSpiVersion,
} from "./spi.js";
// The reference codec pieces, re-exported so an app can wire them directly
// or compare serializer identities in diagnostics.
export {
  serovalLayer,
  serovalAsyncLayer,
  serovalSerializerId,
  serovalAsyncSerializerId,
} from "effect-atom-jsx/Serialization";
