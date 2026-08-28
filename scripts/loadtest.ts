import "dotenv/config";

const base = process.env.AMT_LOADTEST_BASE_URL || "http://127.0.0.1:18180/amt_price_list";
const username = process.env.AMT_LOADTEST_USERNAME || "";
const password = process.env.AMT_LOADTEST_PASSWORD || "";
const concurrency = Number(process.env.AMT_LOADTEST_CONCURRENCY || "10");
const loops = Number(process.env.AMT_LOADTEST_LOOPS || "5");
const searchTerm = process.env.AMT_LOADTEST_SEARCH || "LC1";

if (!username || !password) {
  throw new Error("Set AMT_LOADTEST_USERNAME and AMT_LOADTEST_PASSWORD before running the load test");
}

type Metrics = { name: string; ms: number; ok: boolean };
const metrics: Metrics[] = [];

async function timed(name: string, run: () => Promise<Response>) {
  const start = performance.now();
  const response = await run();
  metrics.push({ name, ms: performance.now() - start, ok: response.ok });
  return response;
}

async function scenario() {
  const login = await timed("login", () =>
    fetch(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: new URL(base).origin },
      body: JSON.stringify({ username, password }),
    }),
  );
  const setCookie = login.headers.get("set-cookie");
  const cookie = setCookie?.split(";")[0];
  if (!login.ok || !cookie) throw new Error("Login failed during load test");
  const me = await timed("auth/me", () =>
    fetch(`${base}/api/v1/auth/me`, {
      headers: { Cookie: cookie, Origin: new URL(base).origin },
    }),
  );
  const auth = await me.json();
  const csrf = auth.user?.csrf || "";
  await timed("search", () =>
    fetch(`${base}/api/v1/search?q=${encodeURIComponent(searchTerm)}`, {
      headers: { Cookie: cookie, Origin: new URL(base).origin },
    }),
  );
  await timed("dashboard", () =>
    fetch(`${base}/api/v1/admin/dashboard`, {
      headers: { Cookie: cookie, Origin: new URL(base).origin },
    }),
  );
  await timed("backup-queue", () =>
    fetch(`${base}/api/v1/admin/backups`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: new URL(base).origin,
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
  );
}

await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (let i = 0; i < loops; i++) await scenario();
  }),
);

for (const name of [...new Set(metrics.map((m) => m.name))]) {
  const rows = metrics.filter((m) => m.name === name);
  const sorted = rows.map((m) => m.ms).sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  console.log(
    `${name}: ok=${rows.filter((m) => m.ok).length}/${rows.length} p50=${percentile(0.5).toFixed(1)}ms p95=${percentile(0.95).toFixed(1)}ms max=${sorted[sorted.length - 1].toFixed(1)}ms`,
  );
}
