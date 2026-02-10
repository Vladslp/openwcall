# OpenWCall

OpenWCall is a production-ready WebRTC voice calling platform with rooms, direct calls, presence, and moderation. It uses a lightweight mesh topology (up to 6 participants by default) and a Socket.IO signaling server.

## Requirements

- Node.js 20+
- pnpm 9+
- Docker (optional, for local dev stack)
- PostgreSQL 15+

## Repository structure

```
/apps/web     # Next.js web app
/apps/server  # Fastify + Socket.IO signaling + auth
/packages/shared # Shared types + zod schemas
/packages/db  # Prisma schema + client
```

## Environment variables

### Server (`apps/server/.env.example`)

- `DATABASE_URL`: PostgreSQL connection string.
- `JWT_SECRET`: Secret used to sign access tokens.
- `PORT`: Server port (default 4000).
- `WEB_ORIGIN`: Allowed web origin for CORS.
- `TURN_URL`, `TURN_USER`, `TURN_PASS`: Optional TURN config.

### Web (`apps/web/.env.example`)

- `NEXT_PUBLIC_SERVER_URL`: Server URL (default http://localhost:4000).
- `NEXT_PUBLIC_TURN_URL`, `NEXT_PUBLIC_TURN_USER`, `NEXT_PUBLIC_TURN_PASS`: Optional TURN config.

## Local development

```bash
pnpm install
pnpm --filter @openwcall/db prisma:generate
pnpm --filter @openwcall/db prisma:migrate
pnpm --filter @openwcall/db prisma:seed
pnpm dev
```

- Web: http://localhost:3000
- Server: http://localhost:4000

### Docker compose

```bash
docker compose up --build
```

## Signaling protocol

All events are validated with zod on both client and server. Event names live in `packages/shared/src/events.ts` and schemas in `packages/shared/src/schemas.ts`.

Client → Server:
- `auth:hello`
- `presence:set`
- `room:create`
- `room:join`
- `room:leave`
- `call:direct:invite`
- `call:direct:accept`
- `call:direct:decline`
- `webrtc:offer`
- `webrtc:answer`
- `webrtc:ice`
- `room:host:mute`
- `room:host:kick`
- `room:host:lock`

Server → Client:
- `auth:ok`
- `presence:list`
- `room:list`
- `room:joined`
- `room:participant:joined`
- `room:participant:left`
- `call:direct:incoming`
- `call:direct:state`
- `webrtc:signal:error`
- `room:host:action`
- `error`

## Security notes

- WebRTC requires HTTPS in production (except localhost).
- All Socket.IO events are validated with zod.
- Basic in-memory rate limiting is applied per socket.
- Only authenticated users can join rooms.

## TURN guidance

By default, the app uses the public Google STUN server. For production reliability behind NATs, configure a TURN server (e.g., coturn) and set the TURN env vars.

## Tests

```bash
pnpm --filter @openwcall/shared test
pnpm --filter @openwcall/server test
```
