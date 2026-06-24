import "./styles.css";

interface TodolistTask {
  notionPageId: string;
  title: string;
  status: string | null;
  priority: string | null;
  dueDate: string | null;
  project: string | null;
  effort: string | null;
  blocked: boolean;
  waiting: boolean;
  lastEditedAt: string | null;
  nextAction: string | null;
  url: string | null;
}

interface FocusRecommendation {
  task: TodolistTask;
  score: number;
  reasons: string[];
  actionGuidance: "start" | "split" | "defer" | "mark-blocked" | "review";
}

interface ReviewCandidate {
  task: TodolistTask;
  reviewReasons: string[];
}

interface CadenceState {
  currentDay: string;
  currentWeek: string;
  dailyStartupCompletedAt: string | null;
  dailyShutdownCompletedAt: string | null;
  weeklyReviewCompletedAt: string | null;
  selectedFocusPageIds: string[];
}

interface StatusPayload {
  configured: boolean;
  hasToken: boolean;
  hasDatabaseId: boolean;
  mappingWarnings: string[];
  lastSyncAt: string | null;
  degraded: boolean;
  error: string | null;
}

interface FocusPayload {
  configured: boolean;
  lastSyncAt: string | null;
  degraded: boolean;
  error: string | null;
  focusCap: number;
  recommendations: FocusRecommendation[];
  reviewCandidates: ReviewCandidate[];
  setupRequired?: boolean;
  syncRequired?: boolean;
}

interface SyncPayload {
  lastSyncAt: string | null;
  degraded: boolean;
  error: string | null;
  focusCap: number;
  recommendations: FocusRecommendation[];
  reviewCandidates: ReviewCandidate[];
}

