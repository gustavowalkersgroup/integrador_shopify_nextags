import { Prisma } from "@prisma/client";
import { prisma } from "~/db.server";

export const dedupKeyWebhook = (webhookId: string) => `wh:${webhookId}`;
export const dedupKeyOrderStatus = (orderId: string, event: string) =>
  `order:${orderId}:${event}`;
export const dedupKeyCart = (checkoutId: string) => `cart:${checkoutId}`;

export async function claimEvent(shop: string, key: string): Promise<boolean> {
  try {
    await prisma.eventDedup.create({ data: { shopDomain: shop, dedupKey: key } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}
