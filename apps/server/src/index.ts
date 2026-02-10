import fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { registerAuthRoutes } from "./auth";
import { registerSocket } from "./socket";
import { ServerState } from "./state";

const app = fastify({
  logger: true
});

const state = new ServerState();

app.register(cors, {
  origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  credentials: true
});

app.register(jwt, {
  secret: process.env.JWT_SECRET ?? "dev-secret"
});

app.register(rateLimit, {
  max: 200,
  timeWindow: "1 minute"
});

app.get("/health", async () => ({ status: "ok" }));

registerAuthRoutes(app);
registerSocket(app, state);

const port = Number(process.env.PORT ?? 4000);
const host = "0.0.0.0";

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
