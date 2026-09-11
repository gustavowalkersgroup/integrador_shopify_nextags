-- AlterTable
ALTER TABLE "store_config"
  ADD COLUMN "n8n_webhook_url" TEXT,
  ADD COLUMN "n8n_webhook_secret_enc" TEXT;
