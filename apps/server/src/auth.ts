import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { prisma } from "@openwcall/db";
import { normalizeNickname, validateNickname } from "./social";

const NICKNAME_TTL_DAYS = 30;

export interface SessionPayload {
  sub: string;
  nickname: string;
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.post("/auth/nickname", async (request, reply) => {
    const body = request.body as { nickname?: string };
    const nickname = body?.nickname?.trim();

    if (!nickname || !validateNickname(nickname)) {
      return reply.status(400).send({ message: "Invalid nickname" });
    }

    const nicknameLower = normalizeNickname(nickname);
    const now = new Date();
    const expiredBefore = new Date(now.getTime() - NICKNAME_TTL_DAYS * 24 * 60 * 60 * 1000);

    const existing = await prisma.user.findUnique({ where: { nicknameLower } });

    if (existing) {
      if (existing.lastSeenAt < expiredBefore) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { nickname: null, nicknameLower: null }
        });
      } else {
        const activeUser = await prisma.user.update({
          where: { id: existing.id },
          data: {
            name: nickname,
            nickname,
            nicknameLower,
            lastSeenAt: now,
            avatarUrl: `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(nickname)}`
          }
        });

        const sessionToken = await issueSession(app, activeUser.id, nickname);
        return reply.send({
          sessionToken,
          user: {
            id: activeUser.id,
            name: activeUser.name,
            nickname: activeUser.nickname,
            avatarUrl: activeUser.avatarUrl
          }
        });
      }
    }

    const email = `nick-${randomUUID()}@nickname.local`;
    const user = await prisma.user.create({
      data: {
        email,
        name: nickname,
        nickname,
        nicknameLower,
        passwordHash: "nickname-login",
        avatarUrl: `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(nickname)}`,
        lastSeenAt: now
      }
    });

    const sessionToken = await issueSession(app, user.id, nickname);
    return reply.send({
      sessionToken,
      user: {
        id: user.id,
        name: user.name,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl
      }
    });
  });
}

export async function issueSession(app: FastifyInstance, userId: string, nickname: string) {
  const sessionToken = await app.jwt.sign(
    {
      sub: userId,
      nickname
    },
    {
      expiresIn: "30d"
    }
  );

  return sessionToken;
}

export function verifyToken(token: string, app: FastifyInstance) {
  return app.jwt.verify<SessionPayload>(token);
}
