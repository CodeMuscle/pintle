-- Extensions (blueprint: emails are CITEXT; pgcrypto for gen_random_uuid/digest)
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "full_name" VARCHAR(150) NOT NULL,
    "avatar_url" TEXT,
    "status" VARCHAR(20) NOT NULL,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "invited_by" UUID,
    "joined_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invitations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "role" VARCHAR(40) NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "invited_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "plan" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "primary_region" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tenant_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "default_timezone" VARCHAR(50) NOT NULL,
    "data_retention_days" INTEGER NOT NULL,
    "default_product_type" VARCHAR(50) NOT NULL,
    "allow_customer_comments" BOOLEAN NOT NULL,
    "pii_masking_enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."feature_entitlements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "feature_key" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "config" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feature_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."migration_projects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "customer_name" VARCHAR(150) NOT NULL,
    "project_code" VARCHAR(50) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "current_stage" VARCHAR(40) NOT NULL,
    "migration_type" VARCHAR(30) NOT NULL,
    "target_environment" VARCHAR(20) NOT NULL,
    "target_product_type" VARCHAR(50) NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(6),
    "went_live_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "migration_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."migration_stage_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "from_stage" VARCHAR(40),
    "to_stage" VARCHAR(40) NOT NULL,
    "changed_by" UUID NOT NULL,
    "reason" TEXT,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."project_members" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "access_level" VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."project_activity" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "activity_type" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."data_sources" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_type" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "external_system_name" VARCHAR(120),
    "status" VARCHAR(30) NOT NULL,
    "connection_config" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."source_uploads" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "data_source_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "upload_status" VARCHAR(20) NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "source_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."source_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "data_source_id" UUID NOT NULL,
    "source_upload_id" UUID,
    "batch_type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "row_count" INTEGER,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."destination_schemas" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "product_type" VARCHAR(50) NOT NULL,
    "version" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "schema_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "destination_schemas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."source_schema_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "detected_format" VARCHAR(20) NOT NULL,
    "header_row_index" INTEGER NOT NULL,
    "row_sample_count" INTEGER NOT NULL,
    "schema_json" JSONB NOT NULL,
    "detection_warnings" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_schema_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."schema_fields" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "schema_snapshot_id" UUID,
    "destination_schema_id" UUID,
    "field_key" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "data_type" VARCHAR(30) NOT NULL,
    "is_required" BOOLEAN NOT NULL,
    "enum_values" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schema_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."field_mappings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_snapshot_id" UUID NOT NULL,
    "destination_schema_id" UUID NOT NULL,
    "source_field_key" VARCHAR(100),
    "destination_field_key" VARCHAR(100) NOT NULL,
    "mapping_type" VARCHAR(30) NOT NULL,
    "transform_rule_id" UUID,
    "default_value" JSONB,
    "config" JSONB,
    "is_required_override" BOOLEAN,
    "status" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."transform_rules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID,
    "rule_key" VARCHAR(80) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "rule_config" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transform_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."mapping_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_snapshot_id" UUID NOT NULL,
    "destination_schema_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "mapping_json" JSONB NOT NULL,
    "published_by" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mapping_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."mapping_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "template_name" VARCHAR(120) NOT NULL,
    "source_system_name" VARCHAR(120) NOT NULL,
    "target_product_type" VARCHAR(50) NOT NULL,
    "template_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mapping_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_role_idx" ON "public"."memberships"("tenant_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_user_id_key" ON "public"."memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "invitations_tenant_id_email_idx" ON "public"."invitations"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "public"."tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenant_id_key" ON "public"."tenant_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "feature_entitlements_tenant_id_feature_key_key" ON "public"."feature_entitlements"("tenant_id", "feature_key");

-- CreateIndex
CREATE INDEX "migration_projects_tenant_id_status_idx" ON "public"."migration_projects"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "migration_projects_tenant_id_current_stage_idx" ON "public"."migration_projects"("tenant_id", "current_stage");

-- CreateIndex
CREATE UNIQUE INDEX "migration_projects_tenant_id_project_code_key" ON "public"."migration_projects"("tenant_id", "project_code");

-- CreateIndex
CREATE INDEX "migration_stage_history_tenant_id_project_id_idx" ON "public"."migration_stage_history"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_tenant_id_project_id_user_id_key" ON "public"."project_members"("tenant_id", "project_id", "user_id");

-- CreateIndex
CREATE INDEX "project_activity_tenant_id_project_id_idx" ON "public"."project_activity"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "data_sources_tenant_id_project_id_idx" ON "public"."data_sources"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "source_uploads_tenant_id_project_id_idx" ON "public"."source_uploads"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "source_batches_tenant_id_project_id_idx" ON "public"."source_batches"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "destination_schemas_tenant_id_product_type_version_key" ON "public"."destination_schemas"("tenant_id", "product_type", "version");

-- CreateIndex
CREATE INDEX "source_schema_snapshots_tenant_id_project_id_idx" ON "public"."source_schema_snapshots"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "schema_fields_tenant_id_schema_snapshot_id_idx" ON "public"."schema_fields"("tenant_id", "schema_snapshot_id");

-- CreateIndex
CREATE INDEX "schema_fields_tenant_id_destination_schema_id_idx" ON "public"."schema_fields"("tenant_id", "destination_schema_id");

-- CreateIndex
CREATE INDEX "field_mappings_tenant_id_project_id_idx" ON "public"."field_mappings"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "field_mappings_tenant_id_project_id_destination_field_key_idx" ON "public"."field_mappings"("tenant_id", "project_id", "destination_field_key");

-- CreateIndex
CREATE INDEX "transform_rules_tenant_id_project_id_idx" ON "public"."transform_rules"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "mapping_versions_tenant_id_project_id_idx" ON "public"."mapping_versions"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "mapping_versions_tenant_id_project_id_version_number_key" ON "public"."mapping_versions"("tenant_id", "project_id", "version_number");

-- CreateIndex
CREATE INDEX "mapping_templates_tenant_id_target_product_type_idx" ON "public"."mapping_templates"("tenant_id", "target_product_type");

-- AddForeignKey
ALTER TABLE "public"."memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."memberships" ADD CONSTRAINT "memberships_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invitations" ADD CONSTRAINT "invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invitations" ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."feature_entitlements" ADD CONSTRAINT "feature_entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."migration_projects" ADD CONSTRAINT "migration_projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."migration_projects" ADD CONSTRAINT "migration_projects_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."migration_stage_history" ADD CONSTRAINT "migration_stage_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."migration_stage_history" ADD CONSTRAINT "migration_stage_history_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."migration_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."migration_stage_history" ADD CONSTRAINT "migration_stage_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_members" ADD CONSTRAINT "project_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."migration_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_activity" ADD CONSTRAINT "project_activity_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_activity" ADD CONSTRAINT "project_activity_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."migration_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_activity" ADD CONSTRAINT "project_activity_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."data_sources" ADD CONSTRAINT "data_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."data_sources" ADD CONSTRAINT "data_sources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."migration_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."source_uploads" ADD CONSTRAINT "source_uploads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."source_uploads" ADD CONSTRAINT "source_uploads_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."source_uploads" ADD CONSTRAINT "source_uploads_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."source_batches" ADD CONSTRAINT "source_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."source_batches" ADD CONSTRAINT "source_batches_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."source_batches" ADD CONSTRAINT "source_batches_source_upload_id_fkey" FOREIGN KEY ("source_upload_id") REFERENCES "public"."source_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."destination_schemas" ADD CONSTRAINT "destination_schemas_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."source_schema_snapshots" ADD CONSTRAINT "source_schema_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."source_schema_snapshots" ADD CONSTRAINT "source_schema_snapshots_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."source_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."schema_fields" ADD CONSTRAINT "schema_fields_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."field_mappings" ADD CONSTRAINT "field_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."field_mappings" ADD CONSTRAINT "field_mappings_source_snapshot_id_fkey" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_schema_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."field_mappings" ADD CONSTRAINT "field_mappings_destination_schema_id_fkey" FOREIGN KEY ("destination_schema_id") REFERENCES "public"."destination_schemas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."field_mappings" ADD CONSTRAINT "field_mappings_transform_rule_id_fkey" FOREIGN KEY ("transform_rule_id") REFERENCES "public"."transform_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."transform_rules" ADD CONSTRAINT "transform_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mapping_versions" ADD CONSTRAINT "mapping_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mapping_versions" ADD CONSTRAINT "mapping_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mapping_templates" ADD CONSTRAINT "mapping_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- CHECK constraints for enum-like columns (blueprint: "Check constraints for
-- enum-like fields when not using PostgreSQL enums"). Kept in sync with
-- @pintle/contracts src/enums.ts.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "public"."users" ADD CONSTRAINT "users_status_check" CHECK ("status" IN ('active','invited','disabled'));
ALTER TABLE "public"."memberships" ADD CONSTRAINT "memberships_role_check" CHECK ("role" IN ('owner','admin','manager','engineer','customer_viewer','customer_editor'));
ALTER TABLE "public"."memberships" ADD CONSTRAINT "memberships_status_check" CHECK ("status" IN ('active','invited','revoked'));
ALTER TABLE "public"."invitations" ADD CONSTRAINT "invitations_role_check" CHECK ("role" IN ('owner','admin','manager','engineer','customer_viewer','customer_editor'));
ALTER TABLE "public"."tenants" ADD CONSTRAINT "tenants_plan_check" CHECK ("plan" IN ('free','growth','enterprise'));
ALTER TABLE "public"."tenants" ADD CONSTRAINT "tenants_status_check" CHECK ("status" IN ('active','suspended','trialing'));
ALTER TABLE "public"."migration_projects" ADD CONSTRAINT "migration_projects_status_check" CHECK ("status" IN ('draft','active','blocked','ready_for_cutover','completed','rolled_back'));
ALTER TABLE "public"."migration_projects" ADD CONSTRAINT "migration_projects_current_stage_check" CHECK ("current_stage" IN ('setup','ingestion','mapping','validation','dry_run','cutover','complete'));
ALTER TABLE "public"."migration_projects" ADD CONSTRAINT "migration_projects_migration_type_check" CHECK ("migration_type" IN ('file','api','hybrid'));
ALTER TABLE "public"."migration_projects" ADD CONSTRAINT "migration_projects_target_environment_check" CHECK ("target_environment" IN ('sandbox','production'));
ALTER TABLE "public"."project_members" ADD CONSTRAINT "project_members_access_level_check" CHECK ("access_level" IN ('owner','editor','viewer'));
ALTER TABLE "public"."data_sources" ADD CONSTRAINT "data_sources_source_type_check" CHECK ("source_type" IN ('csv','xlsx','api','s3','manual'));
ALTER TABLE "public"."data_sources" ADD CONSTRAINT "data_sources_status_check" CHECK ("status" IN ('connected','uploaded','processing','ready','failed'));
ALTER TABLE "public"."source_uploads" ADD CONSTRAINT "source_uploads_upload_status_check" CHECK ("upload_status" IN ('pending','uploaded','processing','processed','failed'));
ALTER TABLE "public"."source_batches" ADD CONSTRAINT "source_batches_batch_type_check" CHECK ("batch_type" IN ('initial','retry','delta'));
ALTER TABLE "public"."source_batches" ADD CONSTRAINT "source_batches_status_check" CHECK ("status" IN ('queued','parsing','parsed','validation_pending','failed'));
ALTER TABLE "public"."destination_schemas" ADD CONSTRAINT "destination_schemas_status_check" CHECK ("status" IN ('active','deprecated'));
ALTER TABLE "public"."source_schema_snapshots" ADD CONSTRAINT "source_schema_snapshots_detected_format_check" CHECK ("detected_format" IN ('csv','xlsx','json'));
ALTER TABLE "public"."schema_fields" ADD CONSTRAINT "schema_fields_data_type_check" CHECK ("data_type" IN ('string','number','date','enum','boolean'));
ALTER TABLE "public"."field_mappings" ADD CONSTRAINT "field_mappings_mapping_type_check" CHECK ("mapping_type" IN ('direct','constant','transform','composite','ignored'));
ALTER TABLE "public"."field_mappings" ADD CONSTRAINT "field_mappings_status_check" CHECK ("status" IN ('draft','active'));
ALTER TABLE "public"."mapping_versions" ADD CONSTRAINT "mapping_versions_status_check" CHECK ("status" IN ('published','deprecated'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Partial indexes (blueprint: "Recommended indexes and constraints").
-- ─────────────────────────────────────────────────────────────────────────────
-- Active projects per tenant.
CREATE INDEX "migration_projects_active_idx" ON "public"."migration_projects" ("tenant_id", "status") WHERE "status" IN ('draft','active','blocked','ready_for_cutover');
-- Unresolved uploads.
CREATE INDEX "source_uploads_unresolved_idx" ON "public"."source_uploads" ("tenant_id", "project_id") WHERE "upload_status" IN ('pending','processing','failed');
-- Latest published mapping versions by project.
CREATE INDEX "mapping_versions_published_idx" ON "public"."mapping_versions" ("tenant_id", "project_id", "version_number" DESC) WHERE "status" = 'published';
