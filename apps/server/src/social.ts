import { nicknameRegex } from "@openwcall/shared";

const EDIT_WINDOW_MS = 15 * 60 * 1000;

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

export function canEditMessage(message: { senderId: string; createdAt: Date }, userId: string, now = new Date()) {
  if (message.senderId !== userId) return false;
  return now.getTime() - message.createdAt.getTime() <= EDIT_WINDOW_MS;
}

export function canDeleteMessage(message: { senderId: string }, userId: string) {
  return message.senderId === userId;
}

export function sanitizeMessageInput(input: string) {
  const normalized = input.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return normalized;
}

export function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function detectMentions(message: string) {
  const matches = message.match(/@([a-zA-Z0-9._-]{3,24})/g) ?? [];
  return new Set(matches.map((match) => normalizeNickname(match.slice(1))));
}
