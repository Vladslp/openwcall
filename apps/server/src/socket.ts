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
  dmTypingSchema,
  directAcceptSchema,
  directDeclineSchema,
  directInviteSchema,
  friendsRemoveSchema,
  friendsRequestRespondSchema,
  friendsRequestSendSchema,
  msgDeleteSchema,
  msgEditSchema,
  msgReactSchema,
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
import {
  canDeleteMessage,
  canEditMessage,
  canSendRoomChat,
  detectMentions,
  escapeHtml,
  isDmParticipant,
  normalizeNickname,
  orderPair,
  sanitizeMessageInput,
  validateNickname
} from "./social";
import bcrypt from "bcryptjs";

const rateLimitWindowMs = 10_000;
const rateLimitTokens = 80;

export function registerSocket(app: FastifyInstance, state: ServerState) {
  const io = new Server(app.server, {
    cors: { origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: true }
  });

  io.on("connection", (socket) => {
    const bucket = createTokenBucket(rateLimitTokens, rateLimitWindowMs);
    const typingLimiter = createTokenBucket(1, 2_000);
    const reactLimiter = createTokenBucket(10, 5_000);
    const sendLimiter = createTokenBucket(5, 3_000);

    socket.on(ClientToServerEvents.authHello, async (payload) => {
      try {
        authHelloSchema.parse(payload);
        const tokenData = verifyToken(payload.token, app);
        const user = await prisma.user.findUnique({ where: { id: tokenData.sub } });
        if (!user) return socket.emit(ServerToClientEvents.error, { code: "auth_failed", message: "Invalid token" });

        state.usersBySocket.set(socket.id, { userId: user.id, name: user.nickname ?? user.name, avatarUrl: user.avatarUrl, status: "online" });
        state.socketByUserId.set(user.id, socket.id);

        const rooms = await prisma.room.findMany();
        for (const room of rooms) {
          if (!state.rooms.has(room.id)) state.rooms.set(room.id, { roomId: room.id, name: room.name, isPublic: room.isPublic, locked: room.locked, hostId: room.hostId, passwordHash: room.passwordHash, participants: new Map() });
        }

        socket.emit(ServerToClientEvents.authOk, { user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, nickname: user.nickname } });
        socket.emit(ServerToClientEvents.presenceList, { usersOnline: state.getPresenceList() });
        socket.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() });
        await emitFriendLists(socket, user.id);
        await emitDmThreadList(socket, user.id);
        await emitNotificationList(socket, user.id);
      } catch {
        socket.emit(ServerToClientEvents.error, { code: "auth_failed", message: "Invalid token" });
      }
    });

    socket.on(ClientToServerEvents.userSearch, async (payload) => {
      if (!bucket.consume()) return;
      const parsed = userSearchSchema.safeParse(payload);
      if (!parsed.success) return;
      const current = state.usersBySocket.get(socket.id);
      if (!current) return;
      const users = await prisma.user.findMany({ where: { nicknameLower: { contains: normalizeNickname(parsed.data.query) } }, take: parsed.data.limit, select: { id: true, nickname: true, avatarUrl: true, status: true } });
      socket.emit(ServerToClientEvents.userSearchResult, { users: users.map((u) => ({ id: u.id, nickname: u.nickname ?? "unknown", avatarUrl: u.avatarUrl, status: u.status === "away" ? "away" : "online" })) });
    });

    socket.on(ClientToServerEvents.userNicknameSet, async (payload) => {
      const parsed = userNicknameSetSchema.safeParse(payload);
      if (!parsed.success || !validateNickname(parsed.data.nickname)) return;
      const current = state.usersBySocket.get(socket.id);
      if (!current) return;
      try {
        await prisma.user.update({ where: { id: current.userId }, data: { nickname: parsed.data.nickname, nicknameLower: normalizeNickname(parsed.data.nickname) } });
        current.name = parsed.data.nickname;
        socket.emit(ServerToClientEvents.userNicknameOk, { nickname: parsed.data.nickname });
      } catch {
        socket.emit(ServerToClientEvents.error, { code: "nickname_taken", message: "Nickname unavailable" });
      }
    });

    socket.on(ClientToServerEvents.friendsRequestSend, async (payload) => {
      const parsed = friendsRequestSendSchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;
      const to = await prisma.user.findUnique({ where: { nicknameLower: normalizeNickname(parsed.data.toNickname) } });
      if (!to || to.id === user.userId) return;
      const blocked = await prisma.block.findFirst({ where: { OR: [{ blockerId: to.id, blockedId: user.userId }, { blockerId: user.userId, blockedId: to.id }] } });
      if (blocked) return socket.emit(ServerToClientEvents.error, { code: "blocked", message: "Action blocked" });
      const existing = await prisma.friendRequest.findFirst({ where: { fromUserId: user.userId, toUserId: to.id, status: "pending" } });
      if (!existing) await prisma.friendRequest.create({ data: { fromUserId: user.userId, toUserId: to.id, status: "pending" } });
      await emitFriendLists(socket, user.userId);
      const targetSocket = state.socketByUserId.get(to.id);
      if (targetSocket) {
        const target = io.sockets.sockets.get(targetSocket);
        if (target) {
          await emitFriendLists(target, to.id);
          await createNotification(to.id, "friend_request", { fromUserId: user.userId });
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
    });

    socket.on(ClientToServerEvents.friendsRemove, async (payload) => {
      const parsed = friendsRemoveSchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;
      const [userAId, userBId] = orderPair(user.userId, parsed.data.userId);
      await prisma.friendship.deleteMany({ where: { userAId, userBId } });
      await emitFriendLists(socket, user.userId);
    });

    socket.on(ClientToServerEvents.friendsList, async () => {
      const user = state.usersBySocket.get(socket.id); if (!user) return; await emitFriendLists(socket, user.userId);
    });

    socket.on(ClientToServerEvents.dmThreadGetOrCreate, async (payload) => {
      const parsed = dmThreadGetOrCreateSchema.safeParse(payload);
      if (!parsed.success) return;
      const current = state.usersBySocket.get(socket.id); if (!current) return;
      let otherId = parsed.data.withUserId;
      if (!otherId && parsed.data.withNickname) otherId = (await prisma.user.findUnique({ where: { nicknameLower: normalizeNickname(parsed.data.withNickname) } }))?.id;
      if (!otherId || otherId === current.userId) return;
      const blocked = await prisma.block.findFirst({ where: { OR: [{ blockerId: otherId, blockedId: current.userId }, { blockerId: current.userId, blockedId: otherId }] } });
      if (blocked) return socket.emit(ServerToClientEvents.error, { code: "blocked", message: "Action blocked" });
      const [userAId, userBId] = orderPair(current.userId, otherId);
      const thread = await prisma.dMThread.upsert({ where: { userAId_userBId: { userAId, userBId } }, update: {}, create: { userAId, userBId } });
      await emitDmThreadList(socket, current.userId);
      socket.emit(ServerToClientEvents.dmHistory, { threadId: thread.id, messages: [], nextCursor: null });
    });

    socket.on(ClientToServerEvents.dmThreadList, async () => {
      const user = state.usersBySocket.get(socket.id); if (!user) return; await emitDmThreadList(socket, user.userId);
    });

    socket.on(ClientToServerEvents.dmHistory, async (payload) => {
      const parsed = dmHistorySchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id); if (!user) return;
      const thread = await prisma.dMThread.findUnique({ where: { id: parsed.data.threadId } });
      if (!thread || !isDmParticipant(thread, user.userId)) return;
      const cursor = parsed.data.cursor ? { createdAt_id: { createdAt: new Date(parsed.data.cursor.createdAt), id: parsed.data.cursor.id } } : undefined;
      const messages = await prisma.message.findMany({ where: { threadId: thread.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: parsed.data.limit, ...(cursor ? { skip: 1, cursor } : {}), include: { sender: { select: { id: true, nickname: true, avatarUrl: true } }, reactions: true } });
      const next = messages.length === parsed.data.limit ? messages[messages.length - 1] : null;
      socket.emit(ServerToClientEvents.dmHistory, { threadId: thread.id, messages: messages.reverse().map(formatMessage), nextCursor: next ? { createdAt: next.createdAt.toISOString(), id: next.id } : null });
    });

    socket.on(ClientToServerEvents.dmTyping, async (payload) => {
      const parsed = dmTypingSchema.safeParse(payload);
      if (!parsed.success || !typingLimiter.consume()) return;
      const user = state.usersBySocket.get(socket.id); if (!user) return;
      const thread = await prisma.dMThread.findUnique({ where: { id: parsed.data.threadId } });
      if (!thread || !isDmParticipant(thread, user.userId)) return;
      const peerId = thread.userAId === user.userId ? thread.userBId : thread.userAId;
      const peerSocket = state.socketByUserId.get(peerId);
      if (peerSocket) io.to(peerSocket).emit(ServerToClientEvents.dmTyping, { threadId: thread.id, userId: user.userId, isTyping: parsed.data.isTyping });
    });

    socket.on(ClientToServerEvents.dmSend, async (payload) => {
      if (!sendLimiter.consume()) return socket.emit(ServerToClientEvents.error, { code: "rate_limit_chat", message: "Too many messages" });
      const parsed = dmSendSchema.safeParse(payload); if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id); if (!user) return;
      const thread = await prisma.dMThread.findUnique({ where: { id: parsed.data.threadId } });
      if (!thread || !isDmParticipant(thread, user.userId)) return;
      const cleanBody = escapeHtml(sanitizeMessageInput(parsed.data.body));
      if (!cleanBody) return socket.emit(ServerToClientEvents.error, { code: "invalid_message", message: "Empty message" });
      const message = await prisma.message.create({ data: { threadId: thread.id, senderId: user.userId, body: cleanBody }, include: { sender: { select: { id: true, nickname: true, avatarUrl: true } }, reactions: true } });
      await prisma.dMThread.update({ where: { id: thread.id }, data: { lastMessageAt: message.createdAt } });
      socket.emit(ServerToClientEvents.dmSendAck, { clientMsgId: parsed.data.clientMsgId, messageId: message.id, createdAt: message.createdAt.toISOString() });
      const payloadOut = { threadId: thread.id, message: formatMessage(message) };
      socket.emit(ServerToClientEvents.dmMessageNew, payloadOut);
      const peerId = thread.userAId === user.userId ? thread.userBId : thread.userAId;
      const peerSocketId = state.socketByUserId.get(peerId);
      if (peerSocketId) io.to(peerSocketId).emit(ServerToClientEvents.dmMessageNew, payloadOut);
      await createNotification(peerId, "dm", { threadId: thread.id, messageId: message.id });
    });

    socket.on(ClientToServerEvents.roomChatHistory, async (payload) => {
      const parsed = roomChatHistorySchema.safeParse(payload);
      if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id); if (!user) return;
      const room = state.rooms.get(parsed.data.roomId);
      if (!room || !room.participants.has(user.userId)) return;
      const cursor = parsed.data.cursor ? { createdAt_id: { createdAt: new Date(parsed.data.cursor.createdAt), id: parsed.data.cursor.id } } : undefined;
      const messages = await prisma.message.findMany({ where: { roomId: parsed.data.roomId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: parsed.data.limit, ...(cursor ? { skip: 1, cursor } : {}), include: { sender: { select: { id: true, nickname: true, avatarUrl: true } }, reactions: true } });
      const next = messages.length === parsed.data.limit ? messages[messages.length - 1] : null;
      socket.emit(ServerToClientEvents.roomChatHistory, { roomId: parsed.data.roomId, messages: messages.reverse().map(formatMessage), nextCursor: next ? { createdAt: next.createdAt.toISOString(), id: next.id } : null });
    });

    socket.on(ClientToServerEvents.roomChatSend, async (payload) => {
      if (!sendLimiter.consume()) return socket.emit(ServerToClientEvents.error, { code: "rate_limit_chat", message: "Too many messages" });
      const parsed = roomChatSendSchema.safeParse(payload); if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id); if (!user) return;
      const room = state.rooms.get(parsed.data.roomId);
      if (!room || !canSendRoomChat(new Set(room.participants.keys()), user.userId)) return;
      const cleanBody = escapeHtml(sanitizeMessageInput(parsed.data.body));
      if (!cleanBody) return socket.emit(ServerToClientEvents.error, { code: "invalid_message", message: "Empty message" });
      const message = await prisma.message.create({ data: { roomId: room.roomId, senderId: user.userId, body: cleanBody }, include: { sender: { select: { id: true, nickname: true, avatarUrl: true } }, reactions: true } });
      socket.emit(ServerToClientEvents.roomChatSendAck, { clientMsgId: parsed.data.clientMsgId, messageId: message.id, createdAt: message.createdAt.toISOString() });
      io.to(room.roomId).emit(ServerToClientEvents.roomChatMessage, { roomId: room.roomId, message: formatMessage(message) });
      const mentions = detectMentions(cleanBody);
      if (mentions.size) {
        const users = await prisma.user.findMany({ where: { nicknameLower: { in: [...mentions] } }, select: { id: true } });
        await Promise.all(users.map((u) => createNotification(u.id, "mention", { roomId: room.roomId, messageId: message.id })));
      }
    });

    socket.on(ClientToServerEvents.msgEdit, async (payload) => {
      const parsed = msgEditSchema.safeParse(payload); if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id); if (!user) return;
      const message = await prisma.message.findUnique({ where: { id: parsed.data.messageId }, include: { sender: { select: { id: true, nickname: true, avatarUrl: true } }, reactions: true } });
      if (!message || message.deleted || !canEditMessage(message, user.userId)) return;
      const updated = await prisma.message.update({ where: { id: message.id }, data: { body: escapeHtml(sanitizeMessageInput(parsed.data.body)), editedAt: new Date() }, include: { sender: { select: { id: true, nickname: true, avatarUrl: true } }, reactions: true } });
      emitMessageUpdate(io, state, updated);
    });

    socket.on(ClientToServerEvents.msgDelete, async (payload) => {
      const parsed = msgDeleteSchema.safeParse(payload); if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id); if (!user) return;
      const message = await prisma.message.findUnique({ where: { id: parsed.data.messageId }, include: { sender: { select: { id: true, nickname: true, avatarUrl: true } }, reactions: true } });
      if (!message || !canDeleteMessage(message, user.userId)) return;
      const updated = await prisma.message.update({ where: { id: message.id }, data: { body: null, deleted: true }, include: { sender: { select: { id: true, nickname: true, avatarUrl: true } }, reactions: true } });
      emitMessageUpdate(io, state, updated);
    });

    socket.on(ClientToServerEvents.msgReact, async (payload) => {
      if (!reactLimiter.consume()) return socket.emit(ServerToClientEvents.error, { code: "rate_limit_reaction", message: "Too many reactions" });
      const parsed = msgReactSchema.safeParse(payload); if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id); if (!user) return;
      const message = await prisma.message.findUnique({ where: { id: parsed.data.messageId } });
      if (!message) return;
      if (parsed.data.add) {
        await prisma.messageReaction.upsert({ where: { messageId_userId_emoji: { messageId: message.id, userId: user.userId, emoji: parsed.data.emoji } }, update: {}, create: { messageId: message.id, userId: user.userId, emoji: parsed.data.emoji } });
      } else {
        await prisma.messageReaction.deleteMany({ where: { messageId: message.id, userId: user.userId, emoji: parsed.data.emoji } });
      }
      io.emit(ServerToClientEvents.msgReactionUpdate, { messageId: message.id, emoji: parsed.data.emoji, userId: user.userId, add: parsed.data.add });
    });

    socket.on(ClientToServerEvents.notificationsRead, async (payload) => {
      const parsed = notificationsReadSchema.safeParse(payload); if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id); if (!user) return;
      await prisma.notification.updateMany({ where: { id: { in: parsed.data.ids }, userId: user.userId }, data: { readAt: new Date() } });
      await emitNotificationList(socket, user.userId);
    });

    socket.on(ClientToServerEvents.presenceSet, (payload) => {
      const parsed = presenceSetSchema.safeParse(payload); if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id); if (!user) return;
      user.status = parsed.data.status;
      socket.broadcast.emit(ServerToClientEvents.presenceList, { usersOnline: state.getPresenceList() });
    });

    // keep existing room/call handlers
    socket.on(ClientToServerEvents.roomCreate, async (payload) => {
      if (!bucket.consume()) return;
      const parsed = roomCreateSchema.safeParse(payload); if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id); if (!user) return;
      const passwordHash = parsed.data.password ? await bcrypt.hash(parsed.data.password, 10) : null;
      const room = await prisma.room.create({ data: { name: parsed.data.name, isPublic: parsed.data.isPublic, passwordHash, hostId: user.userId } });
      state.rooms.set(room.id, { roomId: room.id, name: room.name, isPublic: room.isPublic, locked: room.locked, hostId: room.hostId, passwordHash: room.passwordHash, participants: new Map() });
      io.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() });
    });

    socket.on(ClientToServerEvents.roomJoin, async (payload) => { if (!bucket.consume()) return; const parsed = roomJoinSchema.safeParse(payload); if (!parsed.success) return; const user = state.usersBySocket.get(socket.id); if (!user) return; const room = await ensureRoomState(state, parsed.data.roomId); if (!room) return; if (room.locked) return; if (room.passwordHash) { const ok = parsed.data.password ? await bcrypt.compare(parsed.data.password, room.passwordHash) : false; if (!ok) return; } socket.join(room.roomId); room.participants.set(user.userId, { userId: user.userId, name: user.name, avatarUrl: user.avatarUrl, muted: false }); socket.emit(ServerToClientEvents.roomJoined, { roomId: room.roomId, participants: [...room.participants.values()] }); socket.to(room.roomId).emit(ServerToClientEvents.roomParticipantJoined, { roomId: room.roomId, user: { userId: user.userId, name: user.name, avatarUrl: user.avatarUrl, muted: false } }); io.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() }); await prisma.roomMembershipHistory.create({ data: { roomId: room.roomId, userId: user.userId } }); });
    socket.on(ClientToServerEvents.roomLeave, async (payload) => { const parsed = roomLeaveSchema.safeParse(payload); if (!parsed.success) return; const user = state.usersBySocket.get(socket.id); if (!user) return; removeUserFromRoom(io, parsed.data.roomId, user.userId, socket, state); });

    socket.on(ClientToServerEvents.callDirectInvite, (payload) => {
      const parsed = directInviteSchema.safeParse(payload); if (!parsed.success) return;
      const user = state.usersBySocket.get(socket.id); if (!user) return;
      const targetSocketId = state.socketByUserId.get(parsed.data.toUserId);
      if (!targetSocketId) return socket.emit(ServerToClientEvents.error, { code: "user_offline", message: "User offline" });
      const busy = [...state.directCalls.values()].some((c) => (c.fromUserId === parsed.data.toUserId || c.toUserId === parsed.data.toUserId) && c.state !== "ended");
      if (busy) return socket.emit(ServerToClientEvents.callDirectState, { callId: crypto.randomUUID(), state: "ended", reason: "busy" });
      const callId = crypto.randomUUID();
      state.directCalls.set(callId, { callId, fromUserId: user.userId, toUserId: parsed.data.toUserId, state: "ringing" });
      io.to(targetSocketId).emit(ServerToClientEvents.callDirectIncoming, { callId, fromUser: { userId: user.userId, name: user.name, avatarUrl: user.avatarUrl } });
      socket.emit(ServerToClientEvents.callDirectState, { callId, state: "ringing" });
    });
    socket.on(ClientToServerEvents.callDirectAccept, (payload) => { const parsed = directAcceptSchema.safeParse(payload); if (!parsed.success) return; const call = state.directCalls.get(parsed.data.callId); if (!call) return; call.state = "connected"; notifyCallState(io, state, call.callId, "connected"); });
    socket.on(ClientToServerEvents.callDirectDecline, (payload) => { const parsed = directDeclineSchema.safeParse(payload); if (!parsed.success) return; const call = state.directCalls.get(parsed.data.callId); if (!call) return; call.state = "ended"; notifyCallState(io, state, call.callId, "ended", "declined"); state.directCalls.delete(call.callId); });

    socket.on(ClientToServerEvents.webrtcOffer, (payload) => forwardSignal(state, socket, ServerToClientEvents.webrtcOffer, payload, webrtcOfferSchema));
    socket.on(ClientToServerEvents.webrtcAnswer, (payload) => forwardSignal(state, socket, ServerToClientEvents.webrtcAnswer, payload, webrtcAnswerSchema));
    socket.on(ClientToServerEvents.webrtcIce, (payload) => forwardSignal(state, socket, ServerToClientEvents.webrtcIce, payload, webrtcIceSchema));
    socket.on(ClientToServerEvents.roomHostMute, (payload) => { const parsed = roomHostMuteSchema.safeParse(payload); if (!parsed.success) return; const room = state.rooms.get(parsed.data.roomId); if (!room || room.hostId !== state.usersBySocket.get(socket.id)?.userId) return; const p = room.participants.get(parsed.data.targetUserId); if (!p) return; p.muted = parsed.data.muted; io.to(room.roomId).emit(ServerToClientEvents.roomHostAction, { roomId: room.roomId, action: "mute", targetUserId: parsed.data.targetUserId }); });
    socket.on(ClientToServerEvents.roomHostKick, (payload) => { const parsed = roomHostKickSchema.safeParse(payload); if (!parsed.success) return; const room = state.rooms.get(parsed.data.roomId); if (!room || room.hostId !== state.usersBySocket.get(socket.id)?.userId) return; room.participants.delete(parsed.data.targetUserId); });
    socket.on(ClientToServerEvents.roomHostLock, (payload) => { const parsed = roomHostLockSchema.safeParse(payload); if (!parsed.success) return; const room = state.rooms.get(parsed.data.roomId); if (!room || room.hostId !== state.usersBySocket.get(socket.id)?.userId) return; room.locked = parsed.data.locked; });

    socket.on("disconnect", () => {
      const user = state.usersBySocket.get(socket.id);
      if (!user) return;
      for (const room of state.rooms.values()) {
        if (!room.participants.has(user.userId)) continue;
        removeUserFromRoom(io, room.roomId, user.userId, socket, state);
      }
      state.usersBySocket.delete(socket.id);
      state.socketByUserId.delete(user.userId);
    });
  });

  return io;
}

