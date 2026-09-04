import { vi } from "vitest";

/**
 * O `init` que o codigo de producao realmente monta: `headers` e `body` sao
 * sempre strings, e `signal` vem do AbortController do timeout.
 *
 * Sem este tipo os testes caem em `any` para indexar `init.headers[...]`,
 * porque o `HeadersInit` nativo e uma union que nao aceita indexacao.
 */
export type FetchInit = {
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
};

/** Implementacao de fetch para stub. Pode ignorar os argumentos. */
export type FetchImpl = (url: string, init: FetchInit) => unknown;

/**
 * Troca o `fetch` global e devolve o mock tipado, de forma que
 * `fn.mock.calls[0]` seja `[string, FetchInit]` em vez de `unknown[]`
 * (o Vitest 5 nao infere isso sozinho a partir de um impl de zero args).
 *
 * Chame `vi.unstubAllGlobals()` no `afterEach`.
 */
export function stubFetch(impl: FetchImpl) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}
