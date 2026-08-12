/**
 * The `permissive()` preset (`docs/PERMISSIVE_PACKAGE_PLAN.md` S3, shape P3):
 * Qwik-parity as a configuration. It returns the pieces an app wires, not
 * magic — the `extract.auto`-capable compiler plugin, and the universal
 * seroval codec for both sides of the wire.
 *
 * The server and client layers are deliberately the SAME layer: the resume
 * manifest is stamped with the serializer id (`DQ-012`), and a client running
 * a different codec fails closed with `ResumeSerializerMismatchError` before
 * decoding a byte. Splitting the fields keeps the wiring sites readable
 * (server collect vs client install) while making the pairing explicit.
 *
 * The async seroval codec is the default because permissive mode exists for
 * rich captures: an in-flight `Promise` capture awaits once server-side and
 * restores live, where the sync codec would refuse it (M10.6).
 */

import type { Layer } from "effect";
import {
  resumeExtract,
  type ResumeExtractViteOptions,
} from "effect-atom-jsx/compiler/resume-extract-vite";
import * as Serialization from "effect-atom-jsx/Serialization";
import { assertSpiCompatible, spiVersion } from "./index.js";

export interface PermissiveOptions {
  /** Deployment/build identity stamped on generated code and the manifest. */
  readonly buildId: string;
  /** Pass-through compiler-plugin options (include, sourceModules, …). */
  readonly vite?: Omit<ResumeExtractViteOptions, "buildId">;
}

export interface PermissivePreset {
  /** Vite plugins enabling `extract`/`extract.auto` handler extraction. */
  readonly vitePlugins: ReadonlyArray<ReturnType<typeof resumeExtract>>;
  /** Serialization layer for SSR collect (`Resume.collect`, streaming). */
  readonly serverLayer: Layer.Layer<Serialization.SerializationService>;
  /**
   * Serialization layer the client runtime MUST include: envelope-encoded
   * rich captures fail closed without the matching codec.
   */
  readonly clientLayer: Layer.Layer<Serialization.SerializationService>;
  /** The adapter-SPI version this preset was built against. */
  readonly spiVersion: string;
}

/**
 * Build the permissive configuration. Fails closed at construction (a typed
 * `SpiVersionMismatchError`) when the installed core exposes a different
 * adapter-SPI version — never at the first SPI call.
 */
export function permissive(options: PermissiveOptions): PermissivePreset {
  assertSpiCompatible();
  return {
    vitePlugins: [
      resumeExtract({ buildId: options.buildId, ...options.vite }),
    ],
    serverLayer: Serialization.serovalAsyncLayer,
    clientLayer: Serialization.serovalAsyncLayer,
    spiVersion,
  };
}
