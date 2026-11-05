// Room-code collisions: a second room with the same LS<CODE> id must fail
// loudly (the client retries with a fresh code), never silently duplicate.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@colyseus/sdk";
import { RoomState } from "@last-stop/shared";
import { bootServer, sleep, type Harness } from "./helpers.js";

let h: Harness;

beforeAll(async () => {
  h = await bootServer();
});

afterAll(async () => {
  await h.close();
});

describe("room codes", () => {
  it("rejects a duplicate code instead of creating two rooms with the same id", async () => {
    const a = new Client(h.url);
    const first = await a.create("game", { nick: "A", code: "ZZZZZ" }, RoomState);
    expect(first.roomId).toBe("LSZZZZZ");

    const b = new Client(h.url);
    let duplicateAccepted = false;
    let err = "";
    try {
      await b.create("game", { nick: "B", code: "ZZZZZ" }, RoomState);
      duplicateAccepted = true;
    } catch (e) {
      err = String(e);
    }
    // either outcome must not produce a silently ambiguous room: if the
    // duplicate was accepted, both rooms share an id and joins are a coin
    // flip — that is a bug.
    expect(duplicateAccepted).toBe(false);
    expect(err).toBeTruthy();
    first.leave();
    await sleep(200);
  }, 20000);
});
