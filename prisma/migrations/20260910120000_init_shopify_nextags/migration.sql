-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "shop_domain" TEXT NOT NULL,
    "scopes" TEXT,
    "api_version" TEXT NOT NULL,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" TIMESTAMP(3),

    CONSTRAINT "stores_pkey" PRIMARY KEY ("shop_domain")
);

-- CreateTable
CREATE TABLE "store_config" (
    "shop_domain" TEXT NOT NULL,
    "nextags_token_enc" TEXT,
    "agent_id" TEXT,
    "flow_map" JSONB NOT NULL DEFAULT '{}',
    "cuf_map" JSONB NOT NULL DEFAULT '{}',
    "dispatch_mode" TEXT NOT NULL DEFAULT 'n8n',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_config_pkey" PRIMARY KEY ("shop_domain")
);

-- CreateTable
CREATE TABLE "event_dedup" (
    "id" BIGSERIAL NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_dedup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_log" (
    "id" BIGSERIAL NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "event" TEXT,
    "shopify_id" TEXT,
    "payload_hash" TEXT,
    "dispatch_status" TEXT NOT NULL,
    "nextags_response" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "canonical" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flows_cache" (
    "id" BIGSERIAL NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "flow_name" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flows_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_log_dispatch_status_next_attempt_at_idx" ON "event_log"("dispatch_status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "event_log_shop_domain_created_at_idx" ON "event_log"("shop_domain", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_dedup_shop_domain_dedup_key_key" ON "event_dedup"("shop_domain", "dedup_key");

-- CreateIndex
CREATE UNIQUE INDEX "flows_cache_shop_domain_flow_id_key" ON "flows_cache"("shop_domain", "flow_id");

-- AddForeignKey
ALTER TABLE "store_config" ADD CONSTRAINT "store_config_shop_domain_fkey" FOREIGN KEY ("shop_domain") REFERENCES "stores"("shop_domain") ON DELETE CASCADE ON UPDATE CASCADE;
