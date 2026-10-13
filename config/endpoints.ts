/**
 * Single place to map the automation suite onto the real Uvation Marketplace API.
 * If a route differs on an environment, change it here only.
 */
export const endpoints = {
  login: '/api/auth/login',
  customerLookup: (email: string) => `/api/customers/lookup?email=${encodeURIComponent(email)}`,
  products: '/api/products',
  product: (sku: string) => `/api/products/${encodeURIComponent(sku)}`,
  validateConfiguration: '/api/configurations/validate',
  validateDiscount: '/api/discounts/validate',
  quotes: '/api/quotes',
  quote: (id: string) => `/api/quotes/${id}`,
  quoteAction: (id: string, action: string) => `/api/quotes/${id}/${action}`,
  quotePdf: (id: string) => `/api/quotes/${id}/pdf`,
  quoteAudit: (id: string) => `/api/quotes/${id}/audit`,
  quoteEmails: (id: string) => `/api/quotes/${id}/emails`,
  sharedQuote: (token: string) => `/q/${token}`,
  order: (id: string) => `/api/orders/${id}`,
  ordersForQuote: (id: string) => `/api/orders?quoteId=${id}`,
  health: '/health',
  // Fault-injection hooks: only available where FAULT_INJECTION=true
  fault: '/__test/fault',
  catalogAdmin: '/__test/catalog',
  restart: '/__test/restart',
} as const;
