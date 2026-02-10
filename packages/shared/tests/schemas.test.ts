import { describe, expect, it } from "vitest";
import { msgReactSchema, roomCreateSchema, userNicknameSetSchema, webrtcOfferSchema } from "../src/schemas";

describe("schemas", () => {
  it("validates room create", () => {
    const result = roomCreateSchema.safeParse({
      name: "Test",
      isPublic: true
    });
    expect(result.success).toBe(true);
  });

  it("validates nickname rules", () => {
    expect(userNicknameSetSchema.safeParse({ nickname: "good.name" }).success).toBe(true);
    expect(userNicknameSetSchema.safeParse({ nickname: "??" }).success).toBe(false);
  });

  it("rejects invalid offer", () => {
    const result = webrtcOfferSchema.safeParse({
      peerId: "",
      sdp: ""
    });
    expect(result.success).toBe(false);
  });

  it("validates supported reaction emoji only", () => {
    expect(msgReactSchema.safeParse({ messageId: "m1", emoji: "👍", add: true }).success).toBe(true);
    expect(msgReactSchema.safeParse({ messageId: "m1", emoji: "🔥", add: true }).success).toBe(false);
  });
});
