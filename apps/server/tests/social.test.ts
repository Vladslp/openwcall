import { describe, expect, it } from "vitest";
import {
  canDeleteMessage,
  canEditMessage,
  canSendRoomChat,
  detectMentions,
  isDmParticipant,
  normalizeNickname,
  orderPair,
  sanitizeMessageInput,
  validateNickname
} from "../src/social";

describe("social helpers", () => {
  it("validates and normalizes nicknames", () => {
    expect(validateNickname("User.Tag")).toBe(true);
    expect(validateNickname("ab")).toBe(false);
    expect(normalizeNickname(" User.Tag ")).toBe("user.tag");
  });

  it("orders friendship pairs", () => {
    expect(orderPair("b", "a")).toEqual(["a", "b"]);
  });

  it("checks dm participant", () => {
    expect(isDmParticipant({ userAId: "u1", userBId: "u2" }, "u2")).toBe(true);
    expect(isDmParticipant({ userAId: "u1", userBId: "u2" }, "u3")).toBe(false);
  });

  it("checks room message permissions", () => {
    expect(canSendRoomChat(new Set(["u1"]), "u1")).toBe(true);
    expect(canSendRoomChat(new Set(["u1"]), "u2")).toBe(false);
  });

  it("enforces message edit/delete permissions", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    expect(canEditMessage({ senderId: "u1", createdAt }, "u1", new Date("2026-01-01T00:10:00.000Z"))).toBe(true);
    expect(canEditMessage({ senderId: "u1", createdAt }, "u1", new Date("2026-01-01T00:20:00.000Z"))).toBe(false);
    expect(canDeleteMessage({ senderId: "u1" }, "u1")).toBe(true);
    expect(canDeleteMessage({ senderId: "u1" }, "u2")).toBe(false);
  });

  it("detects mentions and sanitizes body", () => {
    const mentions = detectMentions("hey @Demo.User and @sam.wave");
    expect(mentions.has("demo.user")).toBe(true);
    expect(mentions.has("sam.wave")).toBe(true);
    expect(sanitizeMessageInput(" hi\n\n\nthere ")).toBe("hi\n\nthere");
  });
});
