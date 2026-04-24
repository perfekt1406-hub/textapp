/**
 * @fileoverview Connects the renderer to `MeshCoordinator` after main resolves signaling,
 * handles migration IPC, chat lines, roster refresh, and graceful `leave` for window close.
 * @module @textr/desktop/hooks/useTextrMesh
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  HttpSignalingClient,
  LAN_DEFAULT_ROOM,
  MeshCoordinator,
  type ChatEnvelope,
} from "@textr/core";
import type { TextrSignalingEvent } from "../types.js";

const POLL_MS = 500;

/** One row in the thread transcript. */
export type ChatLine = {
  /** Stable React key. */
  key: string;
  /** UTC ms from envelope. */
  ts: number;
  /** Sender client id. */
  from: string;
  /** Message body. */
  body: string;
  /** Broadcast vs direct (from self's perspective). */
  kind: "broadcast" | "direct";
};

/**
 * Creates a browser `RTCPeerConnection` with the same STUN server as `apps/cli/src/main.ts`.
 *
 * @returns A new peer connection for the mesh.
 */
function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
}

export type MeshSessionState = {
  phase: "idle" | "connecting" | "joined" | "error";
  signalingMode: "hosting" | "joining" | null;
  lastUrl: string | null;
  selfId: string | null;
  peerIds: string[];
  lines: ChatLine[];
  meshError: string | null;
  statusLog: string[];
};

/**
 * Hooks LAN mesh behavior to React state for the chat shell.
 *
 * @returns Session state, derived ui flags, and actions (send, refresh, leave).
 */
export function useTextrMesh(): MeshSessionState & {
  signalingLabel: string;
  canUseMesh: boolean;
  sendLine: (text: string, target: "everyone" | string) => boolean;
  refresh: () => Promise<void>;
  leaveSession: () => Promise<void>;
} {
  const [session, setSession] = useState<MeshSessionState>({
    phase: "idle",
    signalingMode: null,
    lastUrl: null,
    selfId: null,
    peerIds: [],
    lines: [],
    meshError: null,
    statusLog: [],
  });

  const meshRef = useRef<MeshCoordinator | null>(null);
  const signalingUrlRef = useRef<string | null>(null);
  const [, rosterTick] = useReducer((n: number) => n + 1, 0);

  const pushStatus = useCallback((line: string) => {
    setSession((s) => ({
      ...s,
      statusLog: [...s.statusLog, `${new Date().toISOString()} ${line}`].slice(-40),
    }));
  }, []);

  const teardownMesh = useCallback(async (): Promise<void> => {
    const mesh = meshRef.current;
    meshRef.current = null;
    signalingUrlRef.current = null;
    if (!mesh) return;
    mesh.stopPolling();
    await mesh.leave().catch(() => {});
  }, []);

  const connectToUrl = useCallback(
    async (baseUrl: string, mode: "hosting" | "joining" | null): Promise<void> => {
      await teardownMesh();
      setSession((s) => ({
        ...s,
        phase: "connecting",
        signalingMode: mode,
        lastUrl: baseUrl,
        meshError: null,
        lines: [],
        selfId: null,
        peerIds: [],
      }));

      const signaling = new HttpSignalingClient(baseUrl);
      signalingUrlRef.current = baseUrl;

      const mesh = new MeshCoordinator({
        createPeerConnection,
        signaling,
        callbacks: {
          onChatMessage: (env: ChatEnvelope) => {
            const kind: "broadcast" | "direct" =
              env.to === null ? "broadcast" : "direct";
            setSession((prev) => ({
              ...prev,
              lines: [
                ...prev.lines,
                {
                  key: `${env.ts}-${env.from}-${Math.random().toString(36).slice(2)}`,
                  ts: env.ts,
                  from: env.from,
                  body: env.body,
                  kind,
                },
              ],
            }));
          },
          onPeerConnected: (peerId: string) => {
            pushStatus(`data channel open → ${peerId}`);
            rosterTick();
          },
          onPeerDisconnected: (peerId: string) => {
            pushStatus(`peer disconnected: ${peerId}`);
            rosterTick();
          },
          onError: (message: string) => {
            setSession((prev) => ({
              ...prev,
              meshError: message,
            }));
            pushStatus(`mesh error: ${message}`);
          },
        },
      });

      meshRef.current = mesh;

      try {
        const selfId = await mesh.joinRoom(LAN_DEFAULT_ROOM);
        mesh.startPolling(POLL_MS);
        setSession((prev) => ({
          ...prev,
          phase: "joined",
          selfId,
          peerIds: mesh.getPeerIds(),
          meshError: null,
        }));
        pushStatus(`joined room ${LAN_DEFAULT_ROOM} as ${selfId}`);
        rosterTick();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        meshRef.current = null;
        setSession((prev) => ({
          ...prev,
          phase: "error",
          meshError: message,
        }));
        pushStatus(`join failed: ${message}`);
      }
    },
    [pushStatus, teardownMesh],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.textr) return;

    const off = window.textr.onSignaling((ev: TextrSignalingEvent) => {
      if (ev.kind === "discovering") {
        setSession((s) => ({
          ...s,
          phase: "idle",
          signalingMode: null,
          lastUrl: null,
          meshError: null,
        }));
        return;
      }
      if (ev.kind === "error") {
        setSession((s) => ({
          ...s,
          phase: "error",
          meshError: ev.message,
        }));
        return;
      }
      if (ev.kind === "ready") {
        void connectToUrl(ev.url, ev.mode);
        return;
      }
      if (ev.kind === "migrate") {
        pushStatus(`LAN merge — reconnecting via ${ev.url}`);
        void connectToUrl(ev.url, "joining");
      }
    });

    return off;
  }, [connectToUrl, pushStatus]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.textr) return;
    return window.textr.onGracefulExit(async () => {
      await teardownMesh();
      setSession((s) => ({ ...s, phase: "idle", selfId: null, peerIds: [] }));
      await window.textr.finishExit();
    });
  }, [teardownMesh]);

  const refresh = useCallback(async () => {
    const mesh = meshRef.current;
    if (!mesh) return;
    try {
      await mesh.tick();
      setSession((s) => ({ ...s, peerIds: mesh.getPeerIds() }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setSession((s) => ({ ...s, meshError: message }));
    }
  }, []);

  const leaveSession = useCallback(async () => {
    await teardownMesh();
    setSession((s) => ({
      ...s,
      phase: "idle",
      selfId: null,
      peerIds: [],
      meshError: null,
    }));
    pushStatus("left room");
  }, [pushStatus, teardownMesh]);

  const sendLine = useCallback(
    (text: string, target: "everyone" | string): boolean => {
      const mesh = meshRef.current;
      if (!mesh || session.phase !== "joined") return false;
      const trimmed = text.trim();
      if (trimmed === "") return false;
      if (target === "everyone") {
        mesh.broadcast(trimmed);
        return true;
      }
      return mesh.sendDirect(target, trimmed);
    },
    [session.phase],
  );

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || session.phase !== "joined") return;
    setSession((s) => ({ ...s, peerIds: mesh.getPeerIds() }));
  }, [session.phase, rosterTick]);

  const signalingLabel =
    session.lastUrl === null
      ? "Discovering signaling…"
      : `${session.lastUrl} (${session.signalingMode ?? "client"})`;

  const canUseMesh = session.phase === "joined" && meshRef.current !== null;

  return {
    ...session,
    signalingLabel,
    canUseMesh,
    sendLine,
    refresh,
    leaveSession,
  };
}
