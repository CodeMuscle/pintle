/**
 * @pintle/contracts — canonical cross-package contracts.
 *
 * Zod schemas + inferred TypeScript types for the API envelope, tenant
 * context, job/event envelopes, shared enums, and the request/response DTOs
 * of Modules 1–6. Matches /docs/design/database-blueprint.docx (reconciled
 * 2026-05-17, see CHANGELOG.md). Import these — never re-declare per package.
 */
export * from "./envelope.js";
export * from "./tenant.js";
export * from "./job.js";
export * from "./events.js";
export * from "./enums.js";
export * from "./queues.js";

// Module DTO groups, namespaced to keep request/response names unambiguous.
export * as IdentityDTO from "./modules/identity.js";
export * as TenantDTO from "./modules/tenant.js";
export * as ProjectsDTO from "./modules/projects.js";
export * as IngestionDTO from "./modules/ingestion.js";
export * as SchemaRegistryDTO from "./modules/schema-registry.js";
export * as MappingDTO from "./modules/mapping.js";
export * as ValidationDTO from "./modules/validation.js";
