import type { FastifyInstance } from "fastify";
import { Server, Socket } from "socket.io";
import { z } from "zod";
import { prisma } from "@openwcall/db";
import {
  ClientToServerEvents,
  ServerToClientEvents,
  authHelloSchema,
  DEFAULT_MAX_PARTICIPANTS,
  dmHistorySchema,
  dmSendSchema,
  dmThreadGetOrCreateSchema,
  directAcceptSchema,
  directDeclineSchema,
  directInviteSchema,
  friendsRequestRespondSchema,
  friendsRequestSendSchema,
  notificationsReadSchema,
  presenceSetSchema,
  roomChatHistorySchema,
  roomChatSendSchema,
  roomCreateSchema,
  roomHostKickSchema,
  roomHostLockSchema,
  roomHostMuteSchema,
  roomJoinSchema,
  roomLeaveSchema,
  userNicknameSetSchema,
  userSearchSchema,
  webrtcAnswerSchema,
  webrtcIceSchema,
  webrtcOfferSchema
} from "@openwcall/shared";
import { ServerState } from "./state";
import { verifyToken } from "./auth";
import { canSendRoomChat, isDmParticipant, normalizeNickname, orderPair, validateNickname } from "./social";
import bcrypt from "bcryptjs";

const rateLimitWindowMs = 10_000;
const rateLimitTokens = 80;

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
          socket.emit(ServerToClientEvents.error, { code: "auth_failed", message: "Invalid token" });
          return;
        }

        const safeUser = { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, nickname: user.nickname };
        state.usersBySocket.set(socket.id, {
          userId: safeUser.id,
          name: safeUser.nickname ?? safeUser.name,
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
        await emitFriendLists(socket, user.id);
        await emitDmThreadList(socket, user.id);
        socket.broadcast.emit(ServerToClientEvents.presenceList, { usersOnline: state.getPresenceList() });
      } catch {
        socket.emit(ServerToClientEvents.error, { code: "auth_failed", message: "Invalid token" });
      }
    });

    socket.on(ClientToServerEvents.userNicknameSet, async (payload) => {
      if (!bucket.consume()) return;
      const parsed = userNicknameSetSchema.safeParse(payload);
      if (!parsed.success || !validateNickname(parsed.data.nickname)) return;
      const current = state.usersBySocket.get(socket.id);
      if (!current) return;
      const nicknameLower = normalizeNickname(parsed.data.nickname);
      try {
        await prisma.user.update({ where: { id: current.userId }, data: { nickname: parsed.data.nickname, nicknameLower } });
        current.name = parsed.data.nickname;
        socket.emit(ServerToClientEvents.userNicknameOk, { nickname: parsed.data.nickname });
        io.emit(ServerToClientEvents.presenceList, { usersOnline: state.getPresenceList() });
      } catch {
        socket.emit(ServerToClientEvents.error, { code: "nickname_taken", message: "Nickname unavailable" });
      }
    });

    socket.on(ClientToServerEvents.userSearch, async (payload) => {
      if (!bucket.consume()) return;
      const parsed = userSearchSchema.safeParse(payload);
      if (!parsed.success) return;
      const query = normalizeNickname(parsed.data.query);
      const users = await prisma.user.findMany({
        where: { nicknameLower: { contains: query } },
        take: parsed.data.limit,
        select: { id: true, nickname: true, avatarUrl: true, status: true }
      });
      socket.emit(ServerToClientEvents.userSearchResult, {
        users: users.map((u) => ({ id: u.id, nickname: u.nickname ?? "unknown", avatarUrl: u.avatarUrl, status: (u.status === "away" ? "away" : "online") }))
      });
    });

    socket.on(ClientToServerEvents.friendsRequestSend, async (payload) => {
      const parsed = friendsRequestSendSchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;
      const to = await prisma.user.findUnique({ where: { nicknameLower: normalizeNickname(parsed.data.toNickname) } });
      if (!to || to.id === user.userId) return;
      const existing = await prisma.friendRequest.findFirst({ where: { fromUserId: user.userId, toUserId: to.id, status: "pending" } });
      if (!existing) {
        await prisma.friendRequest.create({ data: { fromUserId: user.userId, toUserId: to.id, status: "pending" } });
      }
      await emitFriendLists(socket, user.userId);
      const targetSocket = state.socketByUserId.get(to.id);
      if (targetSocket) {
        const target = io.sockets.sockets.get(targetSocket);
        if (target) {
          await emitFriendLists(target, to.id);
          target.emit(ServerToClientEvents.notificationNew, { notification: { id: crypto.randomUUID(), type: "friend_request", createdAt: new Date().toISOString() } });
        }
      }
    });

    socket.on(ClientToServerEvents.friendsRequestRespond, async (payload) => {
      const parsed = friendsRequestRespondSchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;
      const req = await prisma.friendRequest.findUnique({ where: { id: parsed.data.requestId } });
      if (!req || req.toUserId !== user.userId || req.status !== "pending") return;
      const status = parsed.data.action === "accept" ? "accepted" : "declined";
      await prisma.friendRequest.update({ where: { id: req.id }, data: { status, respondedAt: new Date() } });
      if (status === "accepted") {
        const [userAId, userBId] = orderPair(req.fromUserId, req.toUserId);
        await prisma.friendship.upsert({ where: { userAId_userBId: { userAId, userBId } }, update: {}, create: { userAId, userBId } });
      }
      await emitFriendLists(socket, user.userId);
      const fromSocketId = state.socketByUserId.get(req.fromUserId);
      if (fromSocketId) {
        const fromSocket = io.sockets.sockets.get(fromSocketId);
        if (fromSocket) await emitFriendLists(fromSocket, req.fromUserId);
      }
    });

    socket.on(ClientToServerEvents.friendsList, async () => {
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;
      await emitFriendLists(socket, user.userId);
    });

    socket.on(ClientToServerEvents.dmThreadGetOrCreate, async (payload) => {
      const parsed = dmThreadGetOrCreateSchema.safeParse(payload);
      if (!parsed.success) return;
      const current = state.usersBySocket.get(socket.id);
      if (!current) return;
      let otherId = parsed.data.withUserId;
      if (!otherId && parsed.data.withNickname) {
        const found = await prisma.user.findUnique({ where: { nicknameLower: normalizeNickname(parsed.data.withNickname) } });
        otherId = found?.id;
      }
      if (!otherId || otherId === current.userId) return;
      const [userAId, userBId] = orderPair(current.userId, otherId);
      const thread = await prisma.dMThread.upsert({ where: { userAId_userBId: { userAId, userBId } }, update: {}, create: { userAId, userBId } });
      socket.emit(ServerToClientEvents.dmThreadList, { threads: await listThreads(current.userId) });
      socket.emit(ServerToClientEvents.dmHistory, { threadId: thread.id, messages: [], nextCursor: null });
    });

    socket.on(ClientToServerEvents.dmThreadList, async () => {
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;
      await emitDmThreadList(socket, user.userId);
    });

    socket.on(ClientToServerEvents.dmHistory, async (payload) => {
      const parsed = dmHistorySchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;
      const thread = await prisma.dMThread.findUnique({ where: { id: parsed.data.threadId } });
      if (!thread || !isDmParticipant(thread, user.userId)) return;
      const messages = await prisma.message.findMany({
        where: { threadId: thread.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: parsed.data.limit,
        include: { sender: { select: { id: true, nickname: true, avatarUrl: true } } }
      });
      socket.emit(ServerToClientEvents.dmHistory, {
        threadId: thread.id,
        messages: messages.reverse().map(formatMessage),
        nextCursor: null
      });
    });

    socket.on(ClientToServerEvents.dmSend, async (payload) => {
      const parsed = dmSendSchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;
      const thread = await prisma.dMThread.findUnique({ where: { id: parsed.data.threadId } });
      if (!thread || !isDmParticipant(thread, user.userId)) return;
      const message = await prisma.message.create({
        data: { threadId: thread.id, senderId: user.userId, body: parsed.data.body.trim() },
        include: { sender: { select: { id: true, nickname: true, avatarUrl: true } } }
      });
      await prisma.dMThread.update({ where: { id: thread.id }, data: { lastMessageAt: message.createdAt } });
      const payloadOut = { threadId: thread.id, message: { ...formatMessage(message), clientMsgId: parsed.data.clientMsgId } };
      socket.emit(ServerToClientEvents.dmMessageNew, payloadOut);
      const peerId = thread.userAId === user.userId ? thread.userBId : thread.userAId;
      const peerSocketId = state.socketByUserId.get(peerId);
      if (peerSocketId) io.to(peerSocketId).emit(ServerToClientEvents.dmMessageNew, payloadOut);
      if (peerSocketId) io.to(peerSocketId).emit(ServerToClientEvents.notificationNew, { notification: { id: crypto.randomUUID(), type: "dm", threadId: thread.id, createdAt: new Date().toISOString() } });
    });

    socket.on(ClientToServerEvents.roomChatHistory, async (payload) => {
      const parsed = roomChatHistorySchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;
      const room = state.rooms.get(parsed.data.roomId);
      if (!room || !room.participants.has(user.userId)) return;
      const messages = await prisma.message.findMany({
        where: { roomId: parsed.data.roomId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: parsed.data.limit,
        include: { sender: { select: { id: true, nickname: true, avatarUrl: true } } }
      });
      socket.emit(ServerToClientEvents.roomChatHistory, { roomId: parsed.data.roomId, messages: messages.reverse().map(formatMessage), nextCursor: null });
    });

    socket.on(ClientToServerEvents.roomChatSend, async (payload) => {
      const parsed = roomChatSendSchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;
      const room = state.rooms.get(parsed.data.roomId);
      if (!room || !canSendRoomChat(new Set(room.participants.keys()), user.userId)) return;
      const message = await prisma.message.create({
        data: { roomId: room.roomId, senderId: user.userId, body: parsed.data.body.trim() },
        include: { sender: { select: { id: true, nickname: true, avatarUrl: true } } }
      });
      io.to(room.roomId).emit(ServerToClientEvents.roomChatMessage, { roomId: room.roomId, message: { ...formatMessage(message), clientMsgId: parsed.data.clientMsgId } });
    });

    socket.on(ClientToServerEvents.notificationsRead, (payload) => {
      notificationsReadSchema.safeParse(payload);
    });

    socket.on(ClientToServerEvents.presenceSet, (payload) => {
      if (!bucket.consume()) return;
      const parsed = presenceSetSchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;
      user.status = parsed.data.status;
      socket.broadcast.emit(ServerToClientEvents.presenceList, { usersOnline: state.getPresenceList() });
    });

    socket.on(ClientToServerEvents.roomCreate, async (payload) => {
      if (!bucket.consume()) return;
      const parsed = roomCreateSchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;

      const passwordHash = parsed.data.password ? await bcrypt.hash(parsed.data.password, 10) : null;
      const room = await prisma.room.create({
        data: { name: parsed.data.name, isPublic: parsed.data.isPublic, passwordHash, hostId: user.userId }
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
        socket.emit(ServerToClientEvents.error, { code: "room_full", message: "Room is at capacity" });
        return;
      }

      state.addParticipant(room.roomId, { userId: user.userId, name: user.name, avatarUrl: user.avatarUrl, muted: false });
      socket.join(room.roomId);
      socket.emit(ServerToClientEvents.roomJoined, { room: { roomId: room.roomId, name: room.name, isPublic: room.isPublic, locked: room.locked, hostId: room.hostId }, participants: Array.from(room.participants.values()) });
      socket.to(room.roomId).emit(ServerToClientEvents.roomParticipantJoined, { roomId: room.roomId, user: { userId: user.userId, name: user.name, avatarUrl: user.avatarUrl, muted: false } });
      io.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() });
      await prisma.roomMembershipHistory.create({ data: { roomId: room.roomId, userId: user.userId } });
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
      socket.to(room.roomId).emit(ServerToClientEvents.roomParticipantLeft, { roomId: room.roomId, userId: user.userId });
      io.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() });
      await prisma.roomMembershipHistory.updateMany({ where: { roomId: room.roomId, userId: user.userId, leftAt: null }, data: { leftAt: new Date() } });
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
      state.directCalls.set(callId, { callId, fromUserId: user.userId, toUserId: parsed.data.toUserId, state: "ringing" });
      state.rooms.set(directRoomId, { roomId: directRoomId, name: "Direct Call", isPublic: false, locked: false, hostId: user.userId, participants: new Map() });
      socket.to(targetSocketId).emit(ServerToClientEvents.callDirectIncoming, { callId, fromUser: { userId: user.userId, name: user.name, avatarUrl: user.avatarUrl } });
      socket.emit(ServerToClientEvents.callDirectState, { callId, state: "ringing" });
    });

    socket.on(ClientToServerEvents.callDirectAccept, (payload) => {
      if (!bucket.consume()) return;
      const parsed = directAcceptSchema.safeParse(payload);
      if (!parsed.success) return;
      const call = state.directCalls.get(parsed.data.callId);
      if (!call) return;
      const accepter = state.usersBySocket.get(socket.id);
      if (!accepter || call.toUserId !== accepter.userId || call.state !== "ringing") return;
      call.state = "connected";
      notifyCallState(io, state, call.callId, "connected");
    });

    socket.on(ClientToServerEvents.callDirectDecline, (payload) => {
      if (!bucket.consume()) return;
      const parsed = directDeclineSchema.safeParse(payload);
      if (!parsed.success) return;
      const call = state.directCalls.get(parsed.data.callId);
      if (!call) return;
      call.state = "ended";
      notifyCallState(io, state, call.callId, "ended", "declined");
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
      if (!room || room.hostId !== state.usersBySocket.get(socket.id)?.userId) return;
      const participant = room.participants.get(parsed.data.targetUserId);
      if (!participant) return;
      participant.muted = parsed.data.muted;
      io.to(room.roomId).emit(ServerToClientEvents.roomHostAction, { roomId: room.roomId, action: "mute", targetUserId: parsed.data.targetUserId });
    });

    socket.on(ClientToServerEvents.roomHostKick, (payload) => {
      if (!bucket.consume()) return;
      const parsed = roomHostKickSchema.safeParse(payload);
      if (!parsed.success) return;
      const room = state.rooms.get(parsed.data.roomId);
      if (!room || room.hostId !== state.usersBySocket.get(socket.id)?.userId) return;
      room.participants.delete(parsed.data.targetUserId);
      const targetSocketId = state.socketByUserId.get(parsed.data.targetUserId);
      if (targetSocketId) io.to(targetSocketId).emit(ServerToClientEvents.roomHostAction, { roomId: room.roomId, action: "kick", targetUserId: parsed.data.targetUserId });
      io.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() });
    });

    socket.on(ClientToServerEvents.roomHostLock, (payload) => {
      if (!bucket.consume()) return;
      const parsed = roomHostLockSchema.safeParse(payload);
      if (!parsed.success) return;
      const room = state.rooms.get(parsed.data.roomId);
      if (!room || room.hostId !== state.usersBySocket.get(socket.id)?.userId) return;
      room.locked = parsed.data.locked;
      io.to(room.roomId).emit(ServerToClientEvents.roomHostAction, { roomId: room.roomId, action: "lock" });
      io.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() });
    });

    socket.on("disconnect", () => {
      const user = state.usersBySocket.get(socket.id);
      if (user) {
        state.usersBySocket.delete(socket.id);
        state.socketByUserId.delete(user.userId);
        for (const room of state.rooms.values()) {
          if (room.participants.delete(user.userId)) {
            io.to(room.roomId).emit(ServerToClientEvents.roomParticipantLeft, { roomId: room.roomId, userId: user.userId });
          }
        }
        io.emit(ServerToClientEvents.presenceList, { usersOnline: state.getPresenceList() });
        io.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() });
      }
    });
  });

  return io;
}

