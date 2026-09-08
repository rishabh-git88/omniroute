-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- Extensions are migration-owned so fresh and existing databases behave alike.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETION_REQUESTED', 'DELETED');

-- CreateEnum
CREATE TYPE "WorkspacePlan" AS ENUM ('FREE', 'PRO');

-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('SINGLE', 'COMPARE');

-- CreateEnum
CREATE TYPE "RequestGroupStatus" AS ENUM ('PENDING', 'RESERVED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ModelRunStatus" AS ENUM ('PENDING', 'RESERVED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoutingStrategy" AS ENUM ('USER_SELECTED', 'COMPARE', 'AUTO', 'FALLBACK');

-- CreateEnum
CREATE TYPE "RegistryRolloutState" AS ENUM ('DISABLED', 'INTERNAL', 'BETA', 'GENERAL');

-- CreateEnum
CREATE TYPE "FileScanStatus" AS ENUM ('PENDING', 'CLEAN', 'REJECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "FileProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MemoryKind" AS ENUM ('PINNED_FACT', 'WORKSPACE_RULE', 'CONVERSATION_SUMMARY');

-- CreateEnum
CREATE TYPE "MemorySourceKind" AS ENUM ('USER_AUTHORED', 'TURN', 'RESPONSE', 'FILE', 'ARTIFACT');

-- CreateEnum
CREATE TYPE "EmbeddingSourceKind" AS ENUM ('TURN', 'RESPONSE', 'FILE_CHUNK', 'MEMORY', 'ARTIFACT');

-- CreateEnum
CREATE TYPE "UsageEventKind" AS ENUM ('PARTIAL', 'FINAL', 'CORRECTION');

-- CreateEnum
CREATE TYPE "CreditReservationStatus" AS ENUM ('PENDING', 'SETTLED', 'RELEASED');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('GRANT', 'RESERVATION', 'CHARGE', 'RELEASE', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CreditTransactionStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EntitlementValueType" AS ENUM ('BOOLEAN', 'INTEGER', 'TEXT');

-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('THUMBS_UP', 'THUMBS_DOWN', 'REPORT', 'SWITCH_COHERENCE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "identity_provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "email_at_provider" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_login_at" TIMESTAMPTZ(6),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "WorkspacePlan" NOT NULL DEFAULT 'FREE',
    "retention_policy" TEXT NOT NULL DEFAULT 'standard',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "billing_provider" TEXT NOT NULL,
    "external_subscription_id" TEXT NOT NULL,
    "plan_key" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "current_period_start" TIMESTAMPTZ(6),
    "current_period_end" TIMESTAMPTZ(6),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "subscription_id" UUID,
    "key" TEXT NOT NULL,
    "value_type" "EntitlementValueType" NOT NULL,
    "boolean_value" BOOLEAN,
    "integer_value" BIGINT,
    "text_value" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "models" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "model_key" TEXT NOT NULL,
    "provider_model_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_registry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "registry_version" INTEGER NOT NULL,
    "capabilities" JSONB NOT NULL,
    "pricing" JSONB NOT NULL,
    "pricing_version" TEXT NOT NULL,
    "rollout_state" "RegistryRolloutState" NOT NULL DEFAULT 'DISABLED',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "region_constraints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "retired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "active_head_id" UUID,
    "mode" "ConversationMode" NOT NULL DEFAULT 'SINGLE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "mode" "ConversationMode" NOT NULL,
    "status" "RequestGroupStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "request_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "request_group_id" UUID NOT NULL,
    "parent_response_id" UUID,
    "user_content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ(6),

    CONSTRAINT "turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_group_id" UUID NOT NULL,
    "strategy" "RoutingStrategy" NOT NULL,
    "reason" TEXT,
    "input_snapshot" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_decision_models" (
    "routing_decision_id" UUID NOT NULL,
    "registry_entry_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,

    CONSTRAINT "routing_decision_models_pkey" PRIMARY KEY ("routing_decision_id","registry_entry_id")
);

-- CreateTable
CREATE TABLE "model_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "turn_id" UUID NOT NULL,
    "request_group_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "registry_entry_id" UUID NOT NULL,
    "status" "ModelRunStatus" NOT NULL DEFAULT 'PENDING',
    "provider_request_id" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "model_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "finish_reason" TEXT,
    "selected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "summary_version" INTEGER,
    "source_ids" JSONB NOT NULL,
    "token_estimate" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "checksum_sha256" TEXT,
    "scan_status" "FileScanStatus" NOT NULL DEFAULT 'PENDING',
    "processing_status" "FileProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turn_files" (
    "turn_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turn_files_pkey" PRIMARY KEY ("turn_id","file_id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "source_run_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "file_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "owner_user_id" UUID,
    "conversation_id" UUID,
    "kind" "MemoryKind" NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidated_at" TIMESTAMPTZ(6),

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_sources" (
    "memory_id" UUID NOT NULL,
    "source_kind" "MemorySourceKind" NOT NULL,
    "turn_id" UUID,
    "response_id" UUID,
    "file_id" UUID,
    "artifact_id" UUID,
    "source_hash" TEXT NOT NULL,

    CONSTRAINT "memory_sources_pkey" PRIMARY KEY ("memory_id","source_kind","source_hash")
);

-- CreateTable
CREATE TABLE "embeddings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "source_kind" "EmbeddingSourceKind" NOT NULL,
    "turn_id" UUID,
    "response_id" UUID,
    "file_chunk_id" UUID,
    "memory_id" UUID,
    "artifact_id" UUID,
    "embedding_model" TEXT NOT NULL,
    "model_version" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "embedding" vector,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "kind" "UsageEventKind" NOT NULL,
    "input_tokens" BIGINT NOT NULL DEFAULT 0,
    "output_tokens" BIGINT NOT NULL DEFAULT 0,
    "cached_tokens" BIGINT NOT NULL DEFAULT 0,
    "provider_usage" JSONB NOT NULL,
    "price_snapshot" JSONB NOT NULL,
    "actual_cost" DECIMAL(20,8) NOT NULL,
    "cost_currency" TEXT NOT NULL DEFAULT 'USD',
    "billed_credits" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "available_credits" BIGINT NOT NULL DEFAULT 0,
    "reserved_credits" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "credit_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "wallet_id" UUID NOT NULL,
    "request_group_id" UUID NOT NULL,
    "model_run_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "reserved_credits" BIGINT NOT NULL,
    "settled_credits" BIGINT,
    "status" "CreditReservationStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciled_at" TIMESTAMPTZ(6),

    CONSTRAINT "credit_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "wallet_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "request_group_id" UUID,
    "model_run_id" UUID,
    "reservation_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "available_delta" BIGINT NOT NULL,
    "reserved_delta" BIGINT NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "status" "CreditTransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID,
    "response_id" UUID,
    "kind" "FeedbackKind" NOT NULL,
    "score" INTEGER,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "actor_user_id" UUID,
    "event_type" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_identity_provider_provider_account_id_key" ON "accounts"("identity_provider", "provider_account_id");

-- CreateIndex
CREATE INDEX "workspaces_owner_id_created_at_idx" ON "workspaces"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_billing_provider_external_subscription_id_key" ON "subscriptions"("billing_provider", "external_subscription_id");

-- CreateIndex
CREATE INDEX "entitlements_workspace_id_key_ends_at_idx" ON "entitlements"("workspace_id", "key", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_workspace_id_key_starts_at_key" ON "entitlements"("workspace_id", "key", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "providers_key_key" ON "providers"("key");

-- CreateIndex
CREATE UNIQUE INDEX "models_model_key_key" ON "models"("model_key");

-- CreateIndex
CREATE UNIQUE INDEX "models_provider_id_provider_model_id_key" ON "models"("provider_id", "provider_model_id");

-- CreateIndex
CREATE INDEX "provider_registry_provider_id_enabled_rollout_state_idx" ON "provider_registry"("provider_id", "enabled", "rollout_state");

-- CreateIndex
CREATE UNIQUE INDEX "provider_registry_model_id_registry_version_key" ON "provider_registry"("model_id", "registry_version");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_active_head_id_key" ON "conversations"("active_head_id");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_updated_at_idx" ON "conversations"("workspace_id", "updated_at");

-- CreateIndex
CREATE INDEX "request_groups_conversation_id_created_at_idx" ON "request_groups"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "request_groups_user_id_idempotency_key_key" ON "request_groups"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "turns_request_group_id_key" ON "turns"("request_group_id");

-- CreateIndex
CREATE INDEX "turns_conversation_id_created_at_idx" ON "turns"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "routing_decisions_request_group_id_key" ON "routing_decisions"("request_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "routing_decision_models_routing_decision_id_position_key" ON "routing_decision_models"("routing_decision_id", "position");

-- CreateIndex
CREATE INDEX "model_runs_request_group_id_idx" ON "model_runs"("request_group_id");

-- CreateIndex
CREATE INDEX "model_runs_turn_id_provider_id_idx" ON "model_runs"("turn_id", "provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "model_runs_turn_id_provider_id_model_id_attempt_key" ON "model_runs"("turn_id", "provider_id", "model_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "model_runs_id_turn_id_key" ON "model_runs"("id", "turn_id");

-- CreateIndex
CREATE UNIQUE INDEX "model_responses_run_id_key" ON "model_responses"("run_id");

-- CreateIndex
CREATE INDEX "model_responses_turn_id_created_at_idx" ON "model_responses"("turn_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "model_responses_run_id_turn_id_key" ON "model_responses"("run_id", "turn_id");

-- CreateIndex
CREATE UNIQUE INDEX "context_snapshots_run_id_key" ON "context_snapshots"("run_id");

-- CreateIndex
CREATE INDEX "context_snapshots_snapshot_hash_idx" ON "context_snapshots"("snapshot_hash");

-- CreateIndex
CREATE UNIQUE INDEX "files_object_key_key" ON "files"("object_key");

-- CreateIndex
CREATE INDEX "files_workspace_id_created_at_idx" ON "files"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "artifacts_object_key_key" ON "artifacts"("object_key");

-- CreateIndex
CREATE INDEX "artifacts_conversation_id_created_at_idx" ON "artifacts"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "file_chunks_file_id_chunk_index_key" ON "file_chunks"("file_id", "chunk_index");

-- CreateIndex
CREATE INDEX "memories_workspace_id_kind_valid_idx" ON "memories"("workspace_id", "kind", "valid");

-- CreateIndex
CREATE INDEX "memories_conversation_id_version_idx" ON "memories"("conversation_id", "version");

-- CreateIndex
CREATE INDEX "embeddings_workspace_id_source_kind_idx" ON "embeddings"("workspace_id", "source_kind");

-- CreateIndex
CREATE UNIQUE INDEX "embeddings_source_kind_content_hash_embedding_model_model_v_key" ON "embeddings"("source_kind", "content_hash", "embedding_model", "model_version");

-- CreateIndex
CREATE INDEX "usage_events_run_id_created_at_idx" ON "usage_events"("run_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "usage_events_run_id_event_key_key" ON "usage_events"("run_id", "event_key");

-- CreateIndex
CREATE UNIQUE INDEX "credit_wallets_user_id_key" ON "credit_wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_reservations_model_run_id_key" ON "credit_reservations"("model_run_id");

-- CreateIndex
CREATE INDEX "credit_reservations_request_group_id_idx" ON "credit_reservations"("request_group_id");

-- CreateIndex
CREATE INDEX "credit_reservations_status_created_at_idx" ON "credit_reservations"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_reservations_wallet_id_idempotency_key_key" ON "credit_reservations"("wallet_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "credit_transactions_user_id_created_at_idx" ON "credit_transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "credit_transactions_request_group_id_idx" ON "credit_transactions"("request_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_transactions_wallet_id_idempotency_key_key" ON "credit_transactions"("wallet_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "feedback_conversation_id_created_at_idx" ON "feedback"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "feedback_response_id_kind_idx" ON "feedback"("response_id", "kind");

-- CreateIndex
CREATE INDEX "audit_events_workspace_id_created_at_idx" ON "audit_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_user_id_created_at_idx" ON "audit_events"("actor_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_registry" ADD CONSTRAINT "provider_registry_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_registry" ADD CONSTRAINT "provider_registry_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_active_head_id_fkey" FOREIGN KEY ("active_head_id") REFERENCES "model_responses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_groups" ADD CONSTRAINT "request_groups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_groups" ADD CONSTRAINT "request_groups_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_groups" ADD CONSTRAINT "request_groups_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turns" ADD CONSTRAINT "turns_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turns" ADD CONSTRAINT "turns_request_group_id_fkey" FOREIGN KEY ("request_group_id") REFERENCES "request_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turns" ADD CONSTRAINT "turns_parent_response_id_fkey" FOREIGN KEY ("parent_response_id") REFERENCES "model_responses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_decisions" ADD CONSTRAINT "routing_decisions_request_group_id_fkey" FOREIGN KEY ("request_group_id") REFERENCES "request_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_decision_models" ADD CONSTRAINT "routing_decision_models_routing_decision_id_fkey" FOREIGN KEY ("routing_decision_id") REFERENCES "routing_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_decision_models" ADD CONSTRAINT "routing_decision_models_registry_entry_id_fkey" FOREIGN KEY ("registry_entry_id") REFERENCES "provider_registry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_request_group_id_fkey" FOREIGN KEY ("request_group_id") REFERENCES "request_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_registry_entry_id_fkey" FOREIGN KEY ("registry_entry_id") REFERENCES "provider_registry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_responses" ADD CONSTRAINT "model_responses_run_id_turn_id_fkey" FOREIGN KEY ("run_id", "turn_id") REFERENCES "model_runs"("id", "turn_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_responses" ADD CONSTRAINT "model_responses_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_snapshots" ADD CONSTRAINT "context_snapshots_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "model_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turn_files" ADD CONSTRAINT "turn_files_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turn_files" ADD CONSTRAINT "turn_files_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_source_run_id_fkey" FOREIGN KEY ("source_run_id") REFERENCES "model_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_sources" ADD CONSTRAINT "memory_sources_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_sources" ADD CONSTRAINT "memory_sources_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_sources" ADD CONSTRAINT "memory_sources_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "model_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_sources" ADD CONSTRAINT "memory_sources_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_sources" ADD CONSTRAINT "memory_sources_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "model_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_file_chunk_id_fkey" FOREIGN KEY ("file_chunk_id") REFERENCES "file_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "model_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "credit_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_request_group_id_fkey" FOREIGN KEY ("request_group_id") REFERENCES "request_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_model_run_id_fkey" FOREIGN KEY ("model_run_id") REFERENCES "model_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "credit_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_request_group_id_fkey" FOREIGN KEY ("request_group_id") REFERENCES "request_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_model_run_id_fkey" FOREIGN KEY ("model_run_id") REFERENCES "model_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "credit_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "model_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain checks not expressible in Prisma's schema language.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized_check"
  CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%._%');

ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_identity_nonempty_check"
  CHECK (btrim(identity_provider) <> '' AND btrim(provider_account_id) <> '');

ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_name_nonempty_check" CHECK (btrim(name) <> ''),
  ADD CONSTRAINT "workspaces_retention_policy_nonempty_check" CHECK (btrim(retention_policy) <> '');

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_period_check"
  CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start);

ALTER TABLE "entitlements"
  ADD CONSTRAINT "entitlements_key_nonempty_check" CHECK (btrim(key) <> ''),
  ADD CONSTRAINT "entitlements_period_check" CHECK (ends_at IS NULL OR ends_at > starts_at),
  ADD CONSTRAINT "entitlements_typed_value_check" CHECK (
    (value_type = 'BOOLEAN' AND boolean_value IS NOT NULL AND integer_value IS NULL AND text_value IS NULL) OR
    (value_type = 'INTEGER' AND boolean_value IS NULL AND integer_value IS NOT NULL AND text_value IS NULL) OR
    (value_type = 'TEXT' AND boolean_value IS NULL AND integer_value IS NULL AND text_value IS NOT NULL)
  );

ALTER TABLE "providers"
  ADD CONSTRAINT "providers_key_format_check" CHECK (key ~ '^[a-z][a-z0-9-]*$');

ALTER TABLE "models"
  ADD CONSTRAINT "models_key_format_check" CHECK (model_key ~ '^[a-z0-9][a-z0-9:._-]*$'),
  ADD CONSTRAINT "models_provider_model_id_nonempty_check" CHECK (btrim(provider_model_id) <> '');

ALTER TABLE "provider_registry"
  ADD CONSTRAINT "provider_registry_version_positive_check" CHECK (registry_version > 0),
  ADD CONSTRAINT "provider_registry_capabilities_object_check" CHECK (jsonb_typeof(capabilities) = 'object'),
  ADD CONSTRAINT "provider_registry_pricing_object_check" CHECK (jsonb_typeof(pricing) = 'object'),
  ADD CONSTRAINT "provider_registry_effective_period_check" CHECK (retired_at IS NULL OR retired_at > effective_at);

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_title_nonempty_check" CHECK (btrim(title) <> '');

ALTER TABLE "request_groups"
  ADD CONSTRAINT "request_groups_idempotency_nonempty_check" CHECK (btrim(idempotency_key) <> '');

ALTER TABLE "turns"
  ADD CONSTRAINT "turns_content_nonempty_check" CHECK (btrim(user_content) <> '');

ALTER TABLE "routing_decision_models"
  ADD CONSTRAINT "routing_decision_models_position_nonnegative_check" CHECK (position >= 0);

ALTER TABLE "model_runs"
  ADD CONSTRAINT "model_runs_attempt_positive_check" CHECK (attempt > 0),
  ADD CONSTRAINT "model_runs_time_order_check" CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at);

ALTER TABLE "context_snapshots"
  ADD CONSTRAINT "context_snapshots_hash_nonempty_check" CHECK (btrim(snapshot_hash) <> ''),
  ADD CONSTRAINT "context_snapshots_source_ids_array_check" CHECK (jsonb_typeof(source_ids) = 'array'),
  ADD CONSTRAINT "context_snapshots_token_estimate_check" CHECK (token_estimate >= 0),
  ADD CONSTRAINT "context_snapshots_summary_version_check" CHECK (summary_version IS NULL OR summary_version > 0);

ALTER TABLE "files"
  ADD CONSTRAINT "files_size_nonnegative_check" CHECK (size >= 0),
  ADD CONSTRAINT "files_object_key_nonempty_check" CHECK (btrim(object_key) <> '');

ALTER TABLE "file_chunks"
  ADD CONSTRAINT "file_chunks_index_nonnegative_check" CHECK (chunk_index >= 0),
  ADD CONSTRAINT "file_chunks_token_count_check" CHECK (token_count IS NULL OR token_count >= 0);

ALTER TABLE "memories"
  ADD CONSTRAINT "memories_version_positive_check" CHECK (version > 0),
  ADD CONSTRAINT "memories_validity_check" CHECK ((valid AND invalidated_at IS NULL) OR (NOT valid AND invalidated_at IS NOT NULL)),
  ADD CONSTRAINT "memories_summary_scope_check" CHECK (kind <> 'CONVERSATION_SUMMARY' OR conversation_id IS NOT NULL);

ALTER TABLE "memory_sources"
  ADD CONSTRAINT "memory_sources_exactly_one_source_check" CHECK (
    num_nonnulls(turn_id, response_id, file_id, artifact_id) = CASE WHEN source_kind = 'USER_AUTHORED' THEN 0 ELSE 1 END
  ),
  ADD CONSTRAINT "memory_sources_kind_matches_source_check" CHECK (
    source_kind = 'USER_AUTHORED' OR
    (source_kind = 'TURN' AND turn_id IS NOT NULL) OR
    (source_kind = 'RESPONSE' AND response_id IS NOT NULL) OR
    (source_kind = 'FILE' AND file_id IS NOT NULL) OR
    (source_kind = 'ARTIFACT' AND artifact_id IS NOT NULL)
  );

ALTER TABLE "embeddings"
  ADD CONSTRAINT "embeddings_exactly_one_source_check" CHECK (num_nonnulls(turn_id, response_id, file_chunk_id, memory_id, artifact_id) = 1),
  ADD CONSTRAINT "embeddings_kind_matches_source_check" CHECK (
    (source_kind = 'TURN' AND turn_id IS NOT NULL) OR
    (source_kind = 'RESPONSE' AND response_id IS NOT NULL) OR
    (source_kind = 'FILE_CHUNK' AND file_chunk_id IS NOT NULL) OR
    (source_kind = 'MEMORY' AND memory_id IS NOT NULL) OR
    (source_kind = 'ARTIFACT' AND artifact_id IS NOT NULL)
  ),
  ADD CONSTRAINT "embeddings_dimensions_positive_check" CHECK (dimensions > 0),
  ADD CONSTRAINT "embeddings_vector_dimensions_check" CHECK (embedding IS NULL OR vector_dims(embedding) = dimensions);

ALTER TABLE "usage_events"
  ADD CONSTRAINT "usage_events_tokens_nonnegative_check" CHECK (input_tokens >= 0 AND output_tokens >= 0 AND cached_tokens >= 0),
  ADD CONSTRAINT "usage_events_cost_nonnegative_check" CHECK (actual_cost >= 0 AND billed_credits >= 0),
  ADD CONSTRAINT "usage_events_provider_usage_object_check" CHECK (jsonb_typeof(provider_usage) = 'object'),
  ADD CONSTRAINT "usage_events_price_snapshot_object_check" CHECK (jsonb_typeof(price_snapshot) = 'object');

ALTER TABLE "credit_wallets"
  ADD CONSTRAINT "credit_wallets_nonnegative_check" CHECK (available_credits >= 0 AND reserved_credits >= 0),
  ADD CONSTRAINT "credit_wallets_version_nonnegative_check" CHECK (version >= 0);

ALTER TABLE "credit_reservations"
  ADD CONSTRAINT "credit_reservations_reserved_positive_check" CHECK (reserved_credits > 0),
  ADD CONSTRAINT "credit_reservations_settled_range_check" CHECK (settled_credits IS NULL OR (settled_credits >= 0 AND settled_credits <= reserved_credits)),
  ADD CONSTRAINT "credit_reservations_state_check" CHECK (
    (status = 'PENDING' AND settled_credits IS NULL AND reconciled_at IS NULL) OR
    (status = 'SETTLED' AND settled_credits IS NOT NULL AND settled_credits > 0 AND reconciled_at IS NOT NULL) OR
    (status = 'RELEASED' AND settled_credits = 0 AND reconciled_at IS NOT NULL)
  );

ALTER TABLE "credit_transactions"
  ADD CONSTRAINT "credit_transactions_amount_positive_check" CHECK (amount > 0),
  ADD CONSTRAINT "credit_transactions_status_check" CHECK (
    (type = 'RESERVATION' AND status = 'PENDING') OR
    (type <> 'RESERVATION' AND status = 'COMPLETED')
  ),
  ADD CONSTRAINT "credit_transactions_shape_check" CHECK (
    (type = 'GRANT' AND available_delta = amount AND reserved_delta = 0 AND reservation_id IS NULL) OR
    (type = 'RESERVATION' AND available_delta = -amount AND reserved_delta = amount AND reservation_id IS NOT NULL) OR
    (type = 'CHARGE' AND available_delta >= 0 AND reserved_delta < 0 AND reservation_id IS NOT NULL AND amount <= -reserved_delta AND available_delta = (-reserved_delta - amount)) OR
    (type = 'RELEASE' AND available_delta = amount AND reserved_delta = -amount AND reservation_id IS NOT NULL) OR
    (type = 'REFUND' AND available_delta = amount AND reserved_delta = 0) OR
    (type = 'ADJUSTMENT' AND reserved_delta = 0 AND abs(available_delta) = amount)
  );

ALTER TABLE "feedback"
  ADD CONSTRAINT "feedback_target_check" CHECK (turn_id IS NOT NULL OR response_id IS NOT NULL),
  ADD CONSTRAINT "feedback_score_check" CHECK (score IS NULL OR score BETWEEN 1 AND 5);

-- One response candidate per turn may be selected at a time.
CREATE UNIQUE INDEX "model_responses_one_selected_per_turn_idx"
  ON "model_responses" (turn_id)
  WHERE selected_at IS NOT NULL;

-- Only one current registry snapshot may be enabled for a model.
CREATE UNIQUE INDEX "provider_registry_one_enabled_model_idx"
  ON "provider_registry" (model_id)
  WHERE enabled AND retired_at IS NULL;

-- Protect the ledger's audit trail. Reservation lifecycle lives in credit_reservations.
CREATE OR REPLACE FUNCTION prevent_credit_transaction_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'credit transactions are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "credit_transactions_append_only"
  BEFORE UPDATE OR DELETE ON "credit_transactions"
  FOR EACH ROW EXECUTE FUNCTION prevent_credit_transaction_mutation();

CREATE OR REPLACE FUNCTION prevent_immutable_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "usage_events_append_only"
  BEFORE UPDATE OR DELETE ON "usage_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_event_mutation();

-- Enforce tenant and registry consistency across denormalized scope columns.
CREATE OR REPLACE FUNCTION validate_request_group_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workspaces w
    JOIN conversations c ON c.workspace_id = w.id
    WHERE w.id = NEW.workspace_id AND w.owner_id = NEW.user_id AND c.id = NEW.conversation_id
  ) THEN
    RAISE EXCEPTION 'request group scope does not match workspace owner and conversation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "request_groups_scope_check"
  BEFORE INSERT OR UPDATE OF user_id, workspace_id, conversation_id ON "request_groups"
  FOR EACH ROW EXECUTE FUNCTION validate_request_group_scope();

CREATE OR REPLACE FUNCTION validate_turn_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM request_groups rg
    WHERE rg.id = NEW.request_group_id AND rg.conversation_id = NEW.conversation_id
  ) THEN
    RAISE EXCEPTION 'turn and request group belong to different conversations' USING ERRCODE = '23514';
  END IF;

  IF NEW.parent_response_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM model_responses mr
    JOIN turns t ON t.id = mr.turn_id
    WHERE mr.id = NEW.parent_response_id
      AND t.conversation_id = NEW.conversation_id
      AND mr.selected_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'parent response must be a selected response in the same conversation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "turns_scope_check"
  BEFORE INSERT OR UPDATE OF conversation_id, request_group_id, parent_response_id ON "turns"
  FOR EACH ROW EXECUTE FUNCTION validate_turn_scope();

CREATE OR REPLACE FUNCTION validate_model_run_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM turns t
    WHERE t.id = NEW.turn_id AND t.request_group_id = NEW.request_group_id
  ) THEN
    RAISE EXCEPTION 'model run turn and request group do not match' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM provider_registry pr
    JOIN models m ON m.id = pr.model_id
    WHERE pr.id = NEW.registry_entry_id
      AND pr.provider_id = NEW.provider_id
      AND pr.model_id = NEW.model_id
      AND m.provider_id = NEW.provider_id
  ) THEN
    RAISE EXCEPTION 'model run registry, model, and provider do not match' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "model_runs_scope_check"
  BEFORE INSERT OR UPDATE OF turn_id, request_group_id, provider_id, model_id, registry_entry_id ON "model_runs"
  FOR EACH ROW EXECUTE FUNCTION validate_model_run_scope();

CREATE OR REPLACE FUNCTION validate_provider_registry_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM models m WHERE m.id = NEW.model_id AND m.provider_id = NEW.provider_id) THEN
    RAISE EXCEPTION 'registry model must belong to the registry provider' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "provider_registry_scope_check"
  BEFORE INSERT OR UPDATE OF provider_id, model_id ON "provider_registry"
  FOR EACH ROW EXECUTE FUNCTION validate_provider_registry_scope();

CREATE OR REPLACE FUNCTION validate_conversation_active_head()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active_head_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM model_responses mr
    JOIN turns t ON t.id = mr.turn_id
    WHERE mr.id = NEW.active_head_id
      AND mr.selected_at IS NOT NULL
      AND t.conversation_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'active head must be a selected response in the conversation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "conversations_active_head_scope_check"
  BEFORE INSERT OR UPDATE OF active_head_id ON "conversations"
  FOR EACH ROW EXECUTE FUNCTION validate_conversation_active_head();

CREATE OR REPLACE FUNCTION validate_workspace_scoped_reference()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  scoped_workspace_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'turn_files' THEN
    SELECT c.workspace_id INTO scoped_workspace_id
    FROM turns t JOIN conversations c ON c.id = t.conversation_id
    WHERE t.id = NEW.turn_id;
    IF NOT EXISTS (SELECT 1 FROM files f WHERE f.id = NEW.file_id AND f.workspace_id = scoped_workspace_id) THEN
      RAISE EXCEPTION 'turn file must belong to the turn workspace' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'memories' AND NEW.conversation_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id = NEW.conversation_id AND c.workspace_id = NEW.workspace_id) THEN
      RAISE EXCEPTION 'memory conversation must belong to the memory workspace' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'feedback' THEN
    IF NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id = NEW.conversation_id AND c.workspace_id = NEW.workspace_id) THEN
      RAISE EXCEPTION 'feedback conversation must belong to the feedback workspace' USING ERRCODE = '23514';
    END IF;
    IF NEW.turn_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM turns t WHERE t.id = NEW.turn_id AND t.conversation_id = NEW.conversation_id
    ) THEN
      RAISE EXCEPTION 'feedback turn must belong to the feedback conversation' USING ERRCODE = '23514';
    END IF;
    IF NEW.response_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM model_responses mr JOIN turns t ON t.id = mr.turn_id
      WHERE mr.id = NEW.response_id AND t.conversation_id = NEW.conversation_id
    ) THEN
      RAISE EXCEPTION 'feedback response must belong to the feedback conversation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "turn_files_workspace_check"
  BEFORE INSERT OR UPDATE ON "turn_files"
  FOR EACH ROW EXECUTE FUNCTION validate_workspace_scoped_reference();

