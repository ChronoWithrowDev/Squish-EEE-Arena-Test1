/**
 * LAN multiplayer for SQUISH-EEE ARENA.
 *
 * Architecture (the "lobby" approach):
 *
 *   ┌─────────────┐   WebRTC data channel (peer-to-peer, UDP)   ┌─────────────┐
 *   │ Host browser │ ◄──────────────────────────────────────────► │ Client browser│
 *   │ (authoritative sim)   gameplay: snapshots + inputs          │  (renders snapshots)│
 *   └────────────┘                                               └──────┬──────┘
 *          │  HTTP: lobby presence + WebRTC offer/answer/ICE bootstrap  │
 *          ▼                                                            ▼
 *        ┌───────────────────────────────────────────────────────────────┐
 *        │  node server.mjs  (zero-dep LAN lobby + signalling, port 4870) │
 *        └───────────────────────────────────────────────────────────────┘
 *
 * The tiny server only bootstraps the WebRTC handshake and shows who's in the
 * lobby. Once connected, ALL gameplay streams directly between browsers, so
 * the server is out of the latency path. On a LAN the WebRTC connection is a
 * direct UDP socket with no STUN/TURN needed.
 */

export type PeerId = string;

export type LobbySlot = {
  peer: PeerId; // "host", a client id, or "bot"
  name: string;
  kind: string;
  team: "red" | "blue";
  bot: boolean;
  ready: boolean;
  isHost: boolean;
};

export type LobbyPeer = {
  peer: PeerId;
  name: string;
  kind: string;
  role: "host" | "client";
};

// The engine treats the wire payloads as opaque; these keep imports tidy.
export type ActorSnap = any;
export type NetEvent = any;
export type Snapshot = any;
export type NetMsg = any;

/** A gameplay start packet the host broadcasts once the match is ready. */
export type StartConfig = {
  mapId: string;
  mode: string;
  seed: number;
  roster: LobbySlot[];
  botCount: number;
};

interface NetOpts {
  role: "host" | "client";
  server: string; // e.g. "http://192.168.1.4:4870"
  room: string;
  peerId: PeerId; // "host" or a client id
  name: string;
  kind: string;
  onLobby?: (peers: LobbyPeer[]) => void;
  onStart?: (cfg: StartConfig) => void;
  onReady?: (open: number, total: number) => void;
  onClosed?: (peer: PeerId) => void;
  onMsg?: (from: PeerId | "host", m: NetMsg) => void;
  onSignal?: (err: string) => void;
}

const base = (s: string) => s.replace(/\/$/, "");

export class Net {
  role: "host" | "client";
  server: string;
  room: string;
  peerId: PeerId;
  name: string;
  kind: string;

  pcs = new Map<PeerId, RTCPeerConnection>();
  chans = new Map<PeerId, RTCDataChannel>();
  private iceBuf = new Map<PeerId, RTCIceCandidateInit[]>();
  private pcState = new Map<PeerId, "none" | "offered" | "answered">();

  private pollToken = 0;
  private closed = false;
  private gotRemote = new Map<PeerId, boolean>();

  onLobby: NetOpts["onLobby"];
  onStart: NetOpts["onStart"];
  onReady: NetOpts["onReady"];
  onClosed: NetOpts["onClosed"];
  onMsg: NetOpts["onMsg"];
  onSignal: NetOpts["onSignal"];

  constructor(o: NetOpts) {
    this.role = o.role;
    this.server = base(o.server);
    this.room = o.room;
    this.peerId = o.peerId;
    this.name = o.name;
    this.kind = o.kind;
    this.onLobby = o.onLobby;
    this.onStart = o.onStart;
    this.onReady = o.onReady;
    this.onClosed = o.onClosed;
    this.onMsg = o.onMsg;
    this.onSignal = o.onSignal;
  }

  get clientIds() {
    return [...this.pcs.keys()];
  }
  get openCount() {
    return [...this.chans.values()].filter((c) => c.readyState === "open").length;
  }

  // ------------------------------------------------------------------ setup
  async join(): Promise<void> {
    await this.http("/join", { room: this.room, peer: this.peerId, name: this.name, kind: this.kind });
    if (this.role === "client") await this.clientOffer();
    this.startPolling();
  }

  /** Client initiates WebRTC: creates the data channel and sends the offer. */
  private async clientOffer() {
    const pc = new RTCPeerConnection();
    this.pcs.set("host", pc);
    const dc = pc.createDataChannel("squish", { ordered: true });
    this.wireChannel("host", dc);
    this.iceBuf.set("host", []);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal("host", { type: "ice", candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this.onClosed?.("host");
    };
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.pcState.set("host", "offered");
      this.sendSignal("host", { type: "offer", sdp: pc.localDescription });
    } catch (e) {
      this.onSignal?.("Could not create WebRTC offer: " + (e as Error).message);
    }
  }

