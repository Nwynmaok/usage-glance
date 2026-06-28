import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { join } from "path";
import { fileURLToPath } from "url";
import { healthRoutes } from "./routes/health.js";
import { usageRoutes } from "./routes/usage.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyStatic, {
    root: join(__dirname, "../../public"),
    prefix: "/",
  });

  await app.register(healthRoutes);
  await app.register(usageRoutes);

  return app;
}
