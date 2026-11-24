// Room-cap hardening for public hosting: the process refuses more than
// LS_MAX_ROOMS concurrent rooms and frees the slot when a room disposes.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@colyseus/sdk";
import { RoomState } from "@last-stop/shared";
import { bootServer, sleep, type Harness } from "./helpers.js";

let h: Harness;

beforeAll(async () => {
  process.env.LS_MAX_ROOMS = "2";
  h = await bootServer();
});

afterAll(async () => {
  delete process.env.LS_MAX_ROOMS;
  await h.close();
});

describe("room capacity", () => {
  it("rejects rooms beyond the cap and reuses the slot after dispose", async () => {
    const a = new Client(h.url);
    const b = new Client(h.url);
    const c = new Client(h.url);
    const r1 = await a.create("game", { nick: "A", code: "AAAAA" }, RoomState);
    // A rejected duplicate must not count against the remaining slot.
    await expect(b.create("game", { nick: "B", code: "AAAAA" }, RoomState)).rejects.toThrow(/already exists/);
    const r2 = await b.create("game", { nick: "B", code: "BBBBB" }, RoomState);
    expect(r1.roomId).toBe("LSAAAAA");
    expect(r2.roomId).toBe("LSBBBBB");

    let capped = false;
    try {
      await c.create("game", { nick: "C", code: "CCCCC" }, RoomState);
    } catch {
      capped = true;
    }
    expect(capped).toBe(true);

    // free a slot; creation works again
    r1.leave();
    await sleep(1200); // auto-dispose of the empty room
    const r3 = await c.create("game", { nick: "C", code: "CCCCC" }, RoomState);
    expect(r3.roomId).toBe("LSCCCCC");
    r2.leave();
    r3.leave();
    await sleep(300);
  }, 30000);
});
