import { describe, expect, it } from "vitest";
import { roomCreateSchema, webrtcOfferSchema } from "../src/schemas";

describe("schemas", () => {
  it("validates room create", () => {
    const result = roomCreateSchema.safeParse({
      name: "Test",
      isPublic: true
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid offer", () => {
    const result = webrtcOfferSchema.safeParse({
      peerId: "",
      sdp: ""
    });
    expect(result.success).toBe(false);
  });
});
