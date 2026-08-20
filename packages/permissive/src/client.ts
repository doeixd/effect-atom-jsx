/**
 * `@affe/permissive/client` — the browser-safe entry (S5).
 *
 * The main entry's `permissive()` builds the compiler plugin, so importing it
 * drags `resume-extract-vite` (and babel) into whatever bundle it lands in.
 * A client bundle needs only the codec layer and the hydration registry;
 * this module imports nothing heavier.
 */

import type { Layer } from "effect";
import * as Serialization from "effect-atom-jsx/Serialization";
import { assertSpiCompatible, spiVersion } from "./spi.js";

export {
  SpiVersionMismatchError,
  assertSpiCompatible,
  spiVersion,
  supportedSpiVersion,
} from "./spi.js";
export { createHandleRegistry, type HandleRegistry } from "./registry.js";

export interface PermissiveClientOptions {
  /** Hydration identity for state-handle captures; see the main entry. */
  readonly stateHandles?: Serialization.StateHandleResolver;
}

export interface PermissiveClient {
  /**
   * The codec layer the client runtime MUST include: it matches the
   * serializer id the server preset stamps on the manifest, and
   * envelope-encoded rich captures fail closed without it.
   */
  readonly layer: Layer.Layer<Serialization.SerializationService>;
  readonly spiVersion: string;
}

/** The client half of `permissive()`. Fails closed on an SPI mismatch. */
export function permissiveClient(
  options: PermissiveClientOptions = {},
): PermissiveClient {
  assertSpiCompatible();
  return {
    layer: options.stateHandles === undefined
      ? Serialization.serovalAsyncLayer
      : Serialization.seroval({
        async: true,
        stateHandles: options.stateHandles,
      }),
    spiVersion,
  };
}
