/**
 * @fileoverview Plan B browser chat shell: join/leave, sidebar threads (Everyone, DMs, groups),
 * transcript + composer, and connection status. Wires `MeshCoordinator` + `HttpSignalingClient`.
 * @module apps/web/chat-shell
 */

import {
  HttpSignalingClient,
  LAN_DEFAULT_ROOM,
  MeshCoordinator,
  type ChatEnvelope,
} from "@textapp/core";
import { createBrowserPeerConnection } from "./adapters/browser-peer-connection.js";
import { escapeHtml } from "./lib/escape-html.js";

/** One rendered line in a thread transcript (outbound or inbound). */
type ChatLine = {
  id: string;
  from: string;
  body: string;
  ts: number;
};

/** Client-side group definition (subset of roster). */
type LocalGroup = {
  id: string;
  name: string;
  /** Remote peer ids in the group (excludes self). */
  peerIds: string[];
};

const POLL_MS = 500;
const EVERYONE_KEY = "everyone";

/**
 * Resolves signaling base URL from Vite env or same-origin.
 *
 * @returns Normalized origin/base URL without trailing slash.
 */
export function resolveSignalingBaseUrl(): string {
  const raw = import.meta.env.VITE_SIGNALING_BASE_URL as string | undefined;
  if (raw !== undefined && raw.trim() !== "") {
    return raw.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined") {
    return window.location.origin.replace(/\/+$/, "");
  }
  return "";
}

/**
 * Builds the stable thread key for an inbound envelope.
 *
 * @param env - Parsed chat envelope from the mesh.
 * @param selfId - This tab's signaling client id.
 * @param knownGroupIds - Group ids the user has created or that exist locally.
 * @returns Thread key, or null when the message is not addressed to this client.
 */
export function threadKeyForIncoming(
  env: ChatEnvelope,
  selfId: string,
  knownGroupIds: ReadonlySet<string>,
): string | null {
  if (env.to === null) {
    return EVERYONE_KEY;
  }
  if (env.to !== selfId) {
    return null;
  }
  if (env.groupId !== undefined && knownGroupIds.has(env.groupId)) {
    return `group:${env.groupId}`;
  }
  return `dm:${env.from}`;
}

/**
 * Orchestrates DOM, mesh lifecycle, and per-thread message routing for the web client.
 */
export class ChatShell {
  private root: HTMLElement | null = null;
  private mesh: MeshCoordinator | null = null;
  private signaling: HttpSignalingClient | null = null;
  private joined = false;
  private joinBusy = false;
  private selfId: string | null = null;
  private selectedKey = EVERYONE_KEY;
  private readonly messages = new Map<string, ChatLine[]>();
  private readonly groups = new Map<string, LocalGroup>();
  private lastErrors: string[] = [];
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Attaches the shell to a host element and performs the first render.
   *
   * @param host - Mount point (typically `#root`).
   */
  mount(host: HTMLElement): void {
    this.root = host;
    this.ensureThread(EVERYONE_KEY);
    this.render();
  }

  /**
   * Renders the full UI from current state (prejoin vs shell).
   */
  private render(): void {
    if (!this.root) return;
    if (!this.joined) {
      this.root.innerHTML = this.buildPrejoinMarkup();
      this.wirePrejoin();
      return;
    }
    this.root.innerHTML = this.buildShellMarkup();
    this.wireShell();
  }

