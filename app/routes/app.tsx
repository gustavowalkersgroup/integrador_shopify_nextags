/// <reference types="@shopify/app-bridge-types" />
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { BASE_PATH } from "~/lib/base-path";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // basePath sai do loader, e nao de `comBase()` no corpo do componente: este
  // arquivo vai pro bundle do cliente, onde `process.env` nao existe (o build
  // nao faz shim). `s-link` e web component do Polaris, entao nao passa pelo
  // roteador e nao ganha o basename sozinho como <Link> ganha.
  return { apiKey: process.env.SHOPIFY_API_KEY || "", basePath: BASE_PATH };
};

export default function App() {
  const { apiKey, basePath } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href={`${basePath}/app`}>Home</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