async function emitFriendLists(socket: Socket, userId: string) {
  const requests = await prisma.friendRequest.findMany({
    where: { OR: [{ toUserId: userId }, { fromUserId: userId }] },
    include: {
      fromUser: { select: { id: true, nickname: true, avatarUrl: true, status: true } },
      toUser: { select: { id: true, nickname: true, avatarUrl: true, status: true } }
    }
  });
  const incoming = requests.filter((r) => r.toUserId === userId && r.status === "pending");
  const outgoing = requests.filter((r) => r.fromUserId === userId && r.status === "pending");
  socket.emit(ServerToClientEvents.friendsRequests, { incoming, outgoing });

  const friendships = await prisma.friendship.findMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] } });
  const friendIds = friendships.map((f) => (f.userAId === userId ? f.userBId : f.userAId));
  const friendsUsers = friendIds.length
    ? await prisma.user.findMany({ where: { id: { in: friendIds } }, select: { id: true, nickname: true, avatarUrl: true, status: true } })
    : [];
  const friends = friendsUsers.sort((a, b) => (a.status === b.status ? (a.nickname ?? "").localeCompare(b.nickname ?? "") : a.status === "online" ? -1 : 1));
  socket.emit(ServerToClientEvents.friendsList, {
    friends: friends.map((f) => ({ id: f.id, nickname: f.nickname ?? "unknown", avatarUrl: f.avatarUrl, status: f.status === "away" ? "away" : "online" }))
  });
}

