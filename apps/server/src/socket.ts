import type { FastifyInstance } from "fastify";
import { Server, Socket } from "socket.io";
import { z } from "zod";
import { prisma } from "@openwcall/db";
import {
  ClientToServerEvents,
  ServerToClientEvents,
  authHelloSchema,
  DEFAULT_MAX_PARTICIPANTS,
  roomCreateSchema,
  roomHostKickSchema,
  roomHostLockSchema,
  roomHostMuteSchema,
  roomJoinSchema,
  roomLeaveSchema,
  webrtcAnswerSchema,
  webrtcIceSchema,
  webrtcOfferSchema,
  directInviteSchema,
  directAcceptSchema,
  directDeclineSchema,
  presenceSetSchema
} from "@openwcall/shared";
import { ServerState } from "./state";
import { verifyToken } from "./auth";
import bcrypt from "bcryptjs";

const rateLimitWindowMs = 10_000;
const rateLimitTokens = 40;

export function registerSocket(app: FastifyInstance, state: ServerState) {
  const io = new Server(app.server, {
    cors: {
      origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
      credentials: true
    }
  });

  io.on("connection", (socket) => {
    const bucket = createTokenBucket(rateLimitTokens, rateLimitWindowMs);

    socket.on(ClientToServerEvents.authHello, async (payload) => {
      try {
        authHelloSchema.parse(payload);
        const tokenData = verifyToken(payload.token, app);
        const user = await prisma.user.findUnique({ where: { id: tokenData.sub } });
        if (!user) {
          socket.emit(ServerToClientEvents.error, {
            code: "auth_failed",
            message: "Invalid token"
          });
          return;
        }

        const safeUser = {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl
        };

        state.usersBySocket.set(socket.id, {
          userId: safeUser.id,
          name: safeUser.name,
          avatarUrl: safeUser.avatarUrl,
          status: "online"
        });
        state.socketByUserId.set(user.id, socket.id);

        const rooms = await prisma.room.findMany();
        for (const room of rooms) {
          if (!state.rooms.has(room.id)) {
            state.rooms.set(room.id, {
              roomId: room.id,
              name: room.name,
              isPublic: room.isPublic,
              locked: room.locked,
              hostId: room.hostId,
              passwordHash: room.passwordHash,
              participants: new Map()
            });
          }
        }

        socket.emit(ServerToClientEvents.authOk, { user: safeUser });
        socket.emit(ServerToClientEvents.presenceList, { usersOnline: state.getPresenceList() });
        socket.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() });

        socket.broadcast.emit(ServerToClientEvents.presenceList, {
          usersOnline: state.getPresenceList()
        });
      } catch (error) {
        socket.emit(ServerToClientEvents.error, {
          code: "auth_failed",
          message: "Invalid token"
        });
      }
    });

    socket.on(ClientToServerEvents.presenceSet, (payload) => {
      if (!bucket.consume()) return;
      const parsed = presenceSetSchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;
      user.status = parsed.data.status;
      socket.broadcast.emit(ServerToClientEvents.presenceList, {
        usersOnline: state.getPresenceList()
      });
    });

    socket.on(ClientToServerEvents.roomCreate, async (payload) => {
      if (!bucket.consume()) return;
      const parsed = roomCreateSchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;

      const passwordHash = parsed.data.password ? await bcrypt.hash(parsed.data.password, 10) : null;
      const room = await prisma.room.create({
        data: {
          name: parsed.data.name,
          isPublic: parsed.data.isPublic,
          passwordHash,
          hostId: user.userId
        }
      });

      state.rooms.set(room.id, {
        roomId: room.id,
        name: room.name,
        isPublic: room.isPublic,
        locked: room.locked,
        hostId: room.hostId,
        passwordHash: room.passwordHash,
        participants: new Map()
      });

      io.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() });
    });

    socket.on(ClientToServerEvents.roomJoin, async (payload) => {
      if (!bucket.consume()) return;
      const parsed = roomJoinSchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;

      const room = await ensureRoomState(state, parsed.data.roomId);
      if (!room) {
        socket.emit(ServerToClientEvents.error, { code: "room_not_found", message: "Room not found" });
        return;
      }

      if (room.locked && room.hostId !== user.userId) {
        socket.emit(ServerToClientEvents.error, { code: "room_locked", message: "Room is locked" });
        return;
      }

      if (room.passwordHash && room.hostId !== user.userId) {
        const ok = parsed.data.password ? await bcrypt.compare(parsed.data.password, room.passwordHash) : false;
        if (!ok) {
          socket.emit(ServerToClientEvents.error, { code: "room_password", message: "Invalid room password" });
          return;
        }
      }

      if (room.participants.size >= DEFAULT_MAX_PARTICIPANTS) {
        socket.emit(ServerToClientEvents.error, {
          code: "room_full",
          message: "Room is at capacity"
        });
        return;
      }

      state.addParticipant(room.roomId, {
        userId: user.userId,
        name: user.name,
        avatarUrl: user.avatarUrl,
        muted: false
      });
      socket.join(room.roomId);

      socket.emit(ServerToClientEvents.roomJoined, {
        room: {
          roomId: room.roomId,
          name: room.name,
          isPublic: room.isPublic,
          locked: room.locked,
          hostId: room.hostId
        },
        participants: Array.from(room.participants.values())
      });

      socket.to(room.roomId).emit(ServerToClientEvents.roomParticipantJoined, {
        roomId: room.roomId,
        user: {
          userId: user.userId,
          name: user.name,
          avatarUrl: user.avatarUrl,
          muted: false
        }
      });

      io.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() });
      await prisma.roomMembershipHistory.create({
        data: {
          roomId: room.roomId,
          userId: user.userId
        }
      });
    });

    socket.on(ClientToServerEvents.roomLeave, async (payload) => {
      if (!bucket.consume()) return;
      const parsed = roomLeaveSchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;

      const room = state.rooms.get(parsed.data.roomId);
      if (!room) return;
      room.participants.delete(user.userId);
      socket.leave(room.roomId);
      socket.to(room.roomId).emit(ServerToClientEvents.roomParticipantLeft, {
        roomId: room.roomId,
        userId: user.userId
      });
      io.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() });
      await prisma.roomMembershipHistory.updateMany({
        where: {
          roomId: room.roomId,
          userId: user.userId,
          leftAt: null
        },
        data: { leftAt: new Date() }
      });
    });

    socket.on(ClientToServerEvents.callDirectInvite, (payload) => {
      if (!bucket.consume()) return;
      const parsed = directInviteSchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;
      const targetSocketId = state.socketByUserId.get(parsed.data.toUserId);
      if (!targetSocketId) {
        socket.emit(ServerToClientEvents.error, { code: "user_offline", message: "User offline" });
        return;
      }

      const callId = crypto.randomUUID();
      const directRoomId = `direct-${callId}`;
      state.directCalls.set(callId, {
        callId,
        fromUserId: user.userId,
        toUserId: parsed.data.toUserId,
        state: "ringing"
      });
      state.rooms.set(directRoomId, {
        roomId: directRoomId,
        name: "Direct Call",
        isPublic: false,
        locked: false,
        hostId: user.userId,
        participants: new Map()
      });

      socket.to(targetSocketId).emit(ServerToClientEvents.callDirectIncoming, {
        callId,
        fromUser: {
          userId: user.userId,
          name: user.name,
          avatarUrl: user.avatarUrl
        }
      });
      socket.emit(ServerToClientEvents.callDirectState, { callId, state: "ringing" });
    });

    socket.on(ClientToServerEvents.callDirectAccept, (payload) => {
      if (!bucket.consume()) return;
      const parsed = directAcceptSchema.safeParse(payload);
      if (!parsed.success) return;
      const call = state.directCalls.get(parsed.data.callId);
      if (!call) return;
      call.state = "connected";
      notifyCallState(io, call.callId, "connected");
    });

    socket.on(ClientToServerEvents.callDirectDecline, (payload) => {
      if (!bucket.consume()) return;
      const parsed = directDeclineSchema.safeParse(payload);
      if (!parsed.success) return;
      const call = state.directCalls.get(parsed.data.callId);
      if (!call) return;
      call.state = "ended";
      notifyCallState(io, call.callId, "ended", "declined");
      state.directCalls.delete(call.callId);
    });

    socket.on(ClientToServerEvents.webrtcOffer, (payload) => {
      if (!bucket.consume()) return;
      forwardSignal(state, socket, ServerToClientEvents.webrtcOffer, payload, webrtcOfferSchema);
    });

    socket.on(ClientToServerEvents.webrtcAnswer, (payload) => {
      if (!bucket.consume()) return;
      forwardSignal(state, socket, ServerToClientEvents.webrtcAnswer, payload, webrtcAnswerSchema);
    });

    socket.on(ClientToServerEvents.webrtcIce, (payload) => {
      if (!bucket.consume()) return;
      forwardSignal(state, socket, ServerToClientEvents.webrtcIce, payload, webrtcIceSchema);
    });

    socket.on(ClientToServerEvents.roomHostMute, (payload) => {
      if (!bucket.consume()) return;
      const parsed = roomHostMuteSchema.safeParse(payload);
      if (!parsed.success) return;
      const room = state.rooms.get(parsed.data.roomId);
      if (!room) return;
      if (room.hostId !== state.usersBySocket.get(socket.id)?.userId) return;
      const participant = room.participants.get(parsed.data.targetUserId);
      if (!participant) return;
      participant.muted = parsed.data.muted;
      io.to(room.roomId).emit(ServerToClientEvents.roomHostAction, {
        roomId: room.roomId,
        action: "mute",
        targetUserId: parsed.data.targetUserId
      });
    });

    socket.on(ClientToServerEvents.roomHostKick, (payload) => {
      if (!bucket.consume()) return;
      const parsed = roomHostKickSchema.safeParse(payload);
      if (!parsed.success) return;
      const room = state.rooms.get(parsed.data.roomId);
      if (!room) return;
      if (room.hostId !== state.usersBySocket.get(socket.id)?.userId) return;
      room.participants.delete(parsed.data.targetUserId);
      const targetSocketId = state.socketByUserId.get(parsed.data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit(ServerToClientEvents.roomHostAction, {
          roomId: room.roomId,
          action: "kick",
          targetUserId: parsed.data.targetUserId
        });
      }
      io.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() });
    });

    socket.on(ClientToServerEvents.roomHostLock, (payload) => {
      if (!bucket.consume()) return;
      const parsed = roomHostLockSchema.safeParse(payload);
      if (!parsed.success) return;
      const room = state.rooms.get(parsed.data.roomId);
      if (!room) return;
      if (room.hostId !== state.usersBySocket.get(socket.id)?.userId) return;
      room.locked = parsed.data.locked;
      io.to(room.roomId).emit(ServerToClientEvents.roomHostAction, {
        roomId: room.roomId,
        action: "lock"
      });
      io.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() });
    });

    socket.on("disconnect", () => {
      const user = state.usersBySocket.get(socket.id);
      if (user) {
        state.usersBySocket.delete(socket.id);
        state.socketByUserId.delete(user.userId);
        for (const room of state.rooms.values()) {
          if (room.participants.delete(user.userId)) {
            io.to(room.roomId).emit(ServerToClientEvents.roomParticipantLeft, {
              roomId: room.roomId,
              userId: user.userId
            });
          }
        }
        io.emit(ServerToClientEvents.presenceList, { usersOnline: state.getPresenceList() });
        io.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() });
      }
    });
  });

  return io;
}

