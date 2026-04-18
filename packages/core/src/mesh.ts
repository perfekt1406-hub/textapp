/**
 * @fileoverview WebRTC full-mesh orchestration using an injected RTCPeerConnection
 * factory and SignalingClient. Plan B can reuse this module with a browser PC factory.
 * @module @textapp/core/mesh
 */

import {
  type ChatEnvelope,
  parseChatEnvelope,
  serializeChatEnvelope,
  createChatEnvelope,
} from "./envelope.js";
import type { AddressedSignal, SignalingClient, SignalPayload } from "./signaling-types.js";

/** User-facing callbacks for mesh lifecycle and chat. */
export type MeshCallbacks = {
  /** Fired when a valid chat envelope is received on any data channel. */
  onChatMessage: (envelope: ChatEnvelope) => void;
  /** Fired when a data channel to a peer opens. */
  onPeerConnected: (peerId: string) => void;
  /** Fired when a peer connection closes or fails. */
  onPeerDisconnected: (peerId: string) => void;
  /** Fired for signaling/WebRTC errors (human-readable). */
  onError: (message: string) => void;
};

/** Options for MeshCoordinator (client id is set after `joinRoom`). */
export type MeshCoordinatorOptions = {
  /** Injected factory: Node `wrtc` or browser RTCPeerConnection. */
  createPeerConnection: () => RTCPeerConnection;
  /** Signaling transport (HTTP polling in Plan A). */
  signaling: SignalingClient;
  callbacks: MeshCallbacks;
};

type PeerSession = {
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  pendingRemoteIce: RTCIceCandidateInit[];
};

/**
 * Orchestrates full mesh: one RTCPeerConnection per remote peer, one ordered data
 * channel labeled `textapp-chat`. Lower client id (lexicographic) is the polite
 * peer that creates the offer and data channel; the other side answers.
 */
export class MeshCoordinator {
  /** Set after successful `joinRoom` (from signaling). */
  private clientId: string | null = null;
  private readonly createPeerConnection: () => RTCPeerConnection;
  private readonly signaling: SignalingClient;
  private readonly callbacks: MeshCallbacks;
  private readonly peers = new Map<string, PeerSession>();
  private lastRoster: string[] = [];
  private pollRunning = false;

  /**
   * Creates a coordinator; call `joinRoom` then `startPolling` (or manual `tick`).
   *
   * @param options - Factories and callbacks.
   */
  constructor(options: MeshCoordinatorOptions) {
    this.createPeerConnection = options.createPeerConnection;
    this.signaling = options.signaling;
    this.callbacks = options.callbacks;
  }

  /**
   * Joins the signaling room and stores the assigned client id for envelopes.
   *
   * @param room - Five-digit room code.
   * @returns The session client id from signaling.
   */
  async joinRoom(room: string): Promise<string> {
    const result = await this.signaling.join(room);
    this.clientId = result.clientId;
    return result.clientId;
  }

  /**
   * Returns the client id after `joinRoom`, or null if not joined yet.
   */
  getClientId(): string | null {
    return this.clientId;
  }

