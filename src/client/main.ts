import "./styles.css";

interface UsageWindowSnapshot {
  name: string;
  percentRemaining?: number;
  resetAt?: string;
  resetLabel?: string;
}

interface ProviderUsageSnapshot {
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

function renderWindow(w: UsageWindowSnapshot): string {
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

function renderCard(snap: ProviderUsageSnapshot): string {
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
    <div class="usage-card ${stateClass(snap.state)}">
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
    </div>
  `;
}

async function loadUsage(): Promise<void> {
  const container = document.getElementById('usage-cards');
  if (!container) return;

  try {
    const res = await fetch('/api/usage');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snapshots: ProviderUsageSnapshot[] = await res.json() as ProviderUsageSnapshot[];
    container.innerHTML = snapshots.map(renderCard).join('');
  } catch (err) {
    container.innerHTML = `<p class="load-error">Could not load usage data. ${err instanceof Error ? err.message : ''}</p>`;
  }
}

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app element');

root.innerHTML = `
  <header class="site-header">
    <h1>Usage Glance</h1>
  </header>
  <main class="content">
    <div id="usage-cards" class="usage-cards"></div>
  </main>
`;

void loadUsage();
