import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma } from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  // Duas apps Shopify distintas rodam esse mesmo codigo em deploys
  // separados: "Nextags_custom" (Custom App, loja de teste, sem gate de
  // Protected Customer Data) e "nextagsai" (App Store, precisa de
  // AppDistribution.AppStore pra submeter a listagem — Task 18). Cada
  // deploy na Vercel seta SHOPIFY_APP_DISTRIBUTION conforme qual app ele
  // serve; default fica em single_merchant pra nao mudar o deploy custom
  // existente.
  distribution:
    process.env.SHOPIFY_APP_DISTRIBUTION === "app_store"
      ? AppDistribution.AppStore
      : AppDistribution.SingleMerchant,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
  hooks: {
    afterAuth: async ({ session }) => {
      await prisma.store.upsert({
        where: { shopDomain: session.shop },
        create: {
          shopDomain: session.shop,
          apiVersion: ApiVersion.July26,
          scopes: session.scope ?? null,
          uninstalledAt: null,
          config: { create: { dispatchMode: process.env.DISPATCH_MODE_DEFAULT ?? "n8n" } },
        },
        update: {
          apiVersion: ApiVersion.July26,
          scopes: session.scope ?? null,
          uninstalledAt: null,
        },
      });
    },
  },
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
