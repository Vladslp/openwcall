import { DEFAULT_STUN } from "@openwcall/shared";

export interface PeerConfig {
  localStream: MediaStream;
  polite: boolean;
  onTrack: (peerId: string, stream: MediaStream) => void;
  onIceCandidate: (peerId: string, candidate: RTCIceCandidate) => void;
  onOffer: (peerId: string, sdp: string) => void;
}

export class PeerConnectionManager {
  private peers = new Map<string, RTCPeerConnection>();
  private makingOffer = new Map<string, boolean>();
  private ignoreOffer = new Map<string, boolean>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private audioSenders = new Map<string, RTCRtpSender>();
  private localStream: MediaStream;
  private onTrack: PeerConfig["onTrack"];
  private onIceCandidate: PeerConfig["onIceCandidate"];
  private onOffer: PeerConfig["onOffer"];

  constructor(config: PeerConfig) {
    this.localStream = config.localStream;
    this.onTrack = config.onTrack;
    this.onIceCandidate = config.onIceCandidate;
    this.onOffer = config.onOffer;
  }

  createPeer(peerId: string, polite: boolean, turn?: { urls: string[]; username?: string; credential?: string }) {
    if (this.peers.has(peerId)) {
      return this.peers.get(peerId)!;
    }
    const iceServers: RTCIceServer[] = [{ urls: [DEFAULT_STUN] }];
    if (turn?.urls.length) {
      iceServers.push({ urls: turn.urls, username: turn.username, credential: turn.credential });
    }

    const pc = new RTCPeerConnection({ iceServers });
    this.peers.set(peerId, pc);
    this.makingOffer.set(peerId, false);
    this.ignoreOffer.set(peerId, false);
    this.pendingCandidates.set(peerId, []);

    this.localStream.getTracks().forEach((track) => {
      const sender = pc.addTrack(track, this.localStream);
      if (track.kind === "audio") {
        this.audioSenders.set(peerId, sender);
      }
    });

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        this.onTrack(peerId, stream);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.onIceCandidate(peerId, event.candidate);
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer.set(peerId, true);
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.onOffer(peerId, pc.localDescription.sdp);
        }
      } finally {
        this.makingOffer.set(peerId, false);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (["failed", "disconnected"].includes(pc.iceConnectionState)) {
        pc.restartIce();
      }
    };

    (pc as unknown as { polite?: boolean }).polite = polite;

    return pc;
  }

  async handleOffer(peerId: string, sdp: string) {
    const pc = this.peers.get(peerId);
    if (!pc) return;
    const polite = (pc as unknown as { polite?: boolean }).polite ?? false;
    const offerCollision = this.makingOffer.get(peerId) && pc.signalingState !== "stable";
    this.ignoreOffer.set(peerId, !polite && offerCollision);
    if (this.ignoreOffer.get(peerId)) return;
    await pc.setRemoteDescription({ type: "offer", sdp });
    await pc.setLocalDescription();
    return pc.localDescription;
  }

  async handleAnswer(peerId: string, sdp: string) {
    const pc = this.peers.get(peerId);
    if (!pc) return;
    await pc.setRemoteDescription({ type: "answer", sdp });
    const pending = this.pendingCandidates.get(peerId) ?? [];
    for (const candidate of pending) {
      await pc.addIceCandidate(candidate);
    }
    this.pendingCandidates.set(peerId, []);
  }

  async handleCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const pc = this.peers.get(peerId);
    if (!pc) return;
    if (pc.remoteDescription) {
      await pc.addIceCandidate(candidate);
    } else {
      const pending = this.pendingCandidates.get(peerId) ?? [];
      pending.push(candidate);
      this.pendingCandidates.set(peerId, pending);
    }
  }

  closePeer(peerId: string) {
    const pc = this.peers.get(peerId);
    if (!pc) return;
    pc.close();
    this.peers.delete(peerId);
    this.makingOffer.delete(peerId);
    this.ignoreOffer.delete(peerId);
    this.pendingCandidates.delete(peerId);
    this.audioSenders.delete(peerId);
  }

  replaceAudioTrack(track: MediaStreamTrack) {
    this.localStream.getAudioTracks().forEach((existing) => {
      existing.stop();
      this.localStream.removeTrack(existing);
    });
    this.localStream.addTrack(track);
    for (const sender of this.audioSenders.values()) {
      sender.replaceTrack(track);
    }
  }
}

export async function getLocalAudioStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: false
  });
}

export function createLevelMonitor(stream: MediaStream, onLevel: (level: number) => void) {
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  const tick = () => {
    analyser.getByteFrequencyData(data);
    const max = Math.max(...data);
    onLevel(max / 255);
    requestAnimationFrame(tick);
  };

  tick();
  return () => {
    source.disconnect();
    analyser.disconnect();
    audioContext.close();
  };
}
