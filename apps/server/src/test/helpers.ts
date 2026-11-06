// Test helpers: boot a real Colyseus server on an ephemeral port and drive
// real SDK clients. Bots walk the actual nav graph and open doors, the same
// way a player would.
import http from "node:http";
import express from "express";
import { defineServer, defineRoom, type Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client as SDKClient, type Room } from "@colyseus/sdk";
import { GameRoom } from "../rooms/GameRoom.js";
import {
  NAV_NODES, NAV_INDEX, navPath, nearestNavNode, doorAabb, DOORS,
  segHitsAabb, dist2d, RoomState,
} from "@last-stop/shared";

export interface Harness {
  server: Server;
  httpServer: http.Server;
  port: number;
  url: string;
  close(): Promise<void>;
}

export async function bootServer(): Promise<Harness> {
  process.env.LS_TEST_MODE = "1";
  process.env.LS_DISABLE_ENEMY = "1";
  const app = express();
  const httpServer = http.createServer(app);
  const server = defineServer({
    transport: new WebSocketTransport({ server: httpServer }),
    rooms: { game: defineRoom(GameRoom) },
  });
  await server.listen(0, "127.0.0.1");
  const port = (httpServer.address() as { port: number }).port;
  return {
    server,
    httpServer,
    port,
    url: `ws://127.0.0.1:${port}`,
    async close() {
      await server.gracefullyShutdown(false);
      await new Promise<void>((r) => httpServer.close(() => r()));
    },
  };
}

export interface Bot {
  client: SDKClient;
  room: Room<RoomState>;
  sid: string;
  stop(): void;
  events: { t: string; [k: string]: unknown }[];
}

export async function joinBot(h: Harness, nick: string, opts: Record<string, unknown> = {}): Promise<Bot> {
  const client = new SDKClient(h.url);
  const room = (await client.create("game", { nick, ...opts }, RoomState)) as unknown as Room<RoomState>;
  const events: { t: string; [k: string]: unknown }[] = [];
  room.onMessage("ev", (msg) => events.push(msg as { t: string }));
  return { client, room, sid: room.sessionId, stop: () => void 0, events };
}