  // --------------------------------------------------------------- signalling
  private async http(path: string, body?: any, poll = false) {
    const method = poll ? "GET" : "POST";
    const res = await fetch(`${this.server}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" && body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`lobby ${path} -> ${res.status}`);
    return res.json();
  }

  private startPolling() {
    const token = ++this.pollToken;
    const loop = async () => {
      if (this.closed || token !== this.pollToken) return;
      try {
        const out = await this.http(`/poll?room=${encodeURIComponent(this.room)}&peer=${encodeURIComponent(this.peerId)}`, undefined, true);
        if (this.closed || token !== this.pollToken) return;
        if (out.type === "presence") {
          this.onLobby?.(out.peers);
        } else if (out.type === "msg") {
          this.handleData(out.from, out.data);
        }
      } catch {
        // network blip — wait a beat and retry
        if (this.closed || token !== this.pollToken) return;
        await new Promise((r) => setTimeout(r, 700));
      }
      if (!this.closed && token === this.pollToken) loop();
    };
    loop();
  }

  /** Send a lobby-level signal (offer/answer/ice/start) to a specific peer or everyone. */
  sendSignal(to: PeerId | "*", data: any) {
    void this.http("/msg", { room: this.room, from: this.peerId, to, data });
  }

  private handleData(from: PeerId, data: any) {
    if (!data) return;
    switch (data.type) {
      case "presence":
        this.onLobby?.(data.peers);
        break;
      case "start":
        this.onStart?.(data.config as StartConfig);
        break;
      case "offer":
        this.hostOnOffer(from, data.sdp);
        break;
      case "answer":
        this.onAnswer(from, data.sdp);
        break;
      case "ice":
        this.onIce(from, data.candidate);
        break;
      default:
        // gameplay message
        this.onMsg?.(from, data);
    }
  }

  // ---- WebRTC glue
  private wireChannel(peer: PeerId, dc: RTCDataChannel) {
    this.chans.set(peer, dc);
    dc.onopen = () => {
      const total = this.role === "host" ? this.pcs.size : 1;
      this.onReady?.(this.openCount, total);
    };
    dc.onclose = () => {
      this.onClosed?.(peer);
    };
    dc.onmessage = (e) => {
      let m: NetMsg;
      try {
        m = JSON.parse(e.data as string);
      } catch {
        return;
      }
      this.onMsg?.(peer === "host" ? "host" : peer, m);
    };
  }

  private async hostOnOffer(client: PeerId, sdp: RTCSessionDescriptionInit) {
    try {
      let pc = this.pcs.get(client);
      if (!pc) {
        pc = new RTCPeerConnection();
        pc.ondatachannel = (e) => this.wireChannel(client, e.channel);
        pc.onicecandidate = (e) => {
          if (e.candidate) this.sendSignal(client, { type: "ice", candidate: e.candidate });
        };
        pc.onconnectionstatechange = () => {
          if (pc!.connectionState === "failed" || pc!.connectionState === "closed") this.onClosed?.(client);
        };
        this.pcs.set(client, pc);
        this.iceBuf.set(client, []);
        this.pcState.set(client, "none");
      }
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      this.gotRemote.set(client, true);
      const buffered = this.iceBuf.get(client) || [];
      this.iceBuf.set(client, []);
      for (const c of buffered) await pc.addIceCandidate(c).catch(() => {});
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.pcState.set(client, "answered");
      this.sendSignal(client, { type: "answer", sdp: pc.localDescription });
    } catch (e) {
      this.onSignal?.("WebRTC handshake error: " + (e as Error).message);
    }
  }

  private async onAnswer(from: PeerId, sdp: RTCSessionDescriptionInit) {
    const pc = this.pcs.get(from);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      this.gotRemote.set(from, true);
    } catch (e) {
      this.onSignal?.("Answer error: " + (e as Error).message);
    }
  }

  private async onIce(from: PeerId, candidate: RTCIceCandidateInit) {
    const pc = this.pcs.get(from);
    if (!pc) return;
    if (!this.gotRemote.get(from)) {
      const buf = this.iceBuf.get(from) || [];
      buf.push(candidate);
      this.iceBuf.set(from, buf);
      return;
    }
    await pc.addIceCandidate(candidate).catch(() => {});
  }

  // ---------------------------------------------------------------- gameplay
  /** Send a gameplay message (snapshot / inputs / events) over the data channel. */
  send(m: NetMsg, _to?: PeerId, _reliable?: boolean) {
    const payload = JSON.stringify(m);
    for (const [peer, dc] of this.chans) {
      if (dc.readyState !== "open") continue;
      if (this.role === "host" && _to && _to !== "*" && _to !== peer) continue;
      try {
        dc.send(payload);
      } catch {
        // channel buffer full — the next snapshot resyncs state, so dropping is fine
      }
    }
  }

  close() {
    this.closed = true;
    this.pollToken++;
    void this.http("/leave", { peer: this.peerId }).catch(() => {});
    for (const pc of this.pcs.values()) {
      try {
        pc.close();
      } catch {
        /* noop */
      }
    }
    for (const dc of this.chans.values()) {
      try {
        dc.close();
      } catch {
        /* noop */
      }
    }
    this.pcs.clear();
    this.chans.clear();
  }
}

/** A short room code, e.g. "SQUISH-1234". */
export function makeRoomCode(prefix = "PLAY") {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${n}`;
}

/** A unique-enough client peer id for this browser tab. */
export function makeClientId() {
  return "c-" + Math.random().toString(36).slice(2, 6) + Date.now().toString(36).slice(-3);
}

/** Guess a sensible default server URL from the current page host. */
export function guessServer() {
  if (typeof window === "undefined") return "http://192.168.1.1:4870";
  if (window.location.hostname && window.location.protocol.startsWith("http")) {
    return `${window.location.protocol}//${window.location.hostname}:4870`;
  }
  return "http://192.168.1.1:4870";
}