  /**
   * Produces static HTML for the landing / join screen.
   *
   * @returns HTML string (values escaped where dynamic).
   */
  private buildPrejoinMarkup(): string {
    const base = escapeHtml(resolveSignalingBaseUrl());
    return `
      <div class="app-root">
        <div class="prejoin">
          <h1>Textapp</h1>
          <p>Join the mesh on the default room. You need a reachable signaling server (same origin or <code>VITE_SIGNALING_BASE_URL</code> at build time).</p>
          <p class="signaling-hint">Signaling: <strong>${base}</strong></p>
          <div class="prejoin-actions">
            <button type="button" class="btn btn-primary" data-action="join">Join session</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Binds join handlers on the prejoin screen.
   */
  private wirePrejoin(): void {
    if (!this.root) return;
    const joinBtn = this.root.querySelector<HTMLButtonElement>('[data-action="join"]');
    joinBtn?.addEventListener("click", () => {
      void this.joinSession();
    });
  }

  /**
   * Joins signaling + mesh with `LAN_DEFAULT_ROOM` and starts polling.
   */
  private async joinSession(): Promise<void> {
    if (this.joinBusy || this.joined) return;
    this.joinBusy = true;
    this.lastErrors = [];
    const base = resolveSignalingBaseUrl();
    try {
      this.signaling = new HttpSignalingClient(base);
      this.mesh = new MeshCoordinator({
        createPeerConnection: createBrowserPeerConnection,
        signaling: this.signaling,
        callbacks: {
          onChatMessage: (env) => this.handleIncoming(env),
          onPeerConnected: () => this.render(),
          onPeerDisconnected: () => this.render(),
          onError: (msg) => this.pushError(msg),
        },
      });
      const id = await this.mesh.joinRoom(LAN_DEFAULT_ROOM);
      this.selfId = id;
      this.joined = true;
      this.mesh.startPolling(POLL_MS);
      this.render();
    } catch (e) {
      this.pushError(e instanceof Error ? e.message : String(e));
      this.mesh?.stopPolling();
      this.mesh = null;
      this.signaling = null;
      this.selfId = null;
      this.joined = false;
      this.render();
    } finally {
      this.joinBusy = false;
    }
  }

  /**
   * Leaves the mesh, stops polling, and returns to the prejoin screen.
   */
  private async leaveSession(): Promise<void> {
    if (!this.mesh) {
      this.joined = false;
      this.selfId = null;
      this.render();
      return;
    }
    try {
      await this.mesh.leave();
    } catch {
      /* best-effort */
    }
    this.mesh.stopPolling();
    this.mesh = null;
    this.signaling = null;
    this.selfId = null;
    this.joined = false;
    this.render();
  }

  /**
   * Routes an inbound envelope into the correct thread and re-renders the transcript if needed.
   *
   * @param env - Parsed envelope from a data channel.
   */
  private handleIncoming(env: ChatEnvelope): void {
    const self = this.selfId;
    if (!self) return;
    const key = threadKeyForIncoming(env, self, new Set(this.groups.keys()));
    if (key === null) return;
    this.ensureThread(key);
    this.appendLine(key, {
      id: env.id,
      from: env.from,
      body: env.body,
      ts: env.ts,
    });
    this.refreshTranscriptIfVisible();
  }

  /**
   * Ensures a thread key has a message bucket.
   *
   * @param key - Thread key (`everyone`, `dm:…`, `group:…`).
   */
  private ensureThread(key: string): void {
    if (!this.messages.has(key)) {
      this.messages.set(key, []);
    }
  }

  /**
   * Appends a chat line if it is not already present (dedupes by message id per thread).
   *
   * @param key - Thread key.
   * @param line - Line to append.
   */
  private appendLine(key: string, line: ChatLine): void {
    const bucket = this.messages.get(key) ?? [];
    if (bucket.some((l) => l.id === line.id)) return;
    bucket.push(line);
    bucket.sort((a, b) => a.ts - b.ts);
    this.messages.set(key, bucket);
  }

  /**
   * Surfaces a transient error banner and remembers recent errors for the status strip.
   *
   * @param msg - Human-readable error text.
   */
  private pushError(msg: string): void {
    this.lastErrors = [...this.lastErrors, msg].slice(-6);
    if (this.bannerTimer !== null) {
      clearTimeout(this.bannerTimer);
    }
    if (!this.root || !this.joined) return;
    const existing = this.root.querySelector("[data-banner]");
    if (existing) {
      existing.remove();
    }
    const banner = document.createElement("div");
    banner.dataset.banner = "1";
    banner.className = "banner banner--error";
    banner.textContent = msg;
    const shell = this.root.querySelector(".shell");
    shell?.insertAdjacentElement("beforebegin", banner);
    this.bannerTimer = setTimeout(() => {
      banner.remove();
      this.bannerTimer = null;
    }, 8000);
    this.refreshStatusBar();
  }

  /**
   * Rebuilds only the transcript pane when it is mounted (avoids full shell flicker).
   */
  private refreshTranscriptIfVisible(): void {
    if (!this.root || !this.joined) return;
    const host = this.root.querySelector("[data-transcript]");
    if (!host) return;
    host.innerHTML = this.buildTranscriptInner();
  }

  /**
   * Rebuilds the status bar chips from mesh + recent errors.
   */
  private refreshStatusBar(): void {
    if (!this.root || !this.joined) return;
    const host = this.root.querySelector("[data-status]");
    if (!host) return;
    host.innerHTML = this.buildStatusInner();
  }

  /**
   * Produces the main two-pane markup for an active session.
   *
   * @returns HTML string for the chat shell.
   */
  private buildShellMarkup(): string {
    const self = this.selfId ?? "…";
    const peers = this.mesh?.getPeerIds() ?? [];
    const peerRows = [...peers]
      .sort((a, b) => a.localeCompare(b))
      .map((p) => this.buildPeerRow(p))
      .join("");
    const groupRows = [...this.groups.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => this.buildGroupRow(g))
      .join("");
    const everyoneActive = this.selectedKey === EVERYONE_KEY ? " thread-btn--active" : "";
    return `
      <div class="app-root">
        <div class="shell">
          <aside class="sidebar" aria-label="Conversations">
            <div class="sidebar-header">
              <h2>Threads</h2>
              <span class="peer-id">You: ${escapeHtml(self)}</span>
            </div>
            <nav class="thread-list">
              <button type="button" class="thread-btn${everyoneActive}" data-thread="${EVERYONE_KEY}">
                <span class="thread-btn__label">Everyone</span>
                <span class="thread-btn__meta">Room-wide broadcast</span>
              </button>
              ${peerRows}
              ${groupRows}
            </nav>
            <div class="sidebar-footer">
              <button type="button" class="btn btn-primary" data-action="new-group">New group…</button>
              <button type="button" class="btn btn-ghost" data-action="leave">Leave session</button>
            </div>
          </aside>
          <section class="main" aria-label="Active conversation">
            <div class="status-bar" data-status>${this.buildStatusInner()}</div>
            <div class="transcript" data-transcript>${this.buildTranscriptInner()}</div>
            <div class="composer">
              <div class="composer-row">
                <textarea data-composer-input rows="3" placeholder="Message…" aria-label="Message text"></textarea>
                <button type="button" class="btn btn-primary" data-action="send">Send</button>
              </div>
            </div>
          </section>
        </div>
      </div>
      <dialog data-group-dialog>
        <form method="dialog" class="dialog-surface" data-group-form>
          <h3>New group</h3>
          <p style="font-size: var(--text-sm); color: var(--color-text-secondary); margin-bottom: var(--space-3);">
            Pick at least two other members. Messages fan out as direct sends tagged with this group.
          </p>
          <div class="group-form">
            <label for="group-name">Name</label>
            <input id="group-name" name="name" type="text" required autocomplete="off" />
            <div class="peer-pick" data-peer-picks></div>
          </div>
          <div class="dialog-actions">
            <button type="button" class="btn btn-ghost" data-action="cancel-group">Cancel</button>
            <button type="submit" class="btn btn-primary">Create</button>
          </div>
        </form>
      </dialog>
    `;
  }

  /**
   * Builds a sidebar button for a direct thread.
   *
   * @param peerId - Remote peer signaling id.
   * @returns HTML string for the row.
   */
  private buildPeerRow(peerId: string): string {
    const key = `dm:${peerId}`;
    const active = this.selectedKey === key ? " thread-btn--active" : "";
    return `
      <button type="button" class="thread-btn${active}" data-thread="${escapeHtml(key)}">
        <span class="thread-btn__label">Direct</span>
        <span class="thread-btn__meta">${escapeHtml(peerId)}</span>
      </button>
    `;
  }

  /**
   * Builds a sidebar button for a local group thread.
   *
   * @param group - Local group metadata.
   * @returns HTML string for the row.
   */
  private buildGroupRow(group: LocalGroup): string {
    const key = `group:${group.id}`;
    const active = this.selectedKey === key ? " thread-btn--active" : "";
    const stale = group.peerIds.filter((id) => !(this.mesh?.getPeerIds() ?? []).includes(id));
    const meta =
      stale.length === 0
        ? `${group.peerIds.length} member(s)`
        : `${group.peerIds.length} member(s) · ${stale.length} away`;
    return `
      <button type="button" class="thread-btn${active}" data-thread="${escapeHtml(key)}">
        <span class="thread-btn__label">${escapeHtml(group.name)}</span>
        <span class="thread-btn__meta">${escapeHtml(meta)}</span>
      </button>
    `;
  }

  /**
   * Builds status chips for signaling connectivity and roster size.
   *
   * @returns HTML string for the status strip.
   */
  private buildStatusInner(): string {
    const peers = this.mesh?.getPeerIds() ?? [];
    const signalingState = this.joined ? "Signaling OK" : "Idle";
    const meshHint =
      peers.length === 0
        ? "No other peers yet — open another tab or text-app on the same URL."
        : `${peers.length} peer(s) in roster`;
    const err = this.lastErrors[this.lastErrors.length - 1];
    const errChip = err
      ? `<span class="status-pill status-pill--bad" title="${escapeHtml(err)}">Last issue</span>`
      : "";
    return `
      <span class="status-pill status-pill--ok">${escapeHtml(signalingState)}</span>
      <span class="status-pill">${escapeHtml(meshHint)}</span>
      ${errChip}
    `;
  }

  /**
   * Builds transcript HTML for the currently selected thread.
   *
   * @returns HTML string of messages.
   */
  private buildTranscriptInner(): string {
    const lines = this.messages.get(this.selectedKey) ?? [];
    const self = this.selfId ?? "";
    return lines
      .map((line) => {
        const mine = line.from === self;
        const cls = mine ? "msg msg--self" : "msg";
        const time = new Date(line.ts).toLocaleTimeString();
        return `
          <article class="${cls}">
            <div class="msg__meta">${escapeHtml(line.from)} · ${escapeHtml(time)}</div>
            <div class="msg__body">${escapeHtml(line.body)}</div>
          </article>
        `;
      })
      .join("");
  }

  /**
   * Binds shell controls: thread switch, send, leave, group dialog.
   */
  private wireShell(): void {
    if (!this.root || !this.mesh) return;
    this.root.querySelectorAll<HTMLButtonElement>("[data-thread]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.thread;
        if (!key) return;
        this.selectedKey = key;
        this.render();
      });
    });
    const sendBtn = this.root.querySelector<HTMLButtonElement>('[data-action="send"]');
    const ta = this.root.querySelector<HTMLTextAreaElement>("[data-composer-input]");
    sendBtn?.addEventListener("click", () => this.sendFromComposer(ta));
    ta?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        this.sendFromComposer(ta);
      }
    });
    this.root.querySelector<HTMLButtonElement>('[data-action="leave"]')?.addEventListener("click", () => {
      void this.leaveSession();
    });
    const dialog = this.root.querySelector<HTMLDialogElement>("[data-group-dialog]");
    const form = this.root.querySelector<HTMLFormElement>("[data-group-form]");
    this.root.querySelector<HTMLButtonElement>('[data-action="new-group"]')?.addEventListener("click", () => {
      this.populateGroupDialog();
      dialog?.showModal();
    });
    this.root.querySelector<HTMLButtonElement>('[data-action="cancel-group"]')?.addEventListener("click", () => {
      dialog?.close();
    });
    form?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const nameInput = form.querySelector<HTMLInputElement>("#group-name");
      const name = nameInput?.value.trim() ?? "";
      const picked = [...form.querySelectorAll<HTMLInputElement>('input[name="peer"]:checked')].map(
        (i) => i.value,
      );
      if (name.length === 0 || picked.length < 2) {
        this.pushError("Groups need a name and at least two other members.");
        return;
      }
      const id = globalThis.crypto.randomUUID();
      this.groups.set(id, { id, name, peerIds: picked });
      this.ensureThread(`group:${id}`);
      this.selectedKey = `group:${id}`;
      dialog?.close();
      this.render();
    });
  }

  /**
   * Fills the group dialog checkbox list from the current roster.
   */
  private populateGroupDialog(): void {
    if (!this.root) return;
    const host = this.root.querySelector("[data-peer-picks]");
    if (!host) return;
    const peers = this.mesh?.getPeerIds() ?? [];
    host.innerHTML = peers
      .sort((a, b) => a.localeCompare(b))
      .map(
        (p) => `
        <label>
          <input type="checkbox" name="peer" value="${escapeHtml(p)}" />
          <span>${escapeHtml(p)}</span>
        </label>
      `,
      )
      .join("");
    const nameInput = this.root.querySelector<HTMLInputElement>("#group-name");
    if (nameInput) nameInput.value = "";
  }

  /**
   * Sends the composer text using broadcast, direct, or group fan-out as appropriate.
   *
   * @param ta - Composer textarea (may be null).
   */
  private sendFromComposer(ta: HTMLTextAreaElement | null): void {
    if (!this.mesh || !this.selfId) return;
    const body = ta?.value.trim() ?? "";
    if (body.length === 0) return;
    const self = this.selfId;
    if (this.selectedKey === EVERYONE_KEY) {
      const n = this.mesh.broadcast(body);
      if (n > 0) {
        this.appendLocalLine(EVERYONE_KEY, body, self);
        if (ta) ta.value = "";
        this.refreshTranscriptIfVisible();
      }
      return;
    }
    if (this.selectedKey.startsWith("dm:")) {
      const peer = this.selectedKey.slice("dm:".length);
      if (this.mesh.sendDirect(peer, body)) {
        this.appendLocalLine(this.selectedKey, body, self);
        if (ta) ta.value = "";
        this.refreshTranscriptIfVisible();
      }
      return;
    }
    if (this.selectedKey.startsWith("group:")) {
      const gid = this.selectedKey.slice("group:".length);
      const group = this.groups.get(gid);
      if (!group) return;
      const { sent, messageId } = this.mesh.sendGroup(gid, group.peerIds, body);
      if (sent > 0 && messageId.length > 0) {
        this.appendLine(`group:${gid}`, { id: messageId, from: self, body, ts: Date.now() });
        if (ta) ta.value = "";
        this.refreshTranscriptIfVisible();
      }
    }
  }

  /**
   * Appends an outbound line the mesh does not echo back (broadcast / DM).
   *
   * @param key - Thread key.
   * @param body - Message body.
   * @param from - Sender id (self).
   */
  private appendLocalLine(key: string, body: string, from: string): void {
    this.ensureThread(key);
    this.appendLine(key, {
      id: globalThis.crypto.randomUUID(),
      from,
      body,
      ts: Date.now(),
    });
  }
}
