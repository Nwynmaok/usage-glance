import "./styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app element");

root.innerHTML = `
  <header class="site-header">
    <h1>Usage Glance</h1>
  </header>
  <main class="content">
    <div class="notice">
      <h2>Coming soon</h2>
      <p>
        Usage collection and dashboard data are <strong>not implemented yet</strong>
        in this bootstrap. No API calls are being made and no usage is being tracked.
      </p>
      <p>
        Provider usage percentages shown in future versions will be
        <strong>approximate and local-only</strong> — calculated from locally
        cached data and never sent to any external service.
      </p>
    </div>
  </main>
`;
