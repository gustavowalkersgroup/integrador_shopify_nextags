# Instruções para o reviewer da Shopify — App NexTags

## Sobre o app

O NexTags dispara notificações transacionais via WhatsApp (pedido pago,
enviado, pronto para retirada, entregue, cancelado, carrinho abandonado)
usando a conta NexTags do próprio lojista. O app é gratuito — não usa a
Billing API — mas **exige uma conta NexTags** (serviço externo de
mensageria) para funcionar; sem uma chave de API válida, o app não envia
nada.

## Credenciais de teste

- **Loja de teste:** _preencher domínio da dev store_
- **Conta NexTags para review:** conta **NexTags Ajuda**
  - Chave de API: **não documentar aqui** — o repositório é público. Colar
    a chave real direto no campo privado "Instructions for review" do
    formulário de submissão no Partner Dashboard, no momento de submeter.
  - Flows mapeados para o teste: _preencher `flow_id` de cada evento usado no review_

> A conta NexTags Ajuda é uma conta de demonstração, sem custo pro
> reviewer. Ela não pertence a nenhum lojista real.

## Passo a passo para o reviewer

1. Instalar o app na loja de teste indicada acima.
2. Na tela do app, bloco **Conexão NexTags**: colar a chave de API de teste
   informada acima e salvar. O app valida a chave chamando a API NexTags —
   se a chave estiver errada, o erro aparece na hora.
3. Bloco **Notificações por evento**: mapear ao menos o evento "Pedido
   pago" pra um flow de teste (a lista é preenchida automaticamente a
   partir da conta NexTags conectada).
4. Bloco **Teste de disparo**: escolher o evento "Pedido pago", informar
   um número de WhatsApp de teste e disparar. A tela mostra o resultado
   HTTP retornado pela NexTags.
5. Para validar o fluxo real: criar um pedido de teste na loja e marcá-lo
   como pago — o webhook `orders/paid` deve gerar uma entrada na tela de
   **Status**, com o resultado do disparo.
6. Desinstalar o app e confirmar que ele para de operar (sem necessidade
   de nenhuma ação adicional do lojista).

## Sobre o uso de Protected Customer Data

O app solicita acesso a **nome** e **telefone** do cliente, usados
exclusivamente para montar a mensagem enviada via WhatsApp através da
NexTags. Nenhum outro campo protegido é lido. Detalhes de uso, retenção
(30 dias) e compartilhamento estão em `docs/PRIVACY.md` (política de
privacidade pública: `https://integrador-shopify-nextags.vercel.app/privacy`).

## Escopos solicitados e por quê

| Escopo | Uso |
|---|---|
| `read_orders` | ler pedido pago/cancelado/atualizado pra disparar a notificação |
| `read_fulfillments` | ler status e rastreio de envio/entrega |
| `read_checkouts` | ler carrinhos abandonados (cron de lembrete) |
| `read_products` | compor a descrição dos itens na mensagem |
| `read_inventory` | reservado para uso futuro de catálogo (não consumido em v1) |
| `read_customers` | ler nome e telefone do cliente pra endereçar a mensagem |

Nenhum escopo de escrita é solicitado — o app só lê dados da loja, nunca
os modifica.

## Contato de suporte

gustavo@nextags.com.br