  /**
   * Starts a background loop that polls signaling and drives negotiation.
   * Safe to call once; idempotent if already running.
   *
   * @param intervalMs - Poll interval in milliseconds.
   */
  startPolling(intervalMs: number): void {
    if (this.pollRunning) return;
    this.pollRunning = true;
    const loop = async () => {
      while (this.pollRunning) {
        try {
          await this.tick();
        } catch (e) {
          this.callbacks.onError(
            e instanceof Error ? e.message : `Poll error: ${String(e)}`,
          );
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    };
    void loop();
  }

  /** Stops the polling loop started by `startPolling`. */
  stopPolling(): void {
    this.pollRunning = false;
  }

  /**
   * Single poll/negotiation tick: fetch roster and signals, update mesh.
   */
  async tick(): Promise<void> {
    const result = await this.signaling.poll();
    this.applyRoster(result.peers);
    for (const s of result.signals) {
      await this.handleAddressedSignal(s);
    }
  }

  /**
   * Sends a direct message on the data channel to one peer.
   *
   * @param toPeerId - Target peer client id.
   * @param body - Message body.
   */
  sendDirect(toPeerId: string, body: string): void {
    const self = this.requireClientId();
    const session = this.peers.get(toPeerId);
    if (!session?.channel || session.channel.readyState !== "open") {
      this.callbacks.onError(`No open data channel to peer ${toPeerId}`);
      return;
    }
    const env = createChatEnvelope({
      id: randomId(),
      from: self,
      to: toPeerId,
      body,
      ts: Date.now(),
    });
    session.channel.send(serializeChatEnvelope(env));
  }

  /**
   * Sends the same envelope to every peer with an open data channel (broadcast).
   *
   * @param body - Message body.
   */
  broadcast(body: string): void {
    const self = this.requireClientId();
    const env = createChatEnvelope({
      id: randomId(),
      from: self,
      to: null,
      body,
      ts: Date.now(),
    });
    const raw = serializeChatEnvelope(env);
    let sent = 0;
    for (const [, session] of this.peers) {
      if (session.channel?.readyState === "open") {
        session.channel.send(raw);
        sent += 1;
      }
    }
    if (sent === 0) {
      this.callbacks.onError("Broadcast failed: no open data channels yet.");
    }
  }

  /**
   * Closes all peer connections and leaves signaling.
   */
  async leave(): Promise<void> {
    this.stopPolling();
    for (const peerId of [...this.peers.keys()]) {
      const session = this.peers.get(peerId);
      if (!session) continue;
      session.channel?.close();
      session.pc.close();
      this.peers.delete(peerId);
      this.callbacks.onPeerDisconnected(peerId);
    }
    await this.signaling.leave();
  }

  /** Returns the last known peer ids from signaling (excluding self). */
  getPeerIds(): string[] {
    const self = this.clientId;
    if (!self) return [];
    return this.lastRoster.filter((id) => id !== self);
  }

  /**
   * Applies roster diff: connects to new peers, removes left peers.
   *
   * @param roster - Full list of client ids in the room from signaling.
   */
  private applyRoster(roster: string[]): void {
    const next = [...new Set(roster)].sort();
    this.lastRoster = next;
    const self = this.clientId;
    if (!self) return;
    const others = next.filter((id) => id !== self);
    for (const peerId of others) {
      if (!this.peers.has(peerId)) {
        void this.ensureSession(peerId);
      }
    }
    for (const existing of [...this.peers.keys()]) {
      if (!others.includes(existing)) {
        void this.removePeer(existing);
      }
    }
  }

  /**
   * Creates or resumes negotiation with a peer according to polite-peer rules.
   *
   * @param peerId - Remote client id.
   */
  private async ensureSession(peerId: string): Promise<void> {
    const self = this.requireClientId();
    if (this.peers.has(peerId)) return;
    const polite = self < peerId;
    const session = this.createSession(peerId);
    this.peers.set(peerId, session);
    if (polite) {
      await this.runNegotiationAsPolite(peerId, session);
    }
  }

  /**
   * Builds a PeerSession with shared ICE and channel handlers.
   *
   * @param peerId - Remote peer id (for logging and signaling).
   */
  private createSession(peerId: string): PeerSession {
    const pc = this.createPeerConnection();
    const session: PeerSession = { pc, channel: null, pendingRemoteIce: [] };

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      const cand = ev.candidate;
      void this.signaling.sendSignal(peerId, {
        kind: "ice",
        candidate: cand.candidate,
        sdpMid: cand.sdpMid,
        sdpMLineIndex: cand.sdpMLineIndex,
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        this.callbacks.onError(`Peer ${peerId}: connection ${pc.connectionState}`);
      }
      if (pc.connectionState === "closed") {
        this.callbacks.onPeerDisconnected(peerId);
      }
    };

    pc.ondatachannel = (ev) => {
      const ch = ev.channel;
      session.channel = ch;
      this.wireDataChannel(peerId, ch);
    };

    return session;
  }

  /**
   * Polite peer creates the data channel and offer.
   *
   * @param peerId - Remote peer.
   * @param session - Session state.
   */
  private async runNegotiationAsPolite(peerId: string, session: PeerSession): Promise<void> {
    try {
      const dc = session.pc.createDataChannel("textapp-chat", { ordered: true });
      session.channel = dc;
      this.wireDataChannel(peerId, dc);
      const offer = await session.pc.createOffer();
      await session.pc.setLocalDescription(offer);
      await this.signaling.sendSignal(peerId, { kind: "offer", sdp: offer.sdp ?? "" });
    } catch (e) {
      this.callbacks.onError(
        `Negotiation (polite) with ${peerId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Attaches message handler to a data channel.
   *
   * @param peerId - Sender peer id for labeling.
   * @param channel - Open or opening data channel.
   */
  private wireDataChannel(peerId: string, channel: RTCDataChannel): void {
    channel.onopen = () => {
      this.callbacks.onPeerConnected(peerId);
    };
    channel.onclose = () => {
      this.callbacks.onPeerDisconnected(peerId);
    };
    channel.onmessage = (ev) => {
      const text = typeof ev.data === "string" ? ev.data : String(ev.data);
      const parsed = parseChatEnvelope(text);
      if (parsed instanceof Error) {
        this.callbacks.onError(`Bad envelope from ${peerId}: ${parsed.message}`);
        return;
      }
      this.callbacks.onChatMessage(parsed);
    };
  }

  /**
   * Handles one incoming signaling message (offer/answer/ICE).
   *
   * @param msg - Addressed signal from poll.
   */
  private async handleAddressedSignal(msg: AddressedSignal): Promise<void> {
    const self = this.clientId;
    if (!self) return;
    const peerId = msg.from;
    if (peerId === self) return;

    let session = this.peers.get(peerId);
    if (!session) {
      await this.ensureSession(peerId);
      session = this.peers.get(peerId);
    }
    if (!session) return;

    try {
      if (msg.payload.kind === "offer") {
        await this.handleOffer(peerId, session, msg.payload.sdp);
      } else if (msg.payload.kind === "answer") {
        await this.handleAnswer(peerId, session, msg.payload.sdp);
      } else if (msg.payload.kind === "ice") {
        await this.handleIce(peerId, session, msg.payload);
      }
    } catch (e) {
      this.callbacks.onError(
        `Signal from ${peerId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Applies remote offer (impolite side) or upgrades session.
   *
   * @param peerId - Remote peer.
   * @param session - Local session.
   * @param sdp - Offer SDP text.
   */
  private async handleOffer(peerId: string, session: PeerSession, sdp: string): Promise<void> {
    await session.pc.setRemoteDescription({ type: "offer", sdp });
    await this.flushPendingIce(session);
    const answer = await session.pc.createAnswer();
    await session.pc.setLocalDescription(answer);
    await this.signaling.sendSignal(peerId, { kind: "answer", sdp: answer.sdp ?? "" });
  }

  /**
   * Applies remote answer (polite side).
   *
   * @param peerId - Remote peer.
   * @param session - Local session.
   * @param sdp - Answer SDP text.
   */
  private async handleAnswer(_peerId: string, session: PeerSession, sdp: string): Promise<void> {
    await session.pc.setRemoteDescription({ type: "answer", sdp });
    await this.flushPendingIce(session);
  }

  /**
   * Adds an ICE candidate, queueing if remote description is not set yet.
   *
   * @param peerId - Remote peer (unused; reserved for logging).
   * @param session - Local session.
   * @param payload - ICE payload from signaling.
   */
  private async handleIce(
    _peerId: string,
    session: PeerSession,
    payload: Extract<SignalPayload, { kind: "ice" }>,
  ): Promise<void> {
    const init: RTCIceCandidateInit = {
      candidate: payload.candidate,
      sdpMid: payload.sdpMid,
      sdpMLineIndex: payload.sdpMLineIndex ?? undefined,
    };
    if (!session.pc.remoteDescription) {
      session.pendingRemoteIce.push(init);
      return;
    }
    await session.pc.addIceCandidate(init);
  }

  /**
   * Flushes ICE candidates that arrived before remoteDescription was set.
   *
   * @param session - Peer session with optional queue.
   */
  private async flushPendingIce(session: PeerSession): Promise<void> {
    const q = session.pendingRemoteIce.splice(0, session.pendingRemoteIce.length);
    for (const c of q) {
      await session.pc.addIceCandidate(c);
    }
  }

  /**
   * Closes a peer session and removes it from the map.
   *
   * @param peerId - Peer to remove.
   */
  private async removePeer(peerId: string): Promise<void> {
    const session = this.peers.get(peerId);
    if (!session) return;
    session.channel?.close();
    session.pc.close();
    this.peers.delete(peerId);
    this.callbacks.onPeerDisconnected(peerId);
  }

  /**
   * Returns the joined client id or throws if `joinRoom` was not completed.
   */
  private requireClientId(): string {
    if (!this.clientId) {
      throw new Error("Not joined: call joinRoom before mesh operations.");
    }
    return this.clientId;
  }
}

/**
 * Generates a short random id for message envelopes.
 *
 * @returns Random hex string.
 */
function randomId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
