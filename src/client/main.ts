import "./styles.css";

interface UsageWindowSnapshot {
  name: string;
  percentRemaining?: number;
  resetAt?: string;
  resetLabel?: string;
}

export interface ProviderUsageSnapshot {
  provider: string;
  state: 'ok' | 'warn' | 'critical' | 'unknown' | 'unavailable' | 'manual';
  source: {
    kind: string;
    label: string;
    confidence: string;
    caveat: string;
  };
  windows: UsageWindowSnapshot[];
  updatedAt?: string;
  stale: boolean;
  message?: string;
}

export interface RefreshState {
  state: 'idle' | 'loading' | 'success' | 'error';
  errorCode?: string;
  errorMessage?: string;
}

function stateClass(state: ProviderUsageSnapshot['state']): string {
  switch (state) {
    case 'ok': return 'state-ok';
    case 'warn': return 'state-warn';
    case 'critical': return 'state-critical';
    default: return 'state-unknown';
  }
}

function formatUpdatedAt(iso: string | undefined, stale: boolean): string {
  if (!iso) return '';
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return stale ? `${time} (stale)` : time;
}

export function renderWindow(w: UsageWindowSnapshot): string {
  const pct = w.percentRemaining !== undefined
    ? `<span class="window-pct">${w.percentRemaining}% left</span>`
    : `<span class="window-pct unknown">—</span>`;
  const reset = w.resetLabel
    ? `<span class="window-reset">resets ${w.resetLabel}</span>`
    : w.resetAt
    ? `<span class="window-reset">resets ${new Date(w.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`
    : '';
  return `<div class="window-row"><span class="window-name">${w.name}</span>${pct}${reset}</div>`;
}

export function renderRefreshSection(provider: string, refresh: RefreshState): string {
  if (refresh.state === 'loading') {
    return `<div class="card-refresh"><span class="refresh-loading">Refreshing…</span></div>`;
  }
  if (refresh.state === 'error') {
    const msg = refresh.errorMessage ?? 'Refresh failed';
    return `<div class="card-refresh">
      <button class="refresh-btn" data-provider="${provider}">Refresh</button>
      <span class="refresh-error">${msg}</span>
    </div>`;
  }
  return `<div class="card-refresh">
    <button class="refresh-btn" data-provider="${provider}">Refresh</button>
    ${refresh.state === 'success' ? '<span class="refresh-ok">Updated</span>' : ''}
  </div>`;
}

export function renderCard(snap: ProviderUsageSnapshot, refresh: RefreshState = { state: 'idle' }): string {
  const updatedStr = formatUpdatedAt(snap.updatedAt, snap.stale);
  const staleTag = snap.stale ? '<span class="stale-badge">stale</span>' : '';

  const windows = snap.windows.length > 0
    ? snap.windows.map(renderWindow).join('')
    : snap.message
    ? `<div class="window-row"><span class="window-msg">${snap.message}</span></div>`
    : '';

  const caveat = snap.source.kind !== 'unavailable'
    ? `<p class="card-caveat">${snap.source.caveat}</p>`
    : '';

  return `
    <div class="usage-card ${stateClass(snap.state)}" data-provider="${snap.provider}">
      <div class="card-header">
        <span class="provider-name">${snap.provider}</span>
        <span class="state-dot" title="${snap.state}"></span>
        ${staleTag}
      </div>
      <div class="card-windows">${windows}</div>
      <div class="card-meta">
        <span class="source-label">${snap.source.label}</span>
        ${updatedStr ? `<span class="updated-at">${updatedStr}</span>` : ''}
      </div>
      ${caveat}
      ${renderRefreshSection(snap.provider, refresh)}
    </div>
  `;
}

type RefreshStates = Record<string, RefreshState>;

let currentSnapshots: ProviderUsageSnapshot[] = [];
const refreshStates: RefreshStates = {};

function renderCards(): void {
  const container = document.getElementById('usage-cards');
  if (!container) return;
  container.innerHTML = currentSnapshots
    .map((s) => renderCard(s, refreshStates[s.provider] ?? { state: 'idle' }))
    .join('');
  container.querySelectorAll<HTMLButtonElement>('.refresh-btn[data-provider]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const provider = btn.dataset['provider'];
      if (provider) void triggerRefresh(provider);
    });
  });
}

async function triggerRefresh(provider: string): Promise<void> {
  refreshStates[provider] = { state: 'loading' };
  renderCards();

  try {
    const res = await fetch(`/api/usage/${provider}/refresh`, { method: 'POST' });
    const body = await res.json() as { status: string; error?: { code: string; message: string } | null };

    if (!res.ok || body.error) {
      const msg = body.error?.message ?? `Refresh failed (HTTP ${res.status})`;
      const code = body.error?.code ?? 'NON_ZERO_EXIT';
      refreshStates[provider] = { state: 'error', errorCode: code, errorMessage: sanitizeRefreshError(code, msg) };
      renderCards();
      return;
    }

    const usageRes = await fetch('/api/usage');
    currentSnapshots = await usageRes.json() as ProviderUsageSnapshot[];
    refreshStates[provider] = { state: 'success' };
    renderCards();
  } catch {
    refreshStates[provider] = { state: 'error', errorCode: 'NON_ZERO_EXIT', errorMessage: 'Refresh failed. Check the server.' };
    renderCards();
  }
}

export function sanitizeRefreshError(code: string, fallback: string): string {
  switch (code) {
    case 'CLI_UNAVAILABLE': return 'CLI not found. Ensure codex is installed and on PATH.';
    case 'TIMEOUT': return 'Timed out. Try again.';
    case 'MANUAL_REFRESH_REQUIRED': return 'Manual refresh required. Use Claude Code `/usage` or Claude.ai Settings > Usage.';
    case 'UNSUPPORTED_AUTOMATION': return 'Automated refresh is not supported for this provider.';
    case 'PERMISSION_DENIED': return 'Permission denied writing snapshot. Check data/usage-snapshots/ permissions.';
    case 'SNAPSHOT_READ_FAILED': return 'Snapshot was not written. Try again.';
    default: return fallback;
  }
}

async function loadUsage(): Promise<void> {
  const container = document.getElementById('usage-cards');
  if (!container) return;

  try {
    const res = await fetch('/api/usage');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentSnapshots = await res.json() as ProviderUsageSnapshot[];
    renderCards();
  } catch (err) {
    container.innerHTML = `<p class="load-error">Could not load usage data. ${err instanceof Error ? err.message : ''}</p>`;
  }
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML = `
      <header class="site-header">
        <h1>Usage Glance</h1>
      </header>
      <main class="content">
        <div id="usage-cards" class="usage-cards"></div>
      </main>
    `;
    void loadUsage();
  }
}
