const baseUrl = process.env.BRIDATA_LOAD_BASE_URL?.replace(/\/$/, '');
const token = process.env.BRIDATA_LOAD_TOKEN;
const tenantId = process.env.BRIDATA_LOAD_TENANT_ID;
const workspaceId = process.env.BRIDATA_LOAD_WORKSPACE_ID;
const confirmation = process.env.BRIDATA_LOAD_TEST_CONFIRM;
const requests = Number(process.env.BRIDATA_LOAD_REQUESTS ?? 200);
const concurrency = Number(process.env.BRIDATA_LOAD_CONCURRENCY ?? 10);

if (confirmation !== 'YES') {
  throw new Error('Set BRIDATA_LOAD_TEST_CONFIRM=YES to run the H4 load smoke intentionally.');
}
if (!baseUrl || !token || !tenantId || !workspaceId) {
  throw new Error('BRIDATA_LOAD_BASE_URL, BRIDATA_LOAD_TOKEN, BRIDATA_LOAD_TENANT_ID and BRIDATA_LOAD_WORKSPACE_ID are required.');
}
if (!Number.isInteger(requests) || requests < 1 || requests > 5000) {
  throw new Error('BRIDATA_LOAD_REQUESTS must be an integer between 1 and 5000.');
}
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) {
  throw new Error('BRIDATA_LOAD_CONCURRENCY must be an integer between 1 and 100.');
}

const target = `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/summary-v1`;
const durations = [];
const statuses = new Map();
let nextIndex = 0;

async function worker() {
  while (true) {
    const index = nextIndex++;
    if (index >= requests) return;
    const startedAt = performance.now();
    try {
      const response = await fetch(target, {
        headers: {
          authorization: `Bearer ${token}`,
          'x-bridata-tenant-id': tenantId,
          'x-correlation-id': `h4-load-${Date.now()}-${index}`,
        },
      });
      durations.push(performance.now() - startedAt);
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      await response.arrayBuffer();
    } catch {
      durations.push(performance.now() - startedAt);
      statuses.set(0, (statuses.get(0) ?? 0) + 1);
    }
  }
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const elapsedMs = performance.now() - startedAt;
const sorted = durations.toSorted((a, b) => a - b);
const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] ?? 0;
const success = [...statuses.entries()].filter(([status]) => status >= 200 && status < 400).reduce((sum, [, count]) => sum + count, 0);

const report = {
  target,
  requests,
  concurrency,
  elapsedMs: Math.round(elapsedMs),
  requestsPerSecond: Number((requests / (elapsedMs / 1000)).toFixed(2)),
  successRate: Number(((success / requests) * 100).toFixed(2)),
  latencyMs: {
    p50: Math.round(percentile(0.50)),
    p95: Math.round(percentile(0.95)),
    p99: Math.round(percentile(0.99)),
    max: Math.round(sorted.at(-1) ?? 0),
  },
  statuses: Object.fromEntries([...statuses.entries()].sort(([a], [b]) => a - b)),
};

console.log(JSON.stringify(report, null, 2));

if (report.successRate < 99) process.exitCode = 2;
if (report.latencyMs.p95 > Number(process.env.BRIDATA_LOAD_P95_LIMIT_MS ?? 1000)) process.exitCode = 3;
