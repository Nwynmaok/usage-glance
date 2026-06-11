import { describe, it, expect, afterEach } from "vitest";
import { buildApp } from "../src/server/app.js";
import type { FastifyInstance } from "fastify";

describe("GET /healthz", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("returns 200 with status ok and numeric uptime", async () => {
    app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);

    const body = response.json<{ status: string; uptime: number }>();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("fails if /healthz is missing", async () => {
    app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/not-a-route" });
    expect(response.statusCode).toBe(404);
  });
});
