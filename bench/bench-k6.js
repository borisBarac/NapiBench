import http from 'k6/http';
import { check } from 'k6';

const baseUrl = __ENV.BASE_URL || 'http://localhost:3033';

const sizes = {
  s:  { rate: 500,  duration: '1m' },
  m:  { rate: 2000, duration: '3m' },
  l:  { rate: 5000, duration: '5m' },
  sl: { rate: 5000, duration: '1m' },
};

const size = __ENV.SIZE || 's';
const cfg = sizes[size] || sizes.s;

export const options = {
  scenarios: {
    stress: {
      executor: 'constant-arrival-rate',
      rate: cfg.rate,
      timeUnit: '1s',
      duration: cfg.duration,
      preAllocatedVUs: 200,
      maxVUs: 2000,
    },
  },
  thresholds: {
    http_req_failed: ['rate < 0.01'],
    http_req_duration: ['p(95) < 500'],
  },
};

export default function () {
  const endpoint = __ENV.ENDPOINT || '/price';
  const url = `${baseUrl}${endpoint}`;

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const response = http.get(url, params);

  check(response, {
    'status is 200': (r) => r.status === 200,
    'has moving_averages': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.moving_averages);
      } catch {
        return false;
      }
    },
  });
}

export function handleSummary(data) {
  const dur = data.metrics.http_req_duration;
  const reqs = data.metrics.http_reqs;
  const failed = data.metrics.http_req_failed;

  const summary = {
    test_config: {
      size,
      endpoint: __ENV.ENDPOINT || '/price',
      target_rate: cfg.rate,
      duration: cfg.duration,
      base_url: baseUrl,
    },
    latency_ms: {
      avg: dur.values.avg,
      p95: dur.values['p(95)'],
      p99: dur.values['p(99)'],
      min: dur.values.min,
      max: dur.values.max,
      med: dur.values.med,
    },
    throughput: {
      rps: reqs.values.rate,
      total_requests: reqs.values.count,
    },
    errors: {
      fail_rate: failed.values.rate,
    },
  };

  const exportPath = __ENV.SUMMARY_EXPORT;
  if (exportPath) {
    return {
      [exportPath]: JSON.stringify(summary, null, 2),
      stdout: '',
    };
  }

  return { stdout: JSON.stringify(summary, null, 2) };
}
