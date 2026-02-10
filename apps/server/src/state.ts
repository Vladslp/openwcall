import { DEFAULT_MAX_PARTICIPANTS } from "@openwcall/shared";

export type PresenceStatus = "online" | "away";

export interface PresenceUser {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  status: PresenceStatus;
}

export interface RoomState {
  roomId: string;
  name: string;
  isPublic: boolean;
  locked: boolean;
  hostId: string;
  passwordHash?: string | null;
  participants: Map<string, { userId: string; name: string; avatarUrl?: string | null; muted: boolean }>;
}

export interface DirectCallState {
  callId: string;
  fromUserId: string;
  toUserId: string;
  state: "ringing" | "connected" | "ended";
}

export class ServerState {
  public usersBySocket = new Map<string, PresenceUser>();
  public socketByUserId = new Map<string, string>();
  public rooms = new Map<string, RoomState>();
  public directCalls = new Map<string, DirectCallState>();
  public maxParticipants = DEFAULT_MAX_PARTICIPANTS;

  getPresenceList() {
    return Array.from(this.usersBySocket.values());
  }

  getRoomList() {
    return Array.from(this.rooms.values())
      .filter((room) => room.isPublic)
      .map((room) => ({
        roomId: room.roomId,
        name: room.name,
        isPublic: room.isPublic,
        locked: room.locked,
        count: room.participants.size
      }));
  }

  addParticipant(roomId: string, participant: RoomState["participants"] extends Map<string, infer V> ? V : never) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    if (room.participants.size >= this.maxParticipants) return false;
    room.participants.set(participant.userId, participant);
    return true;
  }

  removeParticipant(roomId: string, userId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    return room.participants.delete(userId);
  }
}
