// Valores de teste, nao secrets. A chave abaixo existe so pra o AES-256-GCM
// ter 32 bytes validos nos testes unitarios.
process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.N8N_WEBHOOK_URL ||= "https://n8n.test/webhook/shopify";
process.env.N8N_WEBHOOK_SECRET ||= "test-secret";
process.env.CRON_SECRET ||= "test-cron-secret";
process.env.NEXTAGS_API_BASE ||= "https://api.nextags.test";
process.env.NEXTAGS_FLOWS_PATH ||= "/api/flows";
