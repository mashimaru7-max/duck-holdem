FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN pnpm install --frozen-lockfile
COPY shared shared
COPY server server
RUN pnpm --filter @duck-holdem/shared build && pnpm --filter @duck-holdem/server build

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/dist server/dist
EXPOSE 8787
CMD ["node", "server/dist/index.js"]
