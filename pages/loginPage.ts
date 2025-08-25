import { Page, expect } from '@playwright/test';

export class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/login.php');
  }

  async login(username: string, password: string) {
    await this.page.fill('input[name="uname"]', username);
    await this.page.fill('input[name="pass"]', password);
    await this.page.click('input[value="login"]');
  }

  async assertLoggedIn() {
    await expect(this.page.locator('text=Logout test')).toBeVisible();
  }
}
