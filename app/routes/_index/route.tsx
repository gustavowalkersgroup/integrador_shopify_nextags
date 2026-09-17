import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

// Unica pagina publica nao-embedded do app: e o que aparece pra quem abre o
// dominio direto, incluindo o reviewer da Shopify. O texto vem de
// docs/LISTING.md pra nao divergir da listagem da App Store.
export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>NexTags para Shopify</h1>
        <p className={styles.text}>
          Notifique seus clientes no WhatsApp a cada status do pedido — pago,
          enviado, entregue — direto da sua conta NexTags.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Domínio da loja</span>
              <input className={styles.input} type="text" name="shop" />
              <span>ex.: minha-loja.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Entrar
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Sem configuração manual</strong>. Conecte sua chave NexTags,
            escolha um flow por evento e pronto.
          </li>
          <li>
            <strong>Carrinho abandonado</strong>. Recupere vendas com uma
            mensagem automática para quem não finalizou a compra.
          </li>
          <li>
            <strong>Histórico de disparos</strong>. Toda notificação enviada
            fica registrada na tela de Status, com o resultado da API.
          </li>
        </ul>
        <p className={styles.text}>
          <a href="/privacy">Política de privacidade</a>
        </p>
      </div>
    </div>
  );
}
