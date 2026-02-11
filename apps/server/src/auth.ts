import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { prisma } from "@openwcall/db";
import { normalizeNickname } from "./social";

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
}

const ACCESS_EXPIRES_IN = "15m";
const REFRESH_EXPIRES_IN_DAYS = 30;

export function registerAuthRoutes(app: FastifyInstance) {
  app.post(
    "/auth/register",
    async (request, reply) => {
      const body = request.body as { email: string; name: string; password: string };
      const email = body?.email?.trim().toLowerCase();
      const name = body?.name?.trim();
      const password = body?.password;

      if (!email || !name || !password) {
        return reply.status(400).send({ message: "Invalid payload" });
      }

      if (password.length < 6) {
        return reply.status(400).send({ message: "Password must be at least 6 characters" });
      }

      const nicknameLower = normalizeNickname(name);

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return reply.status(409).send({ message: "Email already registered" });
      }

      const nicknameOwner = await prisma.user.findUnique({ where: { nicknameLower } });
      const nickname = nicknameOwner ? null : name;

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: {
          email,
          name,
          passwordHash,
          nickname,
          nicknameLower: nickname ? nicknameLower : null,
          avatarUrl: `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(name)}`
        }
      });

      const tokens = await issueTokens(app, user.id, user.email, user.name);
      return reply.send(tokens);
    }
  );

  app.post(
    "/auth/login",
    async (request, reply) => {
      const body = request.body as { email: string; password: string };
      const email = body?.email?.trim().toLowerCase();
      const password = body?.password;

      if (!email || !password) {
        return reply.status(400).send({ message: "Invalid payload" });
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return reply.status(401).send({ message: "Invalid credentials" });
      }

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        return reply.status(401).send({ message: "Invalid credentials" });
      }

      const tokens = await issueTokens(app, user.id, user.email, user.name);
      return reply.send(tokens);
    }
  );

  app.post(
    "/auth/refresh",
    async (request, reply) => {
      const body = request.body as { refreshToken: string };
      if (!body?.refreshToken) {
        return reply.status(400).send({ message: "Missing refresh token" });
      }

      const stored = await findRefreshToken(body.refreshToken);

      if (!stored || stored.revokedAt) {
        return reply.status(401).send({ message: "Invalid refresh token" });
      }

      const user = await prisma.user.findUnique({ where: { id: stored.userId } });
      if (!user) {
        return reply.status(401).send({ message: "Invalid refresh token" });
      }

      const tokens = await issueTokens(app, user.id, user.email, user.name);
      return reply.send(tokens);
    }
  );

  app.post(
    "/auth/logout",
    async (request, reply) => {
      const body = request.body as { refreshToken: string };
      if (!body?.refreshToken) {
        return reply.status(400).send({ message: "Missing refresh token" });
      }

      const stored = await findRefreshToken(body.refreshToken);
      if (stored) {
        await prisma.refreshToken.update({
          where: { id: stored.id },
          data: { revokedAt: new Date() }
        });
      }

      return reply.send({ ok: true });
    }
  );
}

export async function issueTokens(app: FastifyInstance, userId: string, email: string, name: string) {
  const accessToken = await app.jwt.sign(
    {
      sub: userId,
      email,
      name
    },
    {
      expiresIn: ACCESS_EXPIRES_IN
    }
  );

  const refreshToken = cryptoRandomString(48);
  const tokenHash = await bcrypt.hash(refreshToken, 10);
  await prisma.refreshToken.create({
    data: {
      tokenHash,
      userId
    }
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_EXPIRES_IN,
    refreshExpiresInDays: REFRESH_EXPIRES_IN_DAYS,
    user: {
      id: userId,
      email,
      name
    }
  };
}

export function verifyToken(token: string, app: FastifyInstance) {
  return app.jwt.verify<JwtPayload>(token);
}

function cryptoRandomString(length: number) {
  return randomBytes(length).toString("base64url");
}

async function findRefreshToken(refreshToken: string) {
  const tokens = await prisma.refreshToken.findMany({
    where: { revokedAt: null }
  });
  for (const token of tokens) {
    const match = await bcrypt.compare(refreshToken, token.tokenHash);
    if (match) {
      return token;
    }
  }
  return null;
}
