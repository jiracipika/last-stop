// Wardrobe/profile edits over the wire: nickname, uniform color (unique per
// crew), and headgear re-style in the lobby; the look locks once the shift
// is live. The web wardrobe UI lives on this act.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { bootServer, joinBot, joinExisting, sleep, waitFor, me, type Harness } from "./helpers.js";

let h: Harness;

beforeAll(async () => {
  h = await bootServer();
});

afterAll(async () => {
  await h.close();
});

describe("profile (wardrobe)", () => {
  it("renames and re-styles in the lobby, and the crew sees it live", async () => {
    const a = await joinBot(h, "Ada", { color: 0, hat: 0 });
    await waitFor("host in", () => a.room.state.players.size === 1);
    const b = await joinExisting(h, a.room.roomId, "Bob");
    await waitFor("both in", () => a.room.state.players.size === 2);

    b.room.send("act", { k: "profile", nick: "Bob the Hauler", color: 3, hat: 2 });
    await waitFor("bob re-styled", () => {
      const p = b.room.state.players.get(b.sid)!;
      return p.nick === "Bob the Hauler" && p.color === 3 && p.hat === 2;
    });
    // the host's replica agrees (schema patch), and the profile event carries
    // the full look — nick, color AND hat — for any consumer that wants it
    await waitFor("host sees bob", () => {
      const p = a.room.state.players.get(b.sid)!;
      return p.nick === "Bob the Hauler" && p.color === 3 && p.hat === 2;
    });
    expect(a.events.some((e) => e.t === "profile" && e.sid === b.sid && e.nick === "Bob the Hauler" && e.color === 3 && e.hat === 2)).toBe(true);

    // nickname rules: trimmed, capped at 16, never blanked (each act spaced
    // past the 0.15s profile rate limit so the limiter can't eat the case)
    await sleep(300);
    b.room.send("act", { k: "profile", nick: "0123456789abcdefg" }); // 17 chars -> capped
    await sleep(300);
    b.room.send("act", { k: "profile", nick: "   " }); // blank -> rejected by the guard
    await sleep(300);
    const p = b.room.state.players.get(b.sid)!;
    expect(p.nick).toBe("0123456789abcdef");
    expect(p.nick).not.toBe("");

    a.room.leave();
    b.room.leave();
    await sleep(200);
  }, 20000);

  it("rejects a uniform color another crew member already wears", async () => {
    const a = await joinBot(h, "Ada2", { color: 0 });
    await waitFor("host in", () => a.room.state.players.size === 1);
    const b = await joinExisting(h, a.room.roomId, "Bob2");
    await waitFor("both in", () => a.room.state.players.size === 2);

    b.room.send("act", { k: "profile", color: 0 }); // Ada's color
    await sleep(600);
    expect(b.room.state.players.get(b.sid)!.color).not.toBe(0);
    // ...but a free color lands
    b.room.send("act", { k: "profile", color: 5 });
    await waitFor("free color lands", () => b.room.state.players.get(b.sid)!.color === 5);

    a.room.leave();
    b.room.leave();
    await sleep(200);
  }, 20000);

  it("locks the look once the shift is live", async () => {
    const a = await joinBot(h, "Solo");
    await waitFor("host in", () => a.room.state.players.size === 1);
    const before = { nick: me(a).nick, color: me(a).color, hat: me(a).hat };
    a.room.send("act", { k: "ready" });
    await waitFor("ready", () => me(a).ready === true);
    a.room.send("act", { k: "start" });
    await waitFor("shift live", () => ["briefing", "arrive", "scavenge"].includes(a.room.state.phase));

    a.room.send("act", { k: "profile", nick: "Cheater", color: 7, hat: 4 });
    await sleep(700);
    const p = me(a);
    expect(p.nick).toBe(before.nick);
    expect(p.color).toBe(before.color);
    expect(p.hat).toBe(before.hat);

    a.room.leave();
    await sleep(200);
  }, 20000);

  it("profile events fire for the acting client too (wardrobe echo)", async () => {
    const a = await joinBot(h, "Echo");
    await waitFor("host in", () => a.room.state.players.size === 1);
    a.room.send("act", { k: "profile", hat: 3 });
    await waitFor("hat lands", () => me(a).hat === 3);
    expect(a.events.some((e) => e.t === "profile" && e.hat === 3)).toBe(true);
    a.room.leave();
    await sleep(200);
  }, 20000);
});
