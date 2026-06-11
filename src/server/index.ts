import { buildApp } from "./app.js";

const host = "127.0.0.1";
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = await buildApp();

await app.listen({ host, port });
console.log(`Server listening on http://${host}:${port}`);
