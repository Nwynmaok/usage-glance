#!/usr/bin/env node
// Claude Code statusLine command.
//
// Claude Code pipes a JSON payload to this script on stdin on each status
// render. For claude.ai subscribers, that payload includes `rate_limits`
// (5-hour + 7-day usage windows) once the session has made its first API call.
//
// We persist that snippet to data/provider-usage/claude-statusline.json so
// usage-glance can surface Claude usage without an API key. We also print a
// short status line so the capture is visible in the terminal.
//
// This must never throw — a crashing statusLine breaks the Claude Code UI.

import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(projectRoot, 'data', 'provider-usage');
const outFile = join(outDir, 'claude-statusline.json');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

function captureWindow(w) {
  if (!w || typeof w.used_percentage !== 'number') return null;
  const out = { used_percentage: w.used_percentage };
  if (typeof w.resets_at === 'number') out.resets_at = w.resets_at;
  return out;
}

function statusFor(rate) {
  const parts = [];
  const five = rate?.five_hour?.used_percentage;
  const week = rate?.seven_day?.used_percentage;
  if (typeof five === 'number') parts.push(`5h ${Math.round(five)}%`);
  if (typeof week === 'number') parts.push(`7d ${Math.round(week)}%`);
  return parts.length ? `◔ ${parts.join(' · ')}` : null;
}

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return; // no usable payload; print nothing
  }

  const rate = input?.rate_limits;
  const five = captureWindow(rate?.five_hour);
  const seven = captureWindow(rate?.seven_day);

  if (five || seven) {
    const payload = {
      capturedAt: new Date().toISOString(),
      rate_limits: {
        ...(five ? { five_hour: five } : {}),
        ...(seven ? { seven_day: seven } : {}),
      },
    };
    try {
      mkdirSync(outDir, { recursive: true });
      const tmp = `${outFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(payload, null, 2));
      renameSync(tmp, outFile);
    } catch {
      // disk/permission issue — never block the statusline
    }
  }

  const status = statusFor(rate);
  if (status) process.stdout.write(status);
  else if (typeof input?.model?.display_name === 'string') {
    process.stdout.write(input.model.display_name);
  }
}

main().catch(() => {});