CREATE TRIGGER "memories_workspace_check"
  BEFORE INSERT OR UPDATE OF workspace_id, conversation_id ON "memories"
  FOR EACH ROW EXECUTE FUNCTION validate_workspace_scoped_reference();

CREATE TRIGGER "feedback_workspace_check"
  BEFORE INSERT OR UPDATE OF workspace_id, conversation_id, turn_id, response_id ON "feedback"
  FOR EACH ROW EXECUTE FUNCTION validate_workspace_scoped_reference();

CREATE OR REPLACE FUNCTION validate_credit_transaction_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM credit_wallets cw WHERE cw.id = NEW.wallet_id AND cw.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'credit transaction wallet and user do not match' USING ERRCODE = '23514';
  END IF;
  IF NEW.reservation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM credit_reservations cr
    WHERE cr.id = NEW.reservation_id
      AND cr.wallet_id = NEW.wallet_id
      AND (NEW.request_group_id IS NULL OR cr.request_group_id = NEW.request_group_id)
      AND (NEW.model_run_id IS NULL OR cr.model_run_id = NEW.model_run_id)
  ) THEN
    RAISE EXCEPTION 'credit transaction reservation scope does not match' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "credit_transactions_scope_check"
  BEFORE INSERT ON "credit_transactions"
  FOR EACH ROW EXECUTE FUNCTION validate_credit_transaction_scope();

CREATE OR REPLACE FUNCTION validate_credit_reservation_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM credit_wallets cw
    JOIN request_groups rg ON rg.id = NEW.request_group_id AND rg.user_id = cw.user_id
    JOIN model_runs mr ON mr.id = NEW.model_run_id AND mr.request_group_id = rg.id
    WHERE cw.id = NEW.wallet_id
  ) THEN
    RAISE EXCEPTION 'credit reservation wallet, request group, and model run do not match' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "credit_reservations_scope_check"
  BEFORE INSERT OR UPDATE OF wallet_id, request_group_id, model_run_id ON "credit_reservations"
  FOR EACH ROW EXECUTE FUNCTION validate_credit_reservation_scope();

-- Session credentials are represented only by a one-way token hash.
CREATE TABLE "sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "session_token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "last_seen_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sessions_token_hash_check" CHECK (length(session_token_hash) >= 32),
  CONSTRAINT "sessions_expiry_check" CHECK (expires_at > created_at),
  CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "sessions_session_token_hash_key" ON "sessions"("session_token_hash");
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");
