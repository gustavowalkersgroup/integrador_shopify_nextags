# Política de privacidade — NexTags para Shopify

**Última atualização:** _preencher na publicação_

Esta política descreve como o app **NexTags** ("o app"), desenvolvido pela
NexTags, trata os dados ao ser instalado em uma loja Shopify.

## 1. Quem processa os dados

- **Controlador:** o lojista que instala o app (é quem tem a relação com o
  cliente final e decide ativar as notificações).
- **Operador/subprocessador:** NexTags, que processa os dados exclusivamente
  para disparar as notificações configuradas pelo lojista, através da API
  NexTags (mensageria via WhatsApp).

## 2. Quais dados o app acessa

Ao ser instalado, o app lê da Shopify, apenas para os pedidos e carrinhos
abandonados da loja:

- Nome do cliente
- Telefone do cliente
- Dados do pedido: número, valor total, itens, status, código e link de
  rastreio

O app **não** acessa e-mail, endereço, dados de pagamento nem histórico de
navegação do cliente.

## 3. Para que os dados são usados

Exclusivamente para montar e enviar as notificações transacionais que o
lojista configurar na tela do app — por exemplo: pedido pago, pedido
enviado, pronto para retirada, entregue, cancelado, ou lembrete de carrinho
abandonado. Não usamos os dados para marketing, publicidade, perfilamento
ou qualquer finalidade além de disparar a notificação pedida pelo lojista.

## 4. Onde os dados ficam armazenados

- Configuração da loja e histórico de disparo (`event_log`): banco Postgres
  gerenciado (Prisma Postgres, hospedado na Vercel), com criptografia em
  repouso provida pela infraestrutura de hospedagem.
- O token de acesso à conta NexTags do lojista é cifrado (AES-256-GCM)
  antes de ser gravado; nunca é armazenado nem logado em texto claro.
- Nome e telefone do cliente ficam registrados no `event_log` **apenas
  como prova de que a notificação foi disparada** (auditoria de entrega) —
  não formam um cadastro de clientes.

## 5. Por quanto tempo os dados ficam retidos

O histórico de disparo (`event_log`), que contém nome e telefone do
cliente vinculados ao pedido, é retido por **até 30 dias** e apagado
automaticamente depois disso por um processo agendado. Registros ainda
aguardando reenvio (`retrying`) são preservados até serem concluídos ou
até 30 dias, o que ocorrer primeiro.

Dados de configuração da loja (chave de conexão, mapeamento de eventos)
são mantidos enquanto o app estiver instalado, e apagados quando o
lojista desinstala o app.

## 6. Compartilhamento com terceiros

Os dados necessários para o disparo (nome, telefone, dados do pedido) são
enviados à **NexTags** — subprocessador contratado pelo lojista para o
serviço de notificação via WhatsApp — através de conexão segura (TLS).
Não vendemos, alugamos nem compartilhamos dados com nenhuma outra empresa.

## 7. Direitos do titular dos dados

O cliente final de uma loja pode solicitar acesso, correção ou exclusão
dos seus dados diretamente ao lojista (controlador dos dados). O app
implementa os 3 webhooks obrigatórios de conformidade da Shopify:

- **Solicitação de dados do cliente** (`customers/data_request`): o
  pedido é registrado; o app não mantém cadastro de cliente fora do
  histórico de disparo.
- **Exclusão de dados do cliente** (`customers/redact`): apaga os
  registros de disparo vinculados aos pedidos indicados.
- **Exclusão de dados da loja** (`shop/redact`): apaga toda a
  configuração e histórico da loja ao final do prazo exigido após a
  desinstalação.

## 8. Desinstalação

Ao desinstalar o app, o lojista para de receber notificações
imediatamente; a configuração e o histórico da loja são apagados
conforme o item anterior.

## 9. Contato

Dúvidas sobre esta política ou solicitações relacionadas a dados podem
ser enviadas para: **_preencher e-mail de contato/suporte da NexTags_**.