async function createNotification(userId: string, type: string, data: Record<string, unknown>) {
  const n = await prisma.notification.create({ data: { userId, type, data } });
  return { id: n.id, type: n.type, data: n.data, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null };
}

async function emitNotificationList(socket: Socket, userId: string) {
  const notifications = await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
  socket.emit(ServerToClientEvents.notificationList, {
    notifications: notifications.map((n) => ({ id: n.id, type: n.type, data: n.data, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null }))
  });
}

async function emitFriendLists(socket: Socket, userId: string) {
  const requests = await prisma.friendRequest.findMany({ where: { OR: [{ toUserId: userId }, { fromUserId: userId }] }, include: { fromUser: { select: { id: true, nickname: true, avatarUrl: true, status: true } }, toUser: { select: { id: true, nickname: true, avatarUrl: true, status: true } } } });
  socket.emit(ServerToClientEvents.friendsRequests, { incoming: requests.filter((r) => r.toUserId === userId && r.status === "pending"), outgoing: requests.filter((r) => r.fromUserId === userId && r.status === "pending") });
  const friendships = await prisma.friendship.findMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] } });
  const friendIds = friendships.map((f) => (f.userAId === userId ? f.userBId : f.userAId));
  const friendsUsers = friendIds.length ? await prisma.user.findMany({ where: { id: { in: friendIds } }, select: { id: true, nickname: true, avatarUrl: true, status: true } }) : [];
  socket.emit(ServerToClientEvents.friendsList, { friends: friendsUsers.map((f) => ({ id: f.id, nickname: f.nickname ?? "unknown", avatarUrl: f.avatarUrl, status: f.status === "away" ? "away" : "online" })) });
}

