# OpenWCall

OpenWCall is a WebRTC voice-calling app with rooms, direct calls, and Discord/Skype-style social messaging features.

## New features

- Delivery states for DM + room chat (sending/sent/failed) with ACK and retry.
- Message edit (15 min), soft-delete, and emoji reactions.
- DM typing indicator and paginated chat history.
- Friend tabs (Online/All/Pending), friend remove quick action.
- Busy call handling + persistent call mini-bar.
- Notification center with DB persistence + read/unread state.
- Mention detection (`@nickname`) in room chat + mention notifications.
- Server-side rate limits for chat, typing, reactions.
- Input sanitization/escaping for safer rendering.

## Stack

- `apps/web`: Next.js App Router UI
- `apps/server`: Fastify + Socket.IO signaling/auth/social events
- `packages/shared`: shared socket event names + zod schemas
- `packages/db`: Prisma schema/client/migrations/seed

## Environment variables

### Server (`apps/server/.env.example`)

- `DATABASE_URL`: optional override DSN (not required for local SQLite dev).
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
pnpm dev
```

`pnpm dev` now auto-runs local DB setup (`prisma generate` + `prisma db push` + seed) and creates a SQLite file at `packages/db/prisma/dev.db` if it does not exist.

## Socket events

See:
- `packages/shared/src/events.ts`
- `packages/shared/src/schemas.ts`

## Test

```bash
pnpm -w test
```
