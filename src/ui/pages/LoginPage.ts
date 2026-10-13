import { Page } from '@playwright/test';
import { selectors } from '../selectors';

export class LoginPage {
  constructor(private page: Page) {}

  async login(email: string, password: string, next = '/admin') {
    const s = selectors.login;
    await this.page.goto(`${s.path}?next=${encodeURIComponent(next)}`);
    await this.page.fill(s.email, email);
    await this.page.fill(s.password, password);
    await this.page.click(s.submit);
    await this.page.waitForURL((url) => !url.pathname.startsWith(s.path));
  }
}
