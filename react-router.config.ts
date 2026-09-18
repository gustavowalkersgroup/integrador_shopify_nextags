import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

// O preset da Vercel troca a saida do build: em vez do servidor Node padrao
// em `build/server/index.js` (que e o que `react-router-serve` e o Dockerfile
// esperam), ele emite funcoes serverless em `build/server/nodejs_<hash>/`.
//
// Por isso ele so pode entrar quando o build ROLA na Vercel. `VERCEL` e uma
// System Environment Variable que a Vercel injeta em todo build e runtime
// dela; em VPS, Docker ou local ela nao existe e o build volta ao servidor
// Node. Sem esta condicional, `npm start` na VPS aponta pra um arquivo que
// nao foi gerado e o container sobe quebrado.
const naVercel = Boolean(process.env.VERCEL);

// Prefixo de path (VPS sob subpath). Precisa ser lido AQUI, em build time: o
// basename entra no bundle do cliente, nao da pra resolver em runtime. Mesma
// normalizacao de app/lib/base-path.ts — este arquivo e config do bundler e
// nao pode importar codigo da app.
const bruto = (process.env.APP_BASE_PATH ?? "").trim();
const basePath =
  bruto === "" || bruto === "/" ? "" : `/${bruto.replace(/^\/+|\/+$/g, "")}`;

export default {
  ssr: true,
  presets: naVercel ? [vercelPreset()] : [],
  // "/" e o default do React Router; "" faria ele tratar como sem basename.
  basename: basePath || "/",
} satisfies Config;
