import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { codeAt, stepAt } from '../../src/server/totp';
import { decodeBase32 } from '../helpers';
// 每个页面至少一条用例(proposal §8):激活、成员、审计、设置、登录。一条连贯的流程,按页面分步。
const password = 'correct horse battery staple';
let secret: Buffer = Buffer.alloc(0);
let lastStep = 0;
/**
 * 每次取一个比上次更新的时间片(同一时间片的验证码只能用一次)。服务端最多接受往后一个时间片,
 * 超出时等到下一个 30 秒边界。
 */
async function nextCode(page: Page): Promise<string> {
  lastStep = Math.max(lastStep + 1, stepAt(Date.now()));
  while (lastStep > stepAt(Date.now()) + 1) await page.waitForTimeout(1000);
  return codeAt(secret, lastStep);
}
test('workspace access pages', async ({ page }) => {
  const { inviteToken } = JSON.parse(readFileSync('test-results/browser-state.json', 'utf8'));

  await test.step('activation: password, authenticator, recovery codes', async () => {
    await page.goto(`/activate?token=${inviteToken}`);
    await expect(page.getByText('Browser Owner · owner@example.test')).toBeVisible();
    await page.getByLabel('Password (12–200 characters)').fill(password);
    await page.getByLabel('Confirm password').fill(password);
    secret = decodeBase32((await page.locator('code').first().textContent())!.trim());
    lastStep = stepAt(Date.now()) - 2;
    await page.getByLabel('6-digit code').fill(await nextCode(page));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('listitem')).toHaveCount(10);
    const continueButton = page.getByRole('button', { name: 'Continue' });
    await expect(continueButton).toBeDisabled();
    await page.getByLabel('I have saved these codes').check();
    await continueButton.click();
    await expect(page).toHaveURL(/\/w\/internal\/organizations$/);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  await test.step('team members: invite, change role, dialogs close with Escape', async () => {
    await page.getByRole('link', { name: 'Team members' }).click();
    await expect(page.getByRole('heading', { name: 'Team members' })).toBeVisible();
    await page.getByRole('button', { name: 'Add member' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add member' });
    await expect(dialog.getByLabel('Name')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Add member' }).click();
    await dialog.getByLabel('Name').fill('Tia Trader');
    await dialog.getByLabel('Email').fill('tia@example.test');
    await dialog.getByLabel(/^editor/).check();
    await dialog.getByRole('button', { name: 'Create invite' }).click();
    const link = page.getByRole('dialog', { name: 'Invite link' });
    await expect(link.locator('pre')).toContainText('/activate?token=');
    await link.getByRole('button', { name: 'Done' }).click();
    const row = page.getByRole('row', { name: /Tia Trader/ });
    await expect(row).toContainText('Invited');
    await row.getByRole('button', { name: 'Manage' }).click();
    const manage = page.getByRole('dialog', { name: 'Tia Trader' });
    await manage.getByLabel('Role').selectOption('trader');
    await manage.getByRole('button', { name: 'Change role' }).click();
    await expect(manage.getByRole('button', { name: 'Change role' })).toBeDisabled();
    // 保存中不响应 Escape(frontend-spec 0.3);等操作结束。
    await expect(manage.getByRole('button', { name: 'Resend invite' })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(manage).toBeHidden();
    await expect(page.getByRole('row', { name: /Tia Trader/ })).toContainText('trader');
  });

  await test.step('audit log: events, expand, filters in the URL', async () => {
    await page.getByRole('link', { name: 'Audit log' }).click();
    const roleRow = page.getByRole('row', { name: /Role changed/ });
    await expect(roleRow).toBeVisible();
    // 发送通道未配置(D5):写请求结束后 outbox 投递,记为 Failed。
    await expect(roleRow).toContainText('Failed');
    await roleRow.click();
    await expect(page.getByRole('row', { name: 'role editor trader', exact: true })).toBeVisible();
    await page.getByLabel('Category').selectOption('login');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/category=login/);
    await expect(page.getByText('No matching events.')).toBeVisible();
    await page.goto('/w/internal/audit?category=members');
    await expect(page.getByRole('row', { name: /Member invited/ }).first()).toBeVisible();
  });

  await test.step('settings: API token, language, recovery codes with step-up', async () => {
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Create token' }).click();
    const create = page.getByRole('dialog', { name: 'Create token' });
    await create.getByLabel('Name').fill('migration agent');
    await create.getByLabel('Role').selectOption('admin');
    await create.getByRole('button', { name: 'Create' }).click();
    const shown = page.getByRole('dialog', { name: 'API token' });
    await expect(shown.locator('pre')).toHaveText(/^obt_/);
    await shown.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('row', { name: /migration agent/ })).toContainText('active');

    const save = page.getByRole('button', { name: 'Save preferences' });
    await expect(save).toBeDisabled();
    await page.getByLabel('Display language').selectOption('ko');
    await save.click();
    await expect(page.getByText('Language preference saved.')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko');

    await page.getByRole('button', { name: 'Regenerate recovery codes' }).click();
    const confirm = page.getByRole('dialog', { name: 'Confirm with your authenticator code' });
    await confirm.getByLabel('6-digit code').fill('000000');
    await confirm.getByRole('button', { name: 'Confirm' }).click();
    await expect(confirm.getByRole('alert')).toHaveText('The code is incorrect.');
    await confirm.getByLabel('6-digit code').fill(await nextCode(page));
    await confirm.getByRole('button', { name: 'Confirm' }).click();
    const codes = page.getByRole('dialog', { name: 'New recovery codes' });
    await expect(codes.locator('pre')).toHaveText(/^([a-z0-9]{4}-){2}[a-z0-9]{4}(\n|$)/);
    await codes.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('10 unused recovery codes.')).toBeVisible();
  });

  await test.step('sign out, then sign in on the same deep link', async () => {
    await page.goto('/w/internal/members');
    await signOut(page);
    await expect(page).toHaveURL(/\/w\/internal\/members$/);
    await page.getByLabel('Email').fill('owner@example.test');
    await page.getByLabel('Password').fill(password);
    await page.getByLabel('Authenticator code').fill('123456');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Email, password or code is incorrect.');
    await page.getByLabel('Password').fill(password);
    await page.getByLabel('Authenticator code').fill(await nextCode(page));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Team members' })).toBeVisible();
    await expect(page).toHaveURL(/\/w\/internal\/members$/);
  });
});
async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}