function formatMessage(message: { id: string; body: string | null; createdAt: Date; deleted: boolean; editedAt: Date | null; sender: { id: string; nickname: string | null; avatarUrl: string | null }; reactions: { emoji: string; userId: string }[] }) {
  const reactions = message.reactions.reduce<Record<string, string[]>>((acc, r) => {
    acc[r.emoji] = acc[r.emoji] ?? [];
    acc[r.emoji].push(r.userId);
    return acc;
  }, {});
  return { id: message.id, body: message.body, deleted: message.deleted, editedAt: message.editedAt?.toISOString() ?? null, createdAt: message.createdAt.toISOString(), sender: { id: message.sender.id, nickname: message.sender.nickname ?? "unknown", avatarUrl: message.sender.avatarUrl }, reactions };
}

function emitMessageUpdate(io: Server, state: ServerState, message: { id: string; threadId: string | null; roomId: string | null; body: string | null; deleted: boolean; editedAt: Date | null; createdAt: Date; sender: { id: string; nickname: string | null; avatarUrl: string | null }; reactions: { emoji: string; userId: string }[] }) {
  const data = { message: formatMessage(message) };
  if (message.roomId) {
    io.to(message.roomId).emit(ServerToClientEvents.msgUpdated, data);
    return;
  }
  if (message.threadId) {
    prisma.dMThread.findUnique({ where: { id: message.threadId } }).then((thread) => {
      if (!thread) return;
      const s1 = state.socketByUserId.get(thread.userAId);
      const s2 = state.socketByUserId.get(thread.userBId);
      if (s1) io.to(s1).emit(ServerToClientEvents.msgUpdated, data);
      if (s2 && s2 !== s1) io.to(s2).emit(ServerToClientEvents.msgUpdated, data);
    });
  }
}

