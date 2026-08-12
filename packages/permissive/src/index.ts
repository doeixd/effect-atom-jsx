/**
 * `@affe/permissive` — Qwik-parity as a configuration, not a fork.
 *
 * Owning plan: `docs/PERMISSIVE_PACKAGE_PLAN.md`. This package builds against
 * **public `effect-atom-jsx` subpaths only** — that constraint IS the adapter
 * SPI test M9 requires, and the enforcement test in `src/__tests__/` fails on
 * any deep import.
 *
 * S2 establishes the workspace and the SPI-consumer contract; the
 * `permissive()` preset itself is S3.
 */

import { spiVersion } from "effect-atom-jsx/adapter-spi";

export { spiVersion };

/**
 * The SPI version this package was built against. `assertSpiCompatible`
 * compares the *installed* core's `spiVersion` against this constant, so a
 * mismatched core fails closed at startup instead of misbehaving at the first
 * SPI call (`DQ-011` — the same discipline as the build-ID gate).
 */
export const supportedSpiVersion = "af.resume-spi.v1";

export class SpiVersionMismatchError extends Error {
  readonly _tag = "SpiVersionMismatchError";
  constructor(
    readonly installed: string,
    readonly supported: string,
  ) {
    super(
      `@affe/permissive was built against adapter SPI "${supported}" but the installed effect-atom-jsx exposes "${installed}". Upgrade whichever side is behind; running mismatched would fail at the first SPI call instead of here.`,
    );
  }
}

/**
 * Fail closed on an incompatible core. Called by everything this package
 * constructs (the S3 preset calls it before returning any layer).
 */
export function assertSpiCompatible(): void {
  if (spiVersion !== supportedSpiVersion) {
    throw new SpiVersionMismatchError(spiVersion, supportedSpiVersion);
  }
}
