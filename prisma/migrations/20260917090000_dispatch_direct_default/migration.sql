-- Fecha a questao 3 do design spec ("URL do webhook n8n", que ficou aberta e
-- nunca foi definida antes do primeiro deploy): o modo padrao passa a ser
-- `direct`, que fala com POST /api/contacts da NexTags usando o token da
-- propria loja, sem depender de um n8n de pe 24/7 para todas as lojas da
-- App Store. O adapter `n8n` continua existindo e selecionavel por loja.
ALTER TABLE "store_config" ALTER COLUMN "dispatch_mode" SET DEFAULT 'direct';

-- Backfill do incidente de 2026-09-10: `process.env.DISPATCH_MODE_DEFAULT ??
-- "n8n"` gravou string vazia porque a env var existia vazia na Vercel (`??` so
-- cobre null/undefined). Toda loja instalada desde entao ficou com
-- dispatch_mode = '' e incapaz de disparar.
--
-- A normalizacao na leitura (app/lib/dispatch/index.server.ts) ja trata '' como
-- o padrao, entao este UPDATE nao e o que faz o app voltar a funcionar — ele
-- limpa o dado errado de vez, para que a coluna pare de mentir sobre o estado
-- da loja em qualquer consulta futura (relatorio, suporte, migracao).
UPDATE "store_config" SET "dispatch_mode" = 'direct' WHERE btrim("dispatch_mode") = '';
