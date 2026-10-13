import { expect, Page } from '@playwright/test';
import { selectors } from '../selectors';

const s = selectors.quoteForm;

export interface QuoteFormData {
  companyName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  sku?: string;
  quantity?: number;
  generalInquiry?: boolean;
  notes?: string;
}

export class QuoteFormPage {
  constructor(readonly page: Page) {}

  async openFromAdmin() {
    await this.page.goto(selectors.admin.path);
    await this.page.click(selectors.admin.sendQuoteNav);
    await expect(this.page).toHaveURL(new RegExp(`${s.adminPath}$`));
  }

  async openAdmin() {
    await this.page.goto(s.adminPath);
  }

  async openGuest() {
    await this.page.goto(s.guestPath);
  }

  async lookupCustomer(email: string) {
    await this.page.fill(s.lookupEmail, email);
    await this.page.click(s.lookupButton);
    const result = this.page.locator(s.lookupResult);
    await expect(result).not.toBeEmpty();
    return result;
  }

  async fill(data: QuoteFormData) {
    if (data.companyName !== undefined) await this.page.fill(s.companyName, data.companyName);
    if (data.contactName !== undefined) await this.page.fill(s.contactName, data.contactName);
    if (data.email !== undefined) await this.page.fill(s.email, data.email);
    if (data.phone !== undefined) await this.page.fill(s.phone, data.phone);
    if (data.sku !== undefined) await this.page.selectOption(s.product, data.sku);
    if (data.quantity !== undefined) await this.page.fill(s.quantity, String(data.quantity));
    if (data.generalInquiry) await this.page.check(s.generalInquiry);
    if (data.notes !== undefined) await this.page.fill(s.notes, data.notes);
  }

  submit() {
    return this.page.click(s.submit);
  }

  fieldError(field: string) {
    return this.page.locator(s.fieldError(field));
  }

  async expectCreated(): Promise<string> {
    await expect(this.page.locator(s.success)).toBeVisible();
    const number = (await this.page.locator(s.quoteNumber).textContent())!.trim();
    expect(number).not.toBe('');
    return number;
  }

  async expectBlocked() {
    await expect(this.page.locator(s.success)).toBeHidden();
  }
}
