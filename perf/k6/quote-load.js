// k6 peak / scalability test for quote creation (NFR-002, NFR-010). Run against QA/staging, never prod.
//   API_BASE_URL=https://qa.example SALES_EMAIL=... SALES_PASSWORD=... k6 run perf/k6/quote-load.js
import http from 'k6/http';
import { check } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE = __ENV.API_BASE_URL || 'http://localhost:4010';
const PEAK = Number(__ENV.PEAK_VUS || 50);

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '1m', target: Math.ceil(PEAK / 4) },
        { duration: '2m', target: Math.ceil(PEAK / 2) },
        { duration: '3m', target: PEAK },
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_failed{name:create_quote}': ['rate<0.01'],
    'http_req_duration{name:create_quote}': [`p(95)<${__ENV.P95_MS || 2000}`],
    'http_req_duration{name:quote_pdf}': ['p(95)<5000'],
  },
};

export function setup() {
  const res = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({
      email: __ENV.SALES_EMAIL || 'sales@uvation.test',
      password: __ENV.SALES_PASSWORD || 'change-me',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  return { token: res.json('token') };
}

export default function ({ token }) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'Idempotency-Key': uuidv4(),
  };
  const body = {
    customer: {
      companyName: 'k6 Load Co',
      email: `k6+${__VU}-${__ITER}-${Date.now()}@uvation-qa.test`,
      phone: '+14155550123',
    },
    items: [{ sku: __ENV.SERVER_SKU || 'UV-AI-8X', quantity: 1 }],
    shipping: { destination: 'US-CA', method: 'freight' },
  };
  const res = http.post(`${BASE}/api/quotes`, JSON.stringify(body), {
    headers,
    tags: { name: 'create_quote' },
  });
  check(res, { 'quote created': (r) => r.status === 201, 'has quote number': (r) => !!r.json('number') });
  if (res.status === 201 && __ITER % 5 === 0) {
    const pdf = http.get(`${BASE}/api/quotes/${res.json('id')}/pdf`, {
      headers,
      tags: { name: 'quote_pdf' },
    });
    check(pdf, { 'pdf ok': (r) => r.status === 200 });
  }
}
