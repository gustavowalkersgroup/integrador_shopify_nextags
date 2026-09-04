import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

// O template da Shopify tem como alvo um host Node (react-router-serve +
// Dockerfile). Sem este preset a Vercel gera um servidor Node em vez de
// funcoes serverless.
export default {
  ssr: true,
  presets: [vercelPreset()],
} satisfies Config;
