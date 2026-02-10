import { describe, expect, it } from "vitest";
import { ServerState } from "../src/state";

describe("ServerState room membership", () => {
  it("adds and removes participants", () => {
    const state = new ServerState();
    state.rooms.set("room-1", {
      roomId: "room-1",
      name: "Room",
      isPublic: true,
      locked: false,
      hostId: "host",
      participants: new Map()
    });

    const added = state.addParticipant("room-1", {
      userId: "user-1",
      name: "User One",
      muted: false
    });
    expect(added).toBe(true);
    expect(state.rooms.get("room-1")?.participants.size).toBe(1);

    const removed = state.removeParticipant("room-1", "user-1");
    expect(removed).toBe(true);
    expect(state.rooms.get("room-1")?.participants.size).toBe(0);
  });

  it("rejects when room missing", () => {
    const state = new ServerState();
    expect(state.addParticipant("missing", { userId: "u", name: "n", muted: false })).toBe(false);
    expect(state.removeParticipant("missing", "u")).toBe(false);
  });
});
