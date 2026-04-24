/**
 * @fileoverview Chat shell layout: sidebar (Everyone + peers), transcript, composer, status strip.
 * @module @textr/desktop/App
 */

import { useCallback, useMemo, useState } from "react";
import { useTextrMesh } from "./hooks/useTextrMesh.js";

/**
 * Root application UI for the Electron renderer.
 *
 * @returns React element for the full window layout.
 */
export function App(): JSX.Element {
  const mesh = useTextrMesh();
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState<"everyone" | string>("everyone");

  const peers = useMemo(() => mesh.peerIds.slice().sort(), [mesh.peerIds]);

  const banner = useMemo(() => {
    if (mesh.phase === "idle" && mesh.lastUrl === null && mesh.meshError === null) {
      return { tone: "neutral" as const, text: "Discovering LAN signaling…" };
    }
    if (mesh.phase === "connecting") {
      return { tone: "info" as const, text: "Connecting to room…" };
    }
    if (mesh.phase === "error" && mesh.meshError) {
      return { tone: "error" as const, text: mesh.meshError };
    }
    return null;
  }, [mesh.phase, mesh.lastUrl, mesh.meshError]);

  const onSend = useCallback(() => {
    if (!mesh.canUseMesh) return;
    const ok = mesh.sendLine(draft, target);
    if (ok) setDraft("");
  }, [draft, mesh, target]);

  return (
    <div className="textr-root">
      <header className="textr-toolbar" role="banner">
        <span>
          <strong>Textr</strong>
          <span style={{ marginLeft: "var(--space-3)", color: "var(--color-text-tertiary)" }}>
            {mesh.signalingLabel}
          </span>
        </span>
        <button type="button" className="textr-btn" onClick={() => void mesh.refresh()} disabled={!mesh.canUseMesh}>
          Refresh
        </button>
        <button type="button" className="textr-btn" onClick={() => void mesh.leaveSession()} disabled={!mesh.canUseMesh}>
          Leave
        </button>
      </header>

      {banner !== null ? (
        <div className="textr-banner" data-tone={banner.tone} role="status">
          {banner.text}
        </div>
      ) : null}

      <div className="textr-body">
        <aside className="textr-sidebar" aria-label="Threads and peers">
          <div className="textr-brand">Threads</div>
          <nav className="textr-roster">
            <button type="button" data-active={target === "everyone"} onClick={() => setTarget("everyone")}>
              Everyone
              <span className="textr-tag">broadcast</span>
            </button>
            {peers.length === 0 ? (
              <p className="textr-peer-id">No other peers yet</p>
            ) : (
              peers.map((id) => (
                <button key={id} type="button" data-active={target === id} onClick={() => setTarget(id)}>
                  {id}
                </button>
              ))
            )}
          </nav>
        </aside>

        <main className="textr-main">
          <div className="textr-toolbar" style={{ justifyContent: "space-between" }}>
            <span>
              Thread:{" "}
              <strong>{target === "everyone" ? "Everyone" : target}</strong>
              {mesh.selfId !== null ? (
                <span style={{ marginLeft: "var(--space-3)", color: "var(--color-text-tertiary)" }}>
                  You are <strong style={{ color: "var(--color-text-secondary)" }}>{mesh.selfId}</strong>
                </span>
              ) : null}
            </span>
          </div>

          <section className="textr-thread" aria-live="polite" aria-label="Messages">
            {mesh.lines.length === 0 ? (
              <p style={{ color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>
                No messages yet. Choose Everyone or a peer, type below, press Send.
              </p>
            ) : (
              mesh.lines.map((line) => (
                <article key={line.key} className="textr-line">
                  <div className="textr-line-meta">
                    {new Date(line.ts).toISOString()} · &lt;{line.from}&gt; ·{" "}
                    <span style={{ color: "var(--color-accent-400)" }}>{line.kind}</span>
                  </div>
                  <div className="textr-line-body">{line.body}</div>
                </article>
              ))
            )}
          </section>

          <footer className="textr-compose">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder={mesh.canUseMesh ? "Message… (Enter to send, Shift+Enter newline)" : "Waiting for mesh…"}
              disabled={!mesh.canUseMesh}
              aria-label="Message text"
            />
            <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "flex-end" }}>
              <button type="button" className="textr-btn textr-btn-primary" onClick={onSend} disabled={!mesh.canUseMesh}>
                Send
              </button>
            </div>
          </footer>
        </main>
      </div>

      {mesh.statusLog.length > 0 ? (
        <div
          style={{
            borderTop: "var(--border-thin) solid var(--color-border-subtle)",
            padding: "var(--space-3) var(--space-5)",
            fontSize: "var(--text-xs)",
            color: "var(--color-text-tertiary)",
            maxHeight: "7rem",
            overflow: "auto",
          }}
          aria-label="Connection log"
        >
          {mesh.statusLog.slice(-6).map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
