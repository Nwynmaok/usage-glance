import * as esbuild from "esbuild";
import { mkdir } from "fs/promises";

await mkdir("public/assets", { recursive: true });

await esbuild.build({
  entryPoints: ["src/client/main.ts"],
  bundle: true,
  outdir: "public/assets",
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: process.env.NODE_ENV === "production",
});

console.log("Client bundle built → public/assets/");
