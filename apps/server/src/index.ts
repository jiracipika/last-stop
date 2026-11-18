// The WebSocket transport multiplexes matchmaking and health routes on one
// HTTP handler. Register health routes through its Express callback so the
// production bundle does not depend on Express's function name for routing.
import { defineServer, defineRoom, Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./rooms/GameRoom.js";

const PORT = Number(process.env.PORT ?? 2567);
const HOST = process.env.HOST ?? "0.0.0.0";

const gameServer = defineServer({
  transport: new WebSocketTransport(),
  express(app) {
    app.get("/", (_req, res) => {
      res.json({ ok: true, game: "LAST STOP", version: "0.1.0" });
    });
    app.get("/health", (_req, res) => {
      res.json({ ok: true, uptime: process.uptime(), rooms: Server.current ? "up" : "down" });
    });
  },
  rooms: {
    game: defineRoom(GameRoom),
  },
});

gameServer.listen(PORT, HOST).then(() => {
  console.log(`[last-stop] game server listening on ws://${HOST}:${PORT}`);
});