async function ensureRoomState(state: ServerState, roomId: string) {
  const existing = state.rooms.get(roomId);
  if (existing) return existing;
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return null;
  const newRoom = {
    roomId: room.id,
    name: room.name,
    isPublic: room.isPublic,
    locked: room.locked,
    hostId: room.hostId,
    passwordHash: room.passwordHash,
    participants: new Map()
  };
  state.rooms.set(room.id, newRoom);
  return newRoom;
}

function forwardSignal(
  state: ServerState,
  socket: Socket,
  eventName: string,
  payload: unknown,
  schema: z.ZodSchema
) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return;
  const data = parsed.data as { peerId: string };
  const targetSocketId = state.socketByUserId.get(data.peerId);
  if (!targetSocketId) return;
  socket.to(targetSocketId).emit(eventName, parsed.data);
}

function notifyCallState(io: Server, callId: string, state: "ringing" | "connected" | "ended", reason?: string) {
  io.emit(ServerToClientEvents.callDirectState, {
    callId,
    state,
    reason
  });
}

function createTokenBucket(limit: number, windowMs: number) {
  let tokens = limit;
  let lastRefill = Date.now();

  return {
    consume() {
      const now = Date.now();
      if (now - lastRefill > windowMs) {
        tokens = limit;
        lastRefill = now;
      }
      if (tokens <= 0) {
        return false;
      }
      tokens -= 1;
      return true;
    }
  };
}
