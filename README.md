# OpenWCall (Voxa)

OpenWCall is a WebRTC voice-calling app with rooms, direct calls, and now Discord/Skype-style social messaging features.

## New features

- Unique nicknames/handles (`3-24`, `a-z A-Z 0-9 _ . -`, case-insensitive uniqueness).
- User search by nickname.
- Friend requests and friend list.
- Persistent DM threads and message history.
- Room text chat history + real-time room messages.
- Message + call flow (start direct calls from social sidebar).
- In-app notifications for friend requests / DM messages.

## Stack

- `apps/web`: Next.js App Router UI
- `apps/server`: Fastify + Socket.IO signaling/auth/social events
- `packages/shared`: shared socket event names + zod schemas
- `packages/db`: Prisma schema/client/migrations/seed

## Environment variables

### Server (`apps/server/.env.example`)

- `DATABASE_URL`: PostgreSQL DSN.
- `JWT_SECRET`: JWT signing key.
- `PORT`: API/socket port (default `4000`).
- `WEB_ORIGIN`: allowed web origin.
- `TURN_URL`, `TURN_USER`, `TURN_PASS`: optional TURN credentials.

### Web (`apps/web/.env.example`)

- `NEXT_PUBLIC_SERVER_URL`: signaling/api server URL.
- `NEXT_PUBLIC_TURN_URL`, `NEXT_PUBLIC_TURN_USER`, `NEXT_PUBLIC_TURN_PASS`: optional TURN config.

## Local dev

```bash
pnpm install
pnpm --filter @openwcall/db prisma:generate
pnpm --filter @openwcall/db prisma:migrate
pnpm --filter @openwcall/db prisma:seed
pnpm dev
```

- web: `http://localhost:3000`
- server: `http://localhost:4000`

## Socket events

See:
- `packages/shared/src/events.ts`
- `packages/shared/src/schemas.ts`

All events are zod-validated on server and client payload contracts.

## Test

```bash
pnpm -w test
```
