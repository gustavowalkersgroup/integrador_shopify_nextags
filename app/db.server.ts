import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient;
}

// Cache também em produção: numa lambda da Vercel reaproveitada entre
// invocações (warm start), sem isso cada request abria um PrismaClient novo
// e nunca desconectava o anterior — as conexões com o Postgres se acumulam
// até estourar o limite do banco, e o request que estourar o limite quebra
// sem tratamento (virou "Application Error" na tela do app).
if (!global.prismaGlobal) {
  global.prismaGlobal = new PrismaClient();
}

const prisma = global.prismaGlobal;

export default prisma;
export { prisma };