function removeUserFromRoom(io: Server, roomId: string, userId: string, socket: Socket, state: ServerState) {
  const room = state.rooms.get(roomId);
  if (!room || !room.participants.has(userId)) return;
  room.participants.delete(userId);
  socket.leave(room.roomId);
  socket.to(room.roomId).emit(ServerToClientEvents.roomParticipantLeft, { roomId: room.roomId, userId });
  io.emit(ServerToClientEvents.roomList, { rooms: state.getRoomList() });
}

async function listThreads(userId: string) {
  const threads = await prisma.dMThread.findMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] }, orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }], include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } } });
  const peerIds = threads.map((t) => (t.userAId === userId ? t.userBId : t.userAId));
  const peers = await prisma.user.findMany({ where: { id: { in: peerIds } }, select: { id: true, nickname: true, avatarUrl: true, status: true } });
  const peerMap = new Map(peers.map((p) => [p.id, p]));
  return threads.map((t) => ({ id: t.id, withUser: peerMap.get(t.userAId === userId ? t.userBId : t.userAId) ?? { id: "unknown", nickname: "unknown", avatarUrl: null, status: "away" }, lastMessageAt: t.lastMessageAt?.toISOString() ?? t.createdAt.toISOString(), lastMessagePreview: t.messages[0]?.body?.slice(0, 80) ?? "" }));
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
  const targetSocketId = state.socketByUserId.get((parsed.data as { peerId: string }).peerId);
  if (targetSocketId) socket.to(targetSocketId).emit(eventName, parsed.data);
}

function notifyCallState(io: Server, state: ServerState, callId: string, callState: "ringing" | "connected" | "ended", reason?: string) {
  const call = state.directCalls.get(callId);
  if (!call) return;
  const payload = { callId, state: callState, reason };
  const callerSocketId = state.socketByUserId.get(call.fromUserId);
  const calleeSocketId = state.socketByUserId.get(call.toUserId);
  if (callerSocketId) io.to(callerSocketId).emit(ServerToClientEvents.callDirectState, payload);
  if (calleeSocketId) io.to(calleeSocketId).emit(ServerToClientEvents.callDirectState, payload);
}

function createTokenBucket(limit: number, windowMs: number) {
  let tokens = limit; let lastRefill = Date.now();
  return {
    consume() { const now = Date.now(); if (now - lastRefill > windowMs) { tokens = limit; lastRefill = now; } if (tokens <= 0) return false; tokens -= 1; return true; }
  };
}
