import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 20 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate < 0.01'],
    http_req_duration: ['p(95) < 500'],
  },
};

export default function () {
  const url = `${baseUrl}/price-rust`;

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

  sleep(1);
}
