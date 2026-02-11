import { z } from "zod";

export const nicknameRegex = /^[a-zA-Z0-9._-]{3,24}$/;

export const authHelloSchema = z.object({
  token: z.string().min(1)
});


export const authOkSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    nickname: z.string().optional().nullable(),
    avatarUrl: z.string().url().optional().nullable()
  })
});

export const presenceSetSchema = z.object({
  status: z.enum(["online", "away"])
});

export const roomCreateSchema = z.object({
  name: z.string().min(1).max(80),
  isPublic: z.boolean(),
  password: z.string().min(1).max(64).optional()
});

export const roomJoinSchema = z.object({
  roomId: z.string().min(1),
  password: z.string().min(1).max(64).optional()
});

export const roomLeaveSchema = z.object({ roomId: z.string().min(1) });
export const directInviteSchema = z.object({ toUserId: z.string().min(1) });
export const directAcceptSchema = z.object({ callId: z.string().min(1) });
export const directDeclineSchema = z.object({ callId: z.string().min(1) });

export const webrtcOfferSchema = z.object({
  peerId: z.string().min(1),
  roomId: z.string().min(1).optional(),
  callId: z.string().min(1).optional(),
  sdp: z.string().min(1)
});

export const webrtcAnswerSchema = webrtcOfferSchema;

export const webrtcIceSchema = z.object({
  peerId: z.string().min(1),
  roomId: z.string().min(1).optional(),
  callId: z.string().min(1).optional(),
  candidate: z.string().min(1)
});

export const roomHostMuteSchema = z.object({
  roomId: z.string().min(1),
  targetUserId: z.string().min(1),
  muted: z.boolean()
});

export const roomHostKickSchema = z.object({
  roomId: z.string().min(1),
  targetUserId: z.string().min(1)
});

export const roomHostLockSchema = z.object({
  roomId: z.string().min(1),
  locked: z.boolean()
});

export const userNicknameSetSchema = z.object({
  nickname: z.string().trim().regex(nicknameRegex)
});

export const userSearchSchema = z.object({
  query: z.string().trim().min(1).max(24),
  limit: z.number().int().min(1).max(20).default(10)
});

export const friendsRequestSendSchema = z.object({ toNickname: z.string().trim().min(3).max(24) });
export const friendsRequestRespondSchema = z.object({
  requestId: z.string().min(1),
  action: z.enum(["accept", "decline"])
});

export const friendsRemoveSchema = z.object({ userId: z.string().min(1) });

export const dmThreadGetOrCreateSchema = z
  .object({
    withUserId: z.string().min(1).optional(),
    withNickname: z.string().trim().min(3).max(24).optional()
  })
  .refine((data) => !!data.withUserId || !!data.withNickname, "withUserId or withNickname required");

export const dmThreadListSchema = z.object({});

export const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().min(1)
});

export const dmHistorySchema = z.object({
  threadId: z.string().min(1),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(30)
});

export const messageBodySchema = z.string().trim().min(1).max(2000);

export const dmSendSchema = z.object({
  threadId: z.string().min(1),
  body: messageBodySchema,
  clientMsgId: z.string().min(1).max(64)
});

export const dmTypingSchema = z.object({
  threadId: z.string().min(1),
  isTyping: z.boolean()
});

export const roomChatHistorySchema = z.object({
  roomId: z.string().min(1),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(30)
});

export const roomChatSendSchema = z.object({
  roomId: z.string().min(1),
  body: messageBodySchema,
  clientMsgId: z.string().min(1).max(64)
});

export const msgEditSchema = z.object({
  messageId: z.string().min(1),
  body: messageBodySchema
});

export const msgDeleteSchema = z.object({
  messageId: z.string().min(1)
});

export const emojiSchema = z.enum(["👍", "❤️", "😂", "😮", "😭", "👎"]);

export const msgReactSchema = z.object({
  messageId: z.string().min(1),
  emoji: emojiSchema,
  add: z.boolean()
});

export const notificationsReadSchema = z.object({ ids: z.array(z.string().min(1)).max(100) });

export type AuthHelloPayload = z.infer<typeof authHelloSchema>;
export type PresenceSetPayload = z.infer<typeof presenceSetSchema>;
export type RoomCreatePayload = z.infer<typeof roomCreateSchema>;
export type RoomJoinPayload = z.infer<typeof roomJoinSchema>;
export type RoomLeavePayload = z.infer<typeof roomLeaveSchema>;
export type DirectInvitePayload = z.infer<typeof directInviteSchema>;
export type DirectAcceptPayload = z.infer<typeof directAcceptSchema>;
export type DirectDeclinePayload = z.infer<typeof directDeclineSchema>;
export type UserNicknameSetPayload = z.infer<typeof userNicknameSetSchema>;
export type UserSearchPayload = z.infer<typeof userSearchSchema>;
