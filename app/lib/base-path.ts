/**
 * Prefixo de path sob o qual o app inteiro roda.
 *
 * Vazio ("") no deploy da Vercel, onde o app ocupa a raiz do dominio. Na VPS
 * ele divide `integrador.nextags.com.br` com outra aplicacao que ja serve a
 * raiz, entao o app vive sob `/notificacoes` e o nginx da VPS repassa o path
 * COMPLETO (sem barra final no proxy_pass) — a lib da Shopify depende disso:
 * `redirect-to-bounce-page` monta a URL de volta com `config.appUrl +
 * url.pathname`, e `config.appUrl` guarda so a origem, porque
 * `shopify-app.js` faz `appConfig.appUrl = appUrl.origin` e descarta o path.
 * Se o nginx tirasse o prefixo, essa volta cairia na raiz, na outra aplicacao.
 *
 * NAO pode conter "shopify": a Shopify recusa URLs de listagem com essa
 * palavra, inclusive no path (testado no campo Privacy policy URL).
 *
 * Precisa existir em build time (o basename entra no bundle pelo
 * react-router.config.ts) e em runtime (authPathPrefix, redirects).
 */
const bruto = (process.env.APP_BASE_PATH ?? "").trim();

// Normaliza para "" ou "/algo" (sem barra final): e o formato que o basename do
// React Router e a concatenacao do authPathPrefix esperam.
export const BASE_PATH = bruto === "" || bruto === "/"
  ? ""
  : `/${bruto.replace(/^\/+|\/+$/g, "")}`;

/** Prefixa um path interno. `caminho` deve comecar com "/". */
export function comBase(caminho: string): string {
  return `${BASE_PATH}${caminho}`;
}
