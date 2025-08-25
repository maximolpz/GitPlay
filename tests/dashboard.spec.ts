import { test, expect } from '@playwright/test';

test.use({ storageState: undefined });

test('Access dashboard', async ({ page }) => {
  await page.goto('/userinfo.php');
  await expect(page.locator('text=Logout test')).toBeVisible();
});
