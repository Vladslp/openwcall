"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ClientToServerEvents,
  ServerToClientEvents,
  TEXT
} from "@openwcall/shared";
import { getSocket } from "../../../lib/socket";
import { useAuthStore } from "../../../store/auth";
import { PeerConnectionManager, createLevelMonitor, getLocalAudioStream } from "../../../lib/webrtc";

interface Participant {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  muted: boolean;
  level?: number;
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;
  const { accessToken, user } = useAuthStore();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localMuted, setLocalMuted] = useState(false);
  const [localDeaf, setLocalDeaf] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [micLevel, setMicLevel] = useState(0);
  const peerManagerRef = useRef<PeerConnectionManager | null>(null);
  const turnConfig = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_TURN_URL;
    if (!url) return undefined;
    return {
      urls: [url],
      username: process.env.NEXT_PUBLIC_TURN_USER,
      credential: process.env.NEXT_PUBLIC_TURN_PASS
    };
  }, []);

  const socket = useMemo(() => {
    if (!accessToken) return null;
    return getSocket(accessToken);
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !socket) {
      router.replace("/login");
      return;
    }

    const setup = async () => {
      const stream = await getLocalAudioStream();
      setLocalStream(stream);

      const manager = new PeerConnectionManager({
        localStream: stream,
        polite: true,
        onTrack: (peerId, remoteStream) => {
          const audio = document.getElementById(`audio-${peerId}`) as HTMLAudioElement | null;
          if (audio) {
            audio.srcObject = remoteStream;
          }
          createLevelMonitor(remoteStream, (level) => {
            setParticipants((prev) =>
              prev.map((participant) =>
                participant.userId === peerId ? { ...participant, level } : participant
              )
            );
          });
        },
        onIceCandidate: (peerId, candidate) => {
          socket.emit(ClientToServerEvents.webrtcIce, {
            peerId,
            roomId: roomId.startsWith("direct-") ? undefined : roomId,
            callId: roomId.startsWith("direct-") ? roomId.replace("direct-", "") : undefined,
            candidate: JSON.stringify(candidate)
          });
        },
        onOffer: (peerId, sdp) => {
          socket.emit(ClientToServerEvents.webrtcOffer, {
            peerId,
            roomId: roomId.startsWith("direct-") ? undefined : roomId,
            callId: roomId.startsWith("direct-") ? roomId.replace("direct-", "") : undefined,
            sdp
          });
        }
      });
      peerManagerRef.current = manager;

      socket.emit(ClientToServerEvents.roomJoin, { roomId });
    };

    setup();

    socket.on(ServerToClientEvents.roomJoined, (payload) => {
      setParticipants(payload.participants);
      payload.participants.forEach((participant) => {
        if (!user || participant.userId === user.id) return;
        const polite = participant.userId > user.id;
        peerManagerRef.current?.createPeer(participant.userId, polite, turnConfig);
      });
    });

    socket.on(ServerToClientEvents.roomParticipantJoined, (payload) => {
      setParticipants((prev) => [...prev, payload.user]);
      if (user && payload.user.userId !== user.id) {
        peerManagerRef.current?.createPeer(payload.user.userId, payload.user.userId > user.id, turnConfig);
      }
    });

    socket.on(ServerToClientEvents.roomParticipantLeft, (payload) => {
      setParticipants((prev) => prev.filter((p) => p.userId !== payload.userId));
      peerManagerRef.current?.closePeer(payload.userId);
    });

    socket.on(ServerToClientEvents.webrtcOffer, async (payload) => {
      const manager = peerManagerRef.current;
      if (!manager) return;
      manager.createPeer(payload.peerId, payload.peerId > (user?.id ?? ""), turnConfig);
      const answer = await manager.handleOffer(payload.peerId, payload.sdp);
      if (answer) {
        socket.emit(ClientToServerEvents.webrtcAnswer, {
          peerId: payload.peerId,
          roomId: payload.roomId,
          callId: payload.callId,
          sdp: answer.sdp
        });
      }
    });

    socket.on(ServerToClientEvents.webrtcAnswer, async (payload) => {
      if (!peerManagerRef.current) return;
      await peerManagerRef.current.handleAnswer(payload.peerId, payload.sdp);
    });

    socket.on(ServerToClientEvents.webrtcIce, async (payload) => {
      if (!peerManagerRef.current) return;
      await peerManagerRef.current.handleCandidate(payload.peerId, JSON.parse(payload.candidate));
    });

    socket.on(ServerToClientEvents.roomHostAction, (payload) => {
      if (payload.action === "kick" && payload.targetUserId === user?.id) {
        router.push("/lobby");
      }
    });

    return () => {
      socket.emit(ClientToServerEvents.roomLeave, { roomId });
      socket.off(ServerToClientEvents.roomJoined);
      socket.off(ServerToClientEvents.roomParticipantJoined);
      socket.off(ServerToClientEvents.roomParticipantLeft);
      socket.off(ServerToClientEvents.webrtcOffer);
      socket.off(ServerToClientEvents.webrtcAnswer);
      socket.off(ServerToClientEvents.webrtcIce);
      socket.off(ServerToClientEvents.roomHostAction);
    };
  }, [accessToken, roomId, router, socket, user, turnConfig]);

  useEffect(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !localMuted;
    });
  }, [localMuted, localStream]);

  useEffect(() => {
    const audioElements = document.querySelectorAll("audio[data-remote]");
    audioElements.forEach((element) => {
      const audio = element as HTMLAudioElement;
      audio.muted = localDeaf;
    });
  }, [localDeaf]);

  useEffect(() => {
    if (!localStream) return;
    const stop = createLevelMonitor(localStream, (level) => setMicLevel(level));
    return () => stop();
  }, [localStream]);

  useEffect(() => {
    if (!showSettings) return;
    navigator.mediaDevices.enumerateDevices().then((list) => {
      const audioInputs = list.filter((device) => device.kind === "audioinput");
      setDevices(audioInputs);
      if (audioInputs.length && !selectedDevice) {
        setSelectedDevice(audioInputs[0].deviceId);
      }
    });
  }, [showSettings, selectedDevice]);

  const handleDeviceChange = async (deviceId: string) => {
    setSelectedDevice(deviceId);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    const track = stream.getAudioTracks()[0];
    if (track) {
      peerManagerRef.current?.replaceAudioTrack(track);
      setLocalStream(stream);
    }
  };

  const leaveRoom = () => {
    router.push("/lobby");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Room</h1>
          <p className="text-sm text-slate-400">{roomId}</p>
        </div>
        <button className="text-sm text-slate-300 hover:text-white" onClick={leaveRoom}>
          {TEXT.leaveRoom}
        </button>
      </header>
      <main className="flex-1 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {participants.map((participant) => (
            <div key={participant.userId} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{participant.name}</p>
                  <p className="text-xs text-slate-400">{participant.muted ? "Muted" : "Speaking"}</p>
                </div>
                <div className="h-2 w-16 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-500"
                    style={{ width: `${Math.round((participant.level ?? 0) * 100)}%` }}
                  />
                </div>
              </div>
              <audio id={`audio-${participant.userId}`} data-remote autoPlay />
            </div>
          ))}
        </div>
      </main>
      <footer className="p-6 border-t border-slate-800 flex items-center justify-center gap-4">
        <button
          className="rounded-full bg-slate-800 px-4 py-2 text-sm"
          onClick={() => setLocalMuted((prev) => !prev)}
          aria-label={localMuted ? TEXT.unmute : TEXT.mute}
        >
          {localMuted ? TEXT.unmute : TEXT.mute}
        </button>
        <button
          className="rounded-full bg-slate-800 px-4 py-2 text-sm"
          onClick={() => setLocalDeaf((prev) => !prev)}
          aria-label={localDeaf ? TEXT.undeafen : TEXT.deafen}
        >
          {localDeaf ? TEXT.undeafen : TEXT.deafen}
        </button>
        <button className="rounded-full bg-slate-800 px-4 py-2 text-sm" onClick={() => setShowSettings(true)}>
          {TEXT.settings}
        </button>
        <button className="rounded-full bg-red-500 px-4 py-2 text-sm text-slate-950" onClick={leaveRoom}>
          {TEXT.leaveRoom}
        </button>
      </footer>

      {showSettings && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center px-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">{TEXT.settings}</h3>
            <label className="text-sm text-slate-400">Audio input</label>
            <select
              className="mt-2 w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2"
              value={selectedDevice}
              onChange={(event) => handleDeviceChange(event.target.value)}
            >
              {devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || "Microphone"}
                </option>
              ))}
            </select>
            <div className="mt-4">
              <p className="text-sm text-slate-400 mb-2">Mic level</p>
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-primary-500" style={{ width: `${Math.round(micLevel * 100)}%` }} />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button className="text-sm text-slate-400" onClick={() => setShowSettings(false)}>
                {TEXT.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
