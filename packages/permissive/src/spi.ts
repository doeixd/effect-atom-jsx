/**
 * The SPI-compatibility gate, in its own module so the client entry
 * (`./client.js`) can use it without pulling in `./preset.js` — whose
 * compiler-plugin import (`resume-extract-vite`, babel) must never enter a
 * browser bundle.
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
 * constructs (both the build/server preset and the client layer).
 */
export function assertSpiCompatible(): void {
  if (spiVersion !== supportedSpiVersion) {
    throw new SpiVersionMismatchError(spiVersion, supportedSpiVersion);
  }
}
