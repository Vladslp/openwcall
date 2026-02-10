import { describe, expect, it } from "vitest";
import { roomCreateSchema, userNicknameSetSchema, webrtcOfferSchema } from "../src/schemas";

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
});