export async function joinExisting(h: Harness, roomId: string, nick: string): Promise<Bot> {
  const client = new SDKClient(h.url);
  const room = (await client.joinById(roomId, { nick }, RoomState)) as unknown as Room<RoomState>;
  const events: { t: string; [k: string]: unknown }[] = [];
  room.onMessage("ev", (msg) => events.push(msg as { t: string }));
  return { client, room, sid: room.sessionId, stop: () => void 0, events };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(desc: string, fn: () => boolean, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for: ${desc}`);
    await sleep(100);
  }
}

export function me(bot: Bot) {
  return bot.room.state.players.get(bot.sid)!;
}

/**
 * Walk a bot to a world position using the nav graph. Sends real movement
 * inputs; opens closed doors that block the next edge.
 */
export async function walkTo(bot: Bot, tx: number, tz: number, tolerance = 1.0, maxMs = 30000): Promise<void> {
  const room = bot.room;
  const path = computePath(bot, tx, tz);
  const waypoints: { x: number; z: number }[] = path.map((i) => ({ x: NAV_NODES[i]!.x, z: NAV_NODES[i]!.z }));
  waypoints.push({ x: tx, z: tz });

  const start = Date.now();
  let wpI = 0;
  let lastSend = 0;
  let doorCd = 0;
  let stuckCheck = { x: 0, z: 0, at: Date.now(), side: 1 };
  let sidestepUntil = 0;
  let sidestepDir = { x: 0, z: 0 };
  while (wpI < waypoints.length) {
    if (Date.now() - start > maxMs) throw new Error(`walkTo timeout to (${tx},${tz}) stuck at wp ${wpI}`);
    const p = me(bot);
    let wp = waypoints[wpI]!;
    // unstick: if we haven't moved for a while, sidestep perpendicular
    if (Date.now() - stuckCheck.at > 1200) {
      const moved = dist2d(p.x, p.z, stuckCheck.x, stuckCheck.z);
      if (moved < 0.25 && wpI > 0) {
        const dx = wp.x - p.x;
        const dz = wp.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        stuckCheck.side *= -1;
        sidestepDir = { x: (-dz / len) * stuckCheck.side * 2.2, z: (dx / len) * stuckCheck.side * 2.2 };
        sidestepUntil = Date.now() + 1200;
      }
      stuckCheck = { x: p.x, z: p.z, at: Date.now(), side: stuckCheck.side };
    }
    const sidestepping = Date.now() < sidestepUntil;
    if (sidestepping) {
      wp = { x: p.x + sidestepDir.x, z: p.z + sidestepDir.z };
    }
    const d = dist2d(p.x, p.z, wp.x, wp.z);
    if (!sidestepping && d < (wpI === waypoints.length - 1 ? tolerance : 0.9)) {
      wpI++;
      continue;
    }
    // open a closed door on the next segment
    const segEnd = waypoints[Math.min(wpI + 1, waypoints.length - 1)]!;
    for (const doorDef of DOORS) {
      const ds = room.state.doors.get(doorDef.id);
      if (!ds || ds.open) continue;
      const a = doorAabb(doorDef);
      const cx = (a.x0 + a.x1) / 2;
      const cz = (a.z0 + a.z1) / 2;
      if (dist2d(p.x, p.z, cx, cz) < 2.2 && (segHitsAabb(p.x, p.z, wp.x, wp.z, a) || segHitsAabb(p.x, p.z, segEnd.x, segEnd.z, a) || dist2d(wp.x, wp.z, cx, cz) < 1.4)) {
        if (doorCd <= 0) {
          room.send("act", { k: "door", id: doorDef.id });
          doorCd = 1.2;
          await sleep(350);
        }
      }
    }
    doorCd -= 0.1;
    // steer toward the waypoint (invert the server's local->world rotation:
    // wx = mz·sin − mx·cos, wz = mz·cos + mx·sin)
    const yaw = Math.atan2(wp.x - p.x, wp.z - p.z);
    const dx = wp.x - p.x;
    const dz = wp.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const wx = dx / len;
    const wz = dz / len;
    const mx = -wx * Math.cos(yaw) + wz * Math.sin(yaw);
    const mz = wx * Math.sin(yaw) + wz * Math.cos(yaw);
    if (Date.now() - lastSend > 50) {
      room.send("in", { mx, mz, yaw, sprint: false, seq: (Date.now() & 0xffffff) });
      lastSend = Date.now();
    }
    await sleep(100);
  }
  room.send("in", { mx: 0, mz: 0, yaw: me(bot).yaw, sprint: false });
  // settle: the stop-slide coasts up to ~0.4 m after input releases, so
  // proximity checks right after walkTo would race the drift — wait until
  // the bot's position is stable before handing control back
  const settleStart = Date.now();
  let last = { ...me(bot) };
  let stableSince = Date.now();
  while (Date.now() - settleStart < 1500) {
    await sleep(120);
    const now = me(bot);
    if (dist2d(now.x, now.z, last.x, last.z) < 0.02) {
      if (Date.now() - stableSince > 240) return;
    } else {
      stableSince = Date.now();
    }
    last = now;
  }
}

function computePath(bot: Bot, tx: number, tz: number): number[] {
  const p = me(bot);
  return navPath(nearestNavNode(p.x, p.z), nearestNavNode(tx, tz));
}

/** Wait until a bot is carrying something (after sending grab). */
export async function grabNearestItem(bot: Bot, itemId: string): Promise<boolean> {
  bot.room.send("act", { k: "grab", id: itemId });
  await sleep(300);
  return me(bot).carrying === itemId;
}

export function findItemByDef(bot: Bot, defId: string): string | undefined {
  for (const [id, it] of bot.room.state.items) {
    if (it.defId === defId) return id;
  }
  return undefined;
}

export function stateOf(bot: Bot): RoomState {
  return bot.room.state;
}
void NAV_INDEX;
