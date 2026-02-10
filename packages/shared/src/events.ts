export const ClientToServerEvents = {
  authHello: "auth:hello",
  presenceSet: "presence:set",
  roomCreate: "room:create",
  roomJoin: "room:join",
  roomLeave: "room:leave",
  callDirectInvite: "call:direct:invite",
  callDirectAccept: "call:direct:accept",
  callDirectDecline: "call:direct:decline",
  webrtcOffer: "webrtc:offer",
  webrtcAnswer: "webrtc:answer",
  webrtcIce: "webrtc:ice",
  roomHostMute: "room:host:mute",
  roomHostKick: "room:host:kick",
  roomHostLock: "room:host:lock"
} as const;

export const ServerToClientEvents = {
  authOk: "auth:ok",
  presenceList: "presence:list",
  roomList: "room:list",
  roomJoined: "room:joined",
  roomParticipantJoined: "room:participant:joined",
  roomParticipantLeft: "room:participant:left",
  callDirectIncoming: "call:direct:incoming",
  callDirectState: "call:direct:state",
  webrtcOffer: "webrtc:offer",
  webrtcAnswer: "webrtc:answer",
  webrtcIce: "webrtc:ice",
  webrtcSignalError: "webrtc:signal:error",
  roomHostAction: "room:host:action",
  error: "error"
} as const;

export type ClientEventName = (typeof ClientToServerEvents)[keyof typeof ClientToServerEvents];
export type ServerEventName = (typeof ServerToClientEvents)[keyof typeof ServerToClientEvents];
