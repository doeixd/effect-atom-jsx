/**
 * The published resumability adapter SPI (`effect-atom-jsx/adapter-spi`).
 *
 * Owned by `RESUMABILITY_IMPLEMENTATION_PLAN.md` M9 item 2, un-blocked by the
 * permissive-package milestone (`docs/PERMISSIVE_PACKAGE_PLAN.md` S1,
 * `DQ-011`): the member list below is frozen around what the first external
 * consumer actually exercises — manifest schemas and decode, client install
 * (which carries the encoded binding-write escape hatch), the event/binding
 * snapshot schemas, the error union those paths can produce, and the
 * runtime-readable `spiVersion` an adapter fails closed on.
 *
 * Freezing rules:
 *
 * - Additions require a deliberate decision plus an update to the member-list
 *   pin in `src/__tests__/adapter-spi.test.ts`.
 * - Removals or incompatible reshapes require bumping `spiVersion`.
 * - Everything else in `Resume` remains framework-internal API that adapters
 *   must not rely on.
 */
export {
  // The fail-closed compatibility gate.
  spiVersion,
  // Manifest wire schemas and identifiers.
  BindingName,
  ComponentId,
  EventId,
  EventType,
  ExpressionId,
  ManifestLoaderEntrySchema,
  ManifestSchema,
  ManifestV1Schema,
  ManifestV2Schema,
  ManifestV3Schema,
  ManifestV4Schema,
  ManifestV5Schema,
  // Event and component/binding snapshot schemas.
  ActivationEventEntrySchema,
  ComponentRegionSchema,
  ComponentSnapshotSchema,
  EventEntrySchema,
  PortableEventEntrySchema,
  QueryBindingSnapshotSchema,
  StateBindingSnapshotSchema,
  BindingSnapshotSchema,
  // Expression entry schemas (present in v3+ manifests an adapter decodes).
  ExpressionEntrySchema,
  ExpressionEntryV3Schema,
  ExpressionEntryV4Schema,
  ExpressionEntryV5Schema,
  ExpressionTargetV5Schema,
  // The SPI operations.
  decodeManifest,
  installClient,
  // The error union those operations can produce.
  ResumeBindingSnapshotNotFoundError,
  ResumeBindingSnapshotNotWritableError,
  ResumeBindingSnapshotWriteDisposedError,
  ResumeBindingSnapshotWriteEncodeError,
  ResumeClientBuildMismatchError,
  ResumeConfigurationError,
  ResumeManifestDecodeError,
  ResumePayloadTooLargeError,
  ResumeSerializerMismatchError,
} from "./Resume.js";
export type {
  BindingSnapshot,
  BindingSnapshotWriteError,
  ClientInstallError,
  ClientInstallation,
  ClientInstallationInspection,
  ComponentSnapshot,
  Manifest,
  ManifestDecodeError,
  ValidatedManifest,
} from "./Resume.js";
