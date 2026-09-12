/**
 * Nomes dos campos personalizados (CUFs) que o app cria e preenche na conta
 * NexTags do lojista.
 *
 * Vive fora de `*.server.ts` de proposito: e dado puro, sem nada de servidor,
 * e a tela (`app/routes/app._index.tsx`) lista esses nomes no proprio
 * componente. Importar um valor de um modulo `.server` a partir do corpo do
 * componente faz o React Router abortar o build com "Server-only module
 * referenced by client" — ele so remove server-code de `loader`, `action`,
 * `middleware` e `headers`.
 */
export const CUF_DEFAULT: Record<string, string> = {
  numero: "NumeroPedidoSHP",
  status: "StatusPedidoSHP",
  total: "TotalPedidoSHP",
  rastreio: "RastreioPedidoSHP",
  rastreio_url: "RastreioUrlSHP",
  itens: "ItensPedidoSHP",
};
