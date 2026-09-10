// Pagina publica (sem autenticacao) — e a URL de politica de privacidade
// exigida na submissao a App Store. Conteudo espelha docs/PRIVACY.md.

export default function Privacy() {
  return (
    <main
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "2rem 1.5rem",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        lineHeight: 1.6,
        color: "#1a1a1a",
      }}
    >
      <h1>Política de privacidade — NexTags para Shopify</h1>
      <p>
        Esta política descreve como o app <strong>NexTags</strong> (&quot;o
        app&quot;), desenvolvido pela NexTags, trata os dados ao ser
        instalado em uma loja Shopify.
      </p>

      <h2>1. Quem processa os dados</h2>
      <ul>
        <li>
          <strong>Controlador:</strong> o lojista que instala o app (é quem
          tem a relação com o cliente final e decide ativar as
          notificações).
        </li>
        <li>
          <strong>Operador/subprocessador:</strong> NexTags, que processa os
          dados exclusivamente para disparar as notificações configuradas
          pelo lojista, através da API NexTags (mensageria via WhatsApp).
        </li>
      </ul>

      <h2>2. Quais dados o app acessa</h2>
      <p>
        Ao ser instalado, o app lê da Shopify, apenas para os pedidos e
        carrinhos abandonados da loja:
      </p>
      <ul>
        <li>Nome do cliente</li>
        <li>Telefone do cliente</li>
        <li>
          Dados do pedido: número, valor total, itens, status, código e link
          de rastreio
        </li>
      </ul>
      <p>
        O app <strong>não</strong> acessa e-mail, endereço, dados de
        pagamento nem histórico de navegação do cliente.
      </p>

      <h2>3. Para que os dados são usados</h2>
      <p>
        Exclusivamente para montar e enviar as notificações transacionais
        que o lojista configurar na tela do app — por exemplo: pedido pago,
        pedido enviado, pronto para retirada, entregue, cancelado, ou
        lembrete de carrinho abandonado. Não usamos os dados para
        marketing, publicidade, perfilamento ou qualquer finalidade além de
        disparar a notificação pedida pelo lojista.
      </p>

      <h2>4. Onde os dados ficam armazenados</h2>
      <ul>
        <li>
          Configuração da loja e histórico de disparo (log de eventos):
          banco Postgres gerenciado, com criptografia em repouso provida
          pela infraestrutura de hospedagem.
        </li>
        <li>
          O token de acesso à conta NexTags do lojista é cifrado
          (AES-256-GCM) antes de ser gravado; nunca é armazenado nem
          logado em texto claro.
        </li>
        <li>
          Nome e telefone do cliente ficam registrados apenas como prova de
          que a notificação foi disparada (auditoria de entrega) — não
          formam um cadastro de clientes.
        </li>
      </ul>

      <h2>5. Por quanto tempo os dados ficam retidos</h2>
      <p>
        O histórico de disparo, que contém nome e telefone do cliente
        vinculados ao pedido, é retido por <strong>até 30 dias</strong> e
        apagado automaticamente depois disso por um processo agendado.
        Registros ainda aguardando reenvio são preservados até serem
        concluídos ou até 30 dias, o que ocorrer primeiro.
      </p>
      <p>
        Dados de configuração da loja (chave de conexão, mapeamento de
        eventos) são mantidos enquanto o app estiver instalado, e apagados
        quando o lojista desinstala o app.
      </p>

      <h2>6. Compartilhamento com terceiros</h2>
      <p>
        Os dados necessários para o disparo (nome, telefone, dados do
        pedido) são enviados à <strong>NexTags</strong> — subprocessador
        contratado pelo lojista para o serviço de notificação via WhatsApp
        — através de conexão segura (TLS). Não vendemos, alugamos nem
        compartilhamos dados com nenhuma outra empresa.
      </p>

      <h2>7. Direitos do titular dos dados</h2>
      <p>
        O cliente final de uma loja pode solicitar acesso, correção ou
        exclusão dos seus dados diretamente ao lojista (controlador dos
        dados). O app implementa os 3 webhooks obrigatórios de
        conformidade da Shopify:
      </p>
      <ul>
        <li>
          <strong>Solicitação de dados do cliente:</strong> o pedido é
          registrado; o app não mantém cadastro de cliente fora do
          histórico de disparo.
        </li>
        <li>
          <strong>Exclusão de dados do cliente:</strong> apaga os registros
          de disparo vinculados aos pedidos indicados.
        </li>
        <li>
          <strong>Exclusão de dados da loja:</strong> apaga toda a
          configuração e histórico da loja ao final do prazo exigido após
          a desinstalação.
        </li>
      </ul>

      <h2>8. Desinstalação</h2>
      <p>
        Ao desinstalar o app, o lojista para de receber notificações
        imediatamente; a configuração e o histórico da loja são apagados
        conforme o item anterior.
      </p>

      <h2>9. Contato</h2>
      <p>
        Dúvidas sobre esta política ou solicitações relacionadas a dados
        podem ser enviadas para:{" "}
        <a href="mailto:gustavo@nextags.com.br">gustavo@nextags.com.br</a>.
      </p>
    </main>
  );
}
