const LATENCY_BUCKETS_MS = [
  5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
] as const;

type RequestKey = {
  method: string;
  route: string;
  status: number;
};

function label(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function requestKey(key: RequestKey): string {
  return `${key.method}\u0000${key.route}\u0000${key.status}`;
}

export class Metrics {
  private readonly startedAt = Date.now();
  private readonly requests = new Map<string, { key: RequestKey; count: number }>();
  private readonly latencyBuckets = new Array<number>(
    LATENCY_BUCKETS_MS.length + 1,
  ).fill(0);
  private latencySumMs = 0;
  private latencyCount = 0;
  private inFlight = 0;

  requestStarted(): void {
    this.inFlight += 1;
  }

  requestFinished(
    method: string,
    route: string,
    status: number,
    durationMs: number,
  ): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const key: RequestKey = {
      method: method.toUpperCase(),
      route,
      status: Number.isInteger(status) ? status : 500,
    };
    const mapKey = requestKey(key);
    const existing = this.requests.get(mapKey);
    if (existing === undefined) {
      this.requests.set(mapKey, { key, count: 1 });
    } else {
      existing.count += 1;
    }

    const duration = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    this.latencySumMs += duration;
    this.latencyCount += 1;
    let bucketIndex = LATENCY_BUCKETS_MS.findIndex((bound) => duration <= bound);
    if (bucketIndex === -1) bucketIndex = LATENCY_BUCKETS_MS.length;
    this.latencyBuckets[bucketIndex] = (this.latencyBuckets[bucketIndex] ?? 0) + 1;
  }

  render(): string {
    const lines: string[] = [];
    lines.push(
      "# HELP agency_api_http_requests_total Total HTTP requests handled by the API.",
      "# TYPE agency_api_http_requests_total counter",
    );
    const entries = [...this.requests.values()].sort((a, b) => {
      const left = requestKey(a.key);
      const right = requestKey(b.key);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    for (const { key, count } of entries) {
      lines.push(
        `agency_api_http_requests_total{method="${label(key.method)}",route="${label(key.route)}",status="${key.status}"} ${count}`,
      );
    }

    lines.push(
      "# HELP agency_api_http_request_duration_ms HTTP request duration in milliseconds.",
      "# TYPE agency_api_http_request_duration_ms histogram",
    );
    for (let index = 0; index < LATENCY_BUCKETS_MS.length; index += 1) {
      let count = 0;
      for (let bucket = 0; bucket <= index; bucket += 1) {
        count += this.latencyBuckets[bucket] ?? 0;
      }
      lines.push(
        `agency_api_http_request_duration_ms_bucket{le="${LATENCY_BUCKETS_MS[index]}"} ${count}`,
      );
    }
    lines.push(
      `agency_api_http_request_duration_ms_bucket{le="+Inf"} ${this.latencyCount}`,
      `agency_api_http_request_duration_ms_sum ${this.latencySumMs}`,
      `agency_api_http_request_duration_ms_count ${this.latencyCount}`,
      "# HELP agency_api_http_requests_in_flight Requests currently being processed.",
      "# TYPE agency_api_http_requests_in_flight gauge",
      `agency_api_http_requests_in_flight ${this.inFlight}`,
      "# HELP agency_api_process_uptime_seconds Process uptime in seconds.",
      "# TYPE agency_api_process_uptime_seconds gauge",
      `agency_api_process_uptime_seconds ${((Date.now() - this.startedAt) / 1000).toFixed(3)}`,
      "",
    );
    return lines.join("\n");
  }
}
