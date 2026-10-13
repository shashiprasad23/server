/**
 * Every UI locator used by the suite. When the marketplace DOM differs (or lacks data-testid attributes),
 * re-map it here; page objects and specs never hard-code selectors.
 */
const tid = (id: string) => `[data-testid="${id}"]`;

export const selectors = {
  login: {
    path: '/login',
    email: tid('login-email'),
    password: tid('login-password'),
    submit: tid('login-submit'),
  },
  admin: {
    path: '/admin',
    sendQuoteNav: tid('nav-send-quote'),
  },
  quoteForm: {
    adminPath: '/admin/quotes/new',
    guestPath: '/request-quote',
    lookupEmail: tid('lookup-email'),
    lookupButton: tid('lookup-btn'),
    lookupResult: tid('lookup-result'),
    companyName: tid('company-name'),
    contactName: tid('contact-name'),
    email: tid('email'),
    phone: tid('phone'),
    product: tid('product-select'),
    quantity: tid('quantity'),
    generalInquiry: tid('general-inquiry'),
    notes: tid('notes'),
    submit: tid('submit-quote'),
    success: tid('quote-success'),
    quoteNumber: tid('quote-number'),
    guestReference: tid('guest-reference'),
    fieldError: (field: string) => tid(`error-${field}`),
  },
  quoteView: {
    path: (id: string) => `/admin/quotes/${id}`,
    number: tid('quote-view-number'),
    status: tid('quote-view-status'),
    company: tid('quote-view-company'),
    notes: tid('quote-view-notes'),
    total: tid('quote-view-total'),
    recipients: tid('send-recipients'),
    sendButton: tid('send-quote-btn'),
    sendResult: tid('send-result'),
  },
} as const;
