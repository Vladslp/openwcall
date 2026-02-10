import { describe, expect, it } from "vitest";
import { canSendRoomChat, isDmParticipant, normalizeNickname, orderPair, validateNickname } from "../src/social";

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
});