function formatMessage(message: { id: string; body: string; createdAt: Date; sender: { id: string; nickname: string | null; avatarUrl: string | null } }) {
  return {
    id: message.id,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    sender: { id: message.sender.id, nickname: message.sender.nickname ?? "unknown", avatarUrl: message.sender.avatarUrl }
  };
}

async function listThreads(userId: string) {
  const threads = await prisma.dMThread.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } }
  });
  const peerIds = threads.map((t) => (t.userAId === userId ? t.userBId : t.userAId));
  const peers = await prisma.user.findMany({ where: { id: { in: peerIds } }, select: { id: true, nickname: true, avatarUrl: true, status: true } });
  const peerMap = new Map(peers.map((p) => [p.id, p]));
  return threads.map((t) => {
    const withUserId = t.userAId === userId ? t.userBId : t.userAId;
    const withUser = peerMap.get(withUserId);
    return {
      id: t.id,
      withUser: withUser ? { id: withUser.id, nickname: withUser.nickname ?? "unknown", avatarUrl: withUser.avatarUrl, status: withUser.status === "away" ? "away" : "online" } : { id: withUserId, nickname: "unknown", avatarUrl: null, status: "offline" },
      lastMessageAt: t.lastMessageAt?.toISOString() ?? t.createdAt.toISOString(),
      lastMessagePreview: t.messages[0]?.body?.slice(0, 80) ?? ""
    };
  });
}

