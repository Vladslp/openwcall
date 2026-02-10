import { nicknameRegex } from "@openwcall/shared";

export function normalizeNickname(nickname: string) {
  return nickname.trim().toLowerCase();
}

export function validateNickname(nickname: string) {
  const trimmed = nickname.trim();
  return nicknameRegex.test(trimmed);
}

export function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function canSendRoomChat(participantIds: Set<string>, userId: string) {
  return participantIds.has(userId);
}

export function isDmParticipant(thread: { userAId: string; userBId: string }, userId: string) {
  return thread.userAId === userId || thread.userBId === userId;
}