let statusData: StatusPayload | null = null;
let focusData: FocusPayload | null = null;
let cadenceData: CadenceState | null = null;
let syncLoading = false;
let syncError: string | null = null;
let loadError: string | null = null;
const selectedFocusIds = new Set<string>();

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app element");

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso.slice(0, 10) + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentWeekStr(): string {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(
    ((now.getTime() - jan1.getTime()) / 86_400_000 + jan1.getDay() + 1) / 7
  );
  return `${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function render(): void {
  root!.innerHTML = buildApp();
  attachHandlers();
}

function buildApp(): string {
  return `
    <header class="site-header">
      <h1 class="site-header__title">Todolist Coach</h1>
      <p class="site-header__sub">Local task focus &middot; powered by Notion</p>
    </header>
    <main class="content">
      ${loadError ? `<div class="alert alert--error" role="alert"><strong>Load error:</strong> ${esc(loadError)}</div>` : ""}
      ${buildStatusPanel()}
      ${buildFocusSection()}
      ${buildCadenceSection()}
      ${buildReviewSection()}
      ${buildPrivacyNote()}
    </main>
  `;
}

function buildStatusPanel(): string {
  const s = statusData;
  const lastSync = s?.lastSyncAt ?? focusData?.lastSyncAt ?? null;
  const degraded = s?.degraded ?? focusData?.degraded ?? false;

  let configRows = "";
  if (s) {
    configRows = `
      <div class="status-row">
        <span class="status-label">Notion token</span>
        <span class="status-badge ${s.hasToken ? "status-badge--ok" : "status-badge--err"}">${s.hasToken ? "Configured" : "Missing"}</span>
      </div>
      <div class="status-row">
        <span class="status-label">Database ID</span>
        <span class="status-badge ${s.hasDatabaseId ? "status-badge--ok" : "status-badge--err"}">${s.hasDatabaseId ? "Configured" : "Missing"}</span>
      </div>
      ${
        s.mappingWarnings.length > 0
          ? `<div class="alert alert--warn"><strong>Mapping warnings:</strong><ul class="warn-list">${s.mappingWarnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>`
          : ""
      }
    `;
  }

  const degradedHtml = degraded
    ? `<div class="alert alert--warn" role="alert"><strong>Degraded:</strong> ${s?.error || focusData?.error ? esc(s?.error ?? focusData?.error ?? "") : "Last sync encountered an error."}</div>`
    : "";

  const btnLabel = syncLoading ? "Syncing…" : "Sync from Notion";

  return `
    <section class="card" aria-label="Setup and status">
      <h2 class="card__title">Status</h2>
      ${configRows}
      <div class="status-row">
        <span class="status-label">Last sync</span>
        <span class="status-value ${lastSync ? "" : "status-value--muted"}">${lastSync ? fmtTime(lastSync) : "Never"}</span>
      </div>
      ${degradedHtml}
      ${syncError ? `<div class="alert alert--error" role="alert">${esc(syncError)}</div>` : ""}
      <button id="sync-btn" class="btn btn--primary${syncLoading ? " btn--loading" : ""}" ${syncLoading ? "disabled" : ""} aria-busy="${syncLoading}">
        ${btnLabel}
      </button>
    </section>
  `;
}

function buildFocusSection(): string {
  if (!focusData) {
    return `
      <section class="card" aria-label="Daily focus">
        <h2 class="card__title">Daily Focus</h2>
        <p class="empty-state">Loading focus list&hellip;</p>
      </section>`;
  }

  const f = focusData;

  if (f.setupRequired) {
    return `
      <section class="card" aria-label="Daily focus">
        <h2 class="card__title">Daily Focus</h2>
        <div class="setup-prompt">
          <p><strong>Setup required.</strong> Add your Notion token and database ID to the config file, then sync to see your focus list.</p>
        </div>
      </section>`;
  }

  if (f.syncRequired) {
    return `
      <section class="card" aria-label="Daily focus">
        <h2 class="card__title">Daily Focus</h2>
        <div class="setup-prompt">
          <p><strong>Sync required.</strong> Click &ldquo;Sync from Notion&rdquo; above to fetch your tasks and generate today&rsquo;s focus list.</p>
        </div>
      </section>`;
  }

  if (f.recommendations.length === 0) {
    return `
      <section class="card" aria-label="Daily focus">
        <h2 class="card__title">Daily Focus</h2>
        <p class="empty-state">No focus tasks found. Sync from Notion or check your task statuses.</p>
      </section>`;
  }

  const cards = f.recommendations.map((r) => buildFocusCard(r)).join("");

  return `
    <section aria-label="Daily focus">
      <h2 class="section-title">
        Daily Focus
        <span class="badge">${f.recommendations.length}&thinsp;/&thinsp;${f.focusCap}</span>
      </h2>
      <div class="focus-list">${cards}</div>
    </section>`;
}

const ACTION_LABEL: Record<string, string> = {
  start: "Start it",
  split: "Split task",
  defer: "Defer",
  "mark-blocked": "Mark blocked",
  review: "Review",
};

const ACTION_CLASS: Record<string, string> = {
  start: "action-badge--start",
  split: "action-badge--split",
  defer: "action-badge--defer",
  "mark-blocked": "action-badge--blocked",
  review: "action-badge--review",
};

function buildFocusCard(rec: FocusRecommendation): string {
  const { task, score, reasons, actionGuidance } = rec;
  const checked = selectedFocusIds.has(task.notionPageId) ? " checked" : "";

  const titleHtml = task.url
    ? `<a href="${esc(task.url)}" target="_blank" rel="noopener noreferrer" class="task-title">${esc(task.title)}</a>`
    : `<span class="task-title">${esc(task.title)}</span>`;

  const chips: string[] = [];
  if (task.project) chips.push(`<span class="chip chip--project">${esc(task.project)}</span>`);
  if (task.dueDate) chips.push(`<span class="chip chip--due">Due ${esc(fmtDate(task.dueDate))}</span>`);
  if (task.priority) chips.push(`<span class="chip chip--priority">${esc(task.priority)}</span>`);
  if (task.effort) chips.push(`<span class="chip chip--effort">${esc(task.effort)}</span>`);
  if (task.blocked) chips.push(`<span class="chip chip--blocked">Blocked</span>`);
  if (task.waiting) chips.push(`<span class="chip chip--waiting">Waiting</span>`);

  return `
    <div class="focus-card" data-page-id="${esc(task.notionPageId)}">
      <div class="focus-card__header">
        <label class="focus-select">
          <input type="checkbox" class="focus-checkbox" data-page-id="${esc(task.notionPageId)}"${checked}>
          <span class="sr-only">Select for focus</span>
        </label>
        <div class="focus-card__title-wrap">${titleHtml}</div>
        <span class="score-badge" title="Focus score">${score.toFixed(0)}</span>
      </div>
      ${chips.length > 0 ? `<div class="chip-row">${chips.join("")}</div>` : ""}
      ${reasons.length > 0 ? `<ul class="reason-list">${reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
      ${task.nextAction ? `<p class="next-action"><strong>Next:</strong> ${esc(task.nextAction)}</p>` : ""}
      <div class="action-row">
        <span class="action-badge ${ACTION_CLASS[actionGuidance] ?? ""}">${ACTION_LABEL[actionGuidance] ?? esc(actionGuidance)}</span>
      </div>
    </div>`;
}

function buildCadenceSection(): string {
  const c = cadenceData;
  const today = todayStr();

  const startupDone = !!(c?.currentDay === today && c?.dailyStartupCompletedAt);
  const shutdownDone = !!(c?.currentDay === today && c?.dailyShutdownCompletedAt);
  const weeklyDone = !!(c?.currentWeek === currentWeekStr() && c?.weeklyReviewCompletedAt);
  const focusCount = selectedFocusIds.size;

  function cadenceBtn(id: string, label: string, done: boolean, doneTime?: string | null): string {
    const doneLabel = doneTime ? `${label} &middot; ${fmtTime(doneTime)}` : label;
    return `<button id="${id}" class="btn btn--cadence${done ? " btn--done" : ""}" ${done ? "disabled" : ""}>
      ${done ? `<span aria-hidden="true" class="check-icon">✓</span> ${doneLabel}` : label}
    </button>`;
  }

  return `
    <section class="card" aria-label="Cadence coach">
      <h2 class="card__title">Cadence Coach</h2>
      <div class="cadence-controls">
        ${cadenceBtn("cadence-startup", "Daily Startup", startupDone, c?.dailyStartupCompletedAt)}
        ${cadenceBtn("cadence-shutdown", "Daily Shutdown", shutdownDone, c?.dailyShutdownCompletedAt)}
        ${cadenceBtn("cadence-weekly", "Weekly Review", weeklyDone, c?.weeklyReviewCompletedAt)}
        <button id="cadence-focus" class="btn btn--cadence${focusCount > 0 ? " btn--focus-set" : ""}">
          ${focusCount > 0 ? `<span aria-hidden="true" class="check-icon">✓</span> Focus set (${focusCount})` : "Set Selected Focus"}
        </button>
      </div>
    </section>`;
}

function buildReviewSection(): string {
  const candidates = focusData?.reviewCandidates ?? [];
  if (candidates.length === 0) return "";

  const items = candidates
    .map(
      (rc) => `
      <li class="review-item">
        <span class="review-item__title">${esc(rc.task.title)}</span>
        <div class="chip-row">${rc.reviewReasons.map((r) => `<span class="chip chip--review">${esc(r)}</span>`).join("")}</div>
      </li>`
    )
    .join("");

  return `
    <section class="card card--review" aria-label="Review needed">
      <h2 class="card__title">Review Needed <span class="badge badge--warn">${candidates.length}</span></h2>
      <ul class="review-list">${items}</ul>
    </section>`;
}

function buildPrivacyNote(): string {
  return `
    <div class="privacy-note" role="note">
      <p><strong>Local &amp; private:</strong> Task data goes only to the Notion API and local files on this machine. Nothing is sent to external analytics or tracking services.</p>
    </div>`;
}

function attachHandlers(): void {
  document.getElementById("sync-btn")?.addEventListener("click", handleSync);
  document.getElementById("cadence-startup")?.addEventListener("click", () => postCadence("daily-startup-complete"));
  document.getElementById("cadence-shutdown")?.addEventListener("click", () => postCadence("daily-shutdown-complete"));
  document.getElementById("cadence-weekly")?.addEventListener("click", () => postCadence("weekly-review-complete"));
  document.getElementById("cadence-focus")?.addEventListener("click", handleSelectFocus);

  document.querySelectorAll<HTMLInputElement>(".focus-checkbox").forEach((el) => {
    el.addEventListener("change", handleFocusCheckbox);
  });
}

function handleFocusCheckbox(e: Event): void {
  const checkbox = e.target as HTMLInputElement;
  const pageId = checkbox.dataset.pageId;
  if (!pageId) return;

  if (checkbox.checked) {
    selectedFocusIds.add(pageId);
  } else {
    selectedFocusIds.delete(pageId);
  }

  const btn = document.getElementById("cadence-focus");
  if (btn) {
    const count = selectedFocusIds.size;
    btn.innerHTML = count > 0
      ? `<span aria-hidden="true" class="check-icon">✓</span> Focus set (${count})`
      : "Set Selected Focus";
    btn.classList.toggle("btn--focus-set", count > 0);
  }
}

async function handleSelectFocus(): Promise<void> {
  await postCadence("select-focus", [...selectedFocusIds]);
}

async function handleSync(): Promise<void> {
  if (syncLoading) return;
  syncLoading = true;
  syncError = null;
  render();

  try {
    const res = await fetch("/api/todolist/sync", { method: "POST" });
    const data = (await res.json()) as SyncPayload;

    const configured = statusData ? statusData.configured : true;
    focusData = {
      configured,
      lastSyncAt: data.lastSyncAt,
      degraded: data.degraded,
      error: data.error,
      focusCap: data.focusCap,
      recommendations: data.recommendations,
      reviewCandidates: data.reviewCandidates,
      setupRequired: !configured,
      syncRequired: false,
    };

    if (statusData) {
      statusData = { ...statusData, lastSyncAt: data.lastSyncAt, degraded: data.degraded, error: data.error };
    }

    if (data.degraded) {
      syncError = data.error ?? "Sync encountered an error — results may be stale.";
    }
  } catch (err) {
    syncError = err instanceof Error ? err.message : "Sync request failed";
  } finally {
    syncLoading = false;
    render();
  }
}

async function postCadence(event: string, selectedFocusPageIds?: string[]): Promise<void> {
  try {
    const body: Record<string, unknown> = { event };
    if (selectedFocusPageIds !== undefined) {
      body.selectedFocusPageIds = selectedFocusPageIds;
    }

    const res = await fetch("/api/todolist/cadence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = (await res.json()) as { ok: boolean; cadence: CadenceState };
      if (data.ok) {
        cadenceData = data.cadence;
        render();
      }
    }
  } catch {
    // non-fatal; cadence display stays unchanged
  }
}

async function init(): Promise<void> {
  try {
    const [statusRes, focusRes] = await Promise.all([
      fetch("/api/todolist/status"),
      fetch("/api/todolist/focus"),
    ]);
    [statusData, focusData] = await Promise.all([
      statusRes.json() as Promise<StatusPayload>,
      focusRes.json() as Promise<FocusPayload>,
    ]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load dashboard";
  }

  render();
}

init();
