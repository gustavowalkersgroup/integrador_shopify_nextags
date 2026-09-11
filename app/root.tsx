import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

function Document({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link rel="stylesheet" href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// Ultimo recurso: app.tsx re-lanca qualquer erro que nao seja o redirect de
// reauth (401), entao sem isto aqui um erro inesperado (ex.: Postgres fora
// do ar) vira o "Application Error" generico do React Router, sem contexto
// nenhum pro lojista nem log visivel em produção.
export function ErrorBoundary({ error }: { error: unknown }) {
  console.error(error);
  return (
    <Document>
      <div style={{ padding: 24, fontFamily: "sans-serif" }}>
        <h1>Algo deu errado</h1>
        <p>
          Tenta recarregar a página. Se continuar, entra em contato:{" "}
          <a href="mailto:gustavo@nextags.com.br">gustavo@nextags.com.br</a>.
        </p>
      </div>
    </Document>
  );
}

export default function App() {
  return (
    <Document>
      <Outlet />
    </Document>
  );
}
