import { test } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

require('dotenv').config();

test('User can login', async ({ page }) => {
  
  const email = process.env.USER_EMAIL;
  const password = process.env.USER_PASSWORD;

  if (!email) throw new Error('Falta USER_EMAIL en las variables de entorno');
  if (!password) throw new Error('Falta USER_PASSWORD en las variables de entorno');

  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(email, password);
  await loginPage.assertLoggedIn();
  
  await page.context().storageState({ path: 'storageState.json' });
});
