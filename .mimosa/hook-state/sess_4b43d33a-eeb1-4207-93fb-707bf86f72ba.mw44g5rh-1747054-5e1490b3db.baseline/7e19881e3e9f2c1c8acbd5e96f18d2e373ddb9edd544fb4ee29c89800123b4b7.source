// LAST STOP game server: Colyseus over ws, plus an Express health endpoint.
import http from "node:http";
import express from "express";
import cors from "cors";
import { defineServer, defineRoom, Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./rooms/GameRoom.js";

const PORT = Number(process.env.PORT ?? 2567);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = express();
app.use(cors());
app.get("/", (_req, res) => {
  res.json({ ok: true, game: "LAST STOP", version: "0.1.0" });
});
app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), rooms: Server.current ? "up" : "down" });
});

const httpServer = http.createServer(app);

const gameServer = defineServer({
  transport: new WebSocketTransport({ server: httpServer }),
  rooms: {
    game: defineRoom(GameRoom),
  },
});

gameServer.listen(PORT, HOST).then(() => {
  console.log(`[last-stop] game server listening on ws://${HOST}:${PORT}`);
});
