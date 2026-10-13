import { test as setup } from '@playwright/test';
import { env } from '../../config/env';
import { LoginPage } from '../../src/ui/pages/LoginPage';

setup('authenticate admin for UI tests', async ({ page }) => {
  await new LoginPage(page).login(env.credentials.admin.email, env.credentials.admin.password);
  await page.context().storageState({ path: '.auth/admin.json' });
});
