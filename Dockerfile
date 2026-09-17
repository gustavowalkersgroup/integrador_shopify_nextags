# syntax=docker/dockerfile:1

# Multi-stage: o build precisa das devDependencies (vite, typescript,
# @react-router/dev), a imagem final nao. O Dockerfile anterior rodava
# `npm ci --omit=dev` e logo depois `npm run build` — o build nunca teria
# funcionado, faltavam as ferramentas.

FROM node:22-alpine AS base
# openssl: o engine do Prisma linka contra ele no Alpine.
RUN apk add --no-cache openssl
WORKDIR /app

# --- build -------------------------------------------------------------------
FROM base AS build
# NODE_ENV=development de proposito: com `production` o npm pula as
# devDependencies mesmo sem `--omit=dev`.
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
# Sem VERCEL no ambiente, react-router.config.ts nao aplica o vercelPreset e
# a saida e o servidor Node em build/server/index.js — o que `npm start` roda.
RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
# Explicito: sem isso o serve escolhe o IP da primeira interface pra logar e
# o endereco anunciado no boot nao bate com o que o proxy alcanca.
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# `prisma generate` de novo aqui, contra o node_modules do runtime: copiar o
# client gerado do stage de build amarraria a imagem a um layout interno do
# Prisma que muda entre versoes. O CLI do Prisma esta em `dependencies`
# (nao devDependencies), entao sobrevive ao --omit=dev.
COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/build ./build
COPY --from=build /app/public ./public

# Nao rodar como root.
RUN chown -R node:node /app
USER node

EXPOSE 3000

# Bate no /healthz, que toca o Postgres: um processo vivo sem banco nao
# consegue gravar event_log e perderia pedido em silencio.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "docker-start"]
