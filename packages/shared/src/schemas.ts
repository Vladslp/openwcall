import { z } from "zod";

export const authHelloSchema = z.object({
  token: z.string().min(1)
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

export const roomLeaveSchema = z.object({
  roomId: z.string().min(1)
});

export const directInviteSchema = z.object({
  toUserId: z.string().min(1)
});

export const directAcceptSchema = z.object({
  callId: z.string().min(1)
});

export const directDeclineSchema = z.object({
  callId: z.string().min(1)
});

export const webrtcOfferSchema = z.object({
  peerId: z.string().min(1),
  roomId: z.string().min(1).optional(),
  callId: z.string().min(1).optional(),
  sdp: z.string().min(1)
});

export const webrtcAnswerSchema = z.object({
  peerId: z.string().min(1),
  roomId: z.string().min(1).optional(),
  callId: z.string().min(1).optional(),
  sdp: z.string().min(1)
});

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

export const authOkSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    avatarUrl: z.string().url().optional().nullable()
  })
});

export const presenceListSchema = z.object({
  usersOnline: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      avatarUrl: z.string().url().optional().nullable(),
      status: z.enum(["online", "away"]) 
    })
  )
});

export const roomListSchema = z.object({
  rooms: z.array(
    z.object({
      roomId: z.string(),
      name: z.string(),
      isPublic: z.boolean(),
      locked: z.boolean(),
      count: z.number().int().min(0)
    })
  )
});

export const roomJoinedSchema = z.object({
  room: z.object({
    roomId: z.string(),
    name: z.string(),
    isPublic: z.boolean(),
    locked: z.boolean(),
    hostId: z.string()
  }),
  participants: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      avatarUrl: z.string().url().optional().nullable(),
      muted: z.boolean()
    })
  )
});

export const roomParticipantJoinedSchema = z.object({
  roomId: z.string(),
  user: z.object({
    userId: z.string(),
    name: z.string(),
    avatarUrl: z.string().url().optional().nullable(),
    muted: z.boolean()
  })
});

export const roomParticipantLeftSchema = z.object({
  roomId: z.string(),
  userId: z.string()
});

export const callDirectIncomingSchema = z.object({
  callId: z.string(),
  fromUser: z.object({
    userId: z.string(),
    name: z.string(),
    avatarUrl: z.string().url().optional().nullable()
  })
});

export const callDirectStateSchema = z.object({
  callId: z.string(),
  state: z.enum(["ringing", "connected", "ended"]),
  reason: z.string().optional()
});

export const webrtcSignalErrorSchema = z.object({
  message: z.string()
});

export const roomHostActionSchema = z.object({
  roomId: z.string(),
  action: z.enum(["mute", "kick", "lock"]),
  targetUserId: z.string().optional()
});

export const errorSchema = z.object({
  code: z.string(),
  message: z.string()
});

export type AuthHelloPayload = z.infer<typeof authHelloSchema>;
export type PresenceSetPayload = z.infer<typeof presenceSetSchema>;
export type RoomCreatePayload = z.infer<typeof roomCreateSchema>;
export type RoomJoinPayload = z.infer<typeof roomJoinSchema>;
export type RoomLeavePayload = z.infer<typeof roomLeaveSchema>;
export type DirectInvitePayload = z.infer<typeof directInviteSchema>;
export type DirectAcceptPayload = z.infer<typeof directAcceptSchema>;
export type DirectDeclinePayload = z.infer<typeof directDeclineSchema>;
export type WebrtcOfferPayload = z.infer<typeof webrtcOfferSchema>;
export type WebrtcAnswerPayload = z.infer<typeof webrtcAnswerSchema>;
export type WebrtcIcePayload = z.infer<typeof webrtcIceSchema>;
export type RoomHostMutePayload = z.infer<typeof roomHostMuteSchema>;
export type RoomHostKickPayload = z.infer<typeof roomHostKickSchema>;
export type RoomHostLockPayload = z.infer<typeof roomHostLockSchema>;