async function emitDmThreadList(socket: Socket, userId: string) {
  socket.emit(ServerToClientEvents.dmThreadList, { threads: await listThreads(userId) });
}

async function ensureRoomState(state: ServerState, roomId: string) {
  const existing = state.rooms.get(roomId);
  if (existing) return existing;
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return null;
  const newRoom = { roomId: room.id, name: room.name, isPublic: room.isPublic, locked: room.locked, hostId: room.hostId, passwordHash: room.passwordHash, participants: new Map() };
  state.rooms.set(room.id, newRoom);
  return newRoom;
}

function forwardSignal(state: ServerState, socket: Socket, eventName: string, payload: unknown, schema: z.ZodSchema) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return;
  const data = parsed.data as { peerId: string };
  const targetSocketId = state.socketByUserId.get(data.peerId);
  if (!targetSocketId) return;
  socket.to(targetSocketId).emit(eventName, parsed.data);
}

function notifyCallState(io: Server, state: ServerState, callId: string, callState: "ringing" | "connected" | "ended", reason?: string) {
  const call = state.directCalls.get(callId);
  if (!call) return;
  const payload = { callId, state: callState, reason };
  const callerSocketId = state.socketByUserId.get(call.fromUserId);
  if (callerSocketId) io.to(callerSocketId).emit(ServerToClientEvents.callDirectState, payload);
  const calleeSocketId = state.socketByUserId.get(call.toUserId);
  if (calleeSocketId && calleeSocketId !== callerSocketId) io.to(calleeSocketId).emit(ServerToClientEvents.callDirectState, payload);
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
      if (tokens <= 0) return false;
      tokens -= 1;
      return true;
    }
  };
}
