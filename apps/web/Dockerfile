FROM node:20-slim
WORKDIR /app
COPY . .
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @openwcall/web build
CMD ["pnpm", "--filter", "@openwcall/web", "start"]
