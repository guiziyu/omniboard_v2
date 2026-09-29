import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { codeAt, stepAt } from '../../src/server/totp';
import { decodeBase32 } from '../helpers';
// 每个页面至少一条用例(proposal §8):激活、机构目录与详情、成员、审计、设置、登录。一条连贯的流程,按页面分步。
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

  await test.step('organizations: create, tag filters, ranking, search, remembered filters', async () => {
    const main = page.getByRole('navigation', { name: 'Main' });
    await expect(page.getByRole('heading', { name: 'Organizations', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exchanges' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('heading', { name: 'No matching organizations' })).toBeVisible();

    async function add(name: string, tags: { check?: string[]; uncheck?: string[] }) {
      await page.getByRole('button', { name: 'Add organization' }).click();
      const dialog = page.getByRole('dialog', { name: 'Add organization' });
      await expect(dialog.getByLabel('Organization name')).toBeFocused();
      await dialog.getByLabel('Organization name').fill(name);
      for (const tag of tags.uncheck ?? []) await dialog.getByLabel(tag, { exact: true }).uncheck();
      for (const tag of tags.check ?? []) await dialog.getByLabel(tag, { exact: true }).check();
      await dialog.getByRole('button', { name: 'Create' }).click();
      await expect(page).toHaveURL(/\/w\/internal\/organizations\/[^/]+\/overview/);
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    }
    // 一个 tag 都不选时不能创建。
    await page.getByRole('button', { name: 'Add organization' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add organization' });
    await dialog.getByLabel('Company', { exact: true }).uncheck();
    await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await add('Acme Exchange', { check: ['Exchange'] });
    await expect(page.locator('.org-head')).toContainText('Company');
    await expect(page.locator('.org-head')).toContainText('Exchange');
    await expect(main.getByRole('link', { name: /^Organizations/ })).toContainText('1');
    await page.getByRole('button', { name: 'Back to organizations' }).click();
    await expect(page.getByRole('row', { name: /Acme Exchange/ })).toBeVisible();
    await add('Beta Bank', { uncheck: ['Company'], check: ['Bank'] });
    await expect(main.getByRole('link', { name: /^Organizations/ })).toContainText('2');
    await page.getByRole('button', { name: 'Back to organizations' }).click();

    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page).toHaveURL(/tag=all/);
    await page.getByLabel('Rank by').selectOption('name');
    const names = page.locator('table.ranking tbody button.org-name strong');
    await expect(names).toHaveText(['Beta Bank', 'Acme Exchange']);
    await page.getByRole('button', { name: /^Organization/ }).click();
    await expect(page).toHaveURL(/direction=asc/);
    await expect(names).toHaveText(['Acme Exchange', 'Beta Bank']);
    await page.getByLabel('Search organizations').fill('beta');
    await expect(page).toHaveURL(/q=beta/);
    await expect(names).toHaveText(['Beta Bank']);
    await expect(page.getByText('1–1 of 1 organizations')).toBeVisible();

    await page.getByRole('button', { name: 'Banks' }).click();
    await expect(page).not.toHaveURL(/sort=/);
    await expect(page.getByRole('columnheader', { name: /Payment markets/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await page.getByRole('button', { name: 'About Payment markets' }).first().click();
    const help = page.getByRole('region', { name: 'Payment markets explained' }).first();
    await expect(help).toContainText('Provider-reported countries or markets');
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    await page.getByText('Columns', { exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /Payment markets/ })).toBeDisabled();
    await page.getByRole('checkbox', { name: /Total assets/ }).uncheck();
    await expect(page).toHaveURL(/columns=/);
    await expect(page.getByRole('columnheader', { name: /Total assets/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // 从别的页面进入、URL 不带 query 时恢复最近的筛选(frontend-spec 2.11)。
    await page.getByRole('link', { name: 'Settings' }).click();
    await main.getByRole('link', { name: /^Organizations/ }).click();
    await expect(page).toHaveURL(/tag=bank/);
    await expect(page.getByRole('button', { name: 'Banks' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await expect(page).toHaveURL(/\/w\/internal\/organizations$/);
    await expect(page.getByRole('button', { name: 'Exchanges' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(names).toHaveText(['Acme Exchange']);
  });

  await test.step('records and metrics: add, draft, evidence, edit, history, observation', async () => {
    await page.getByRole('button', { name: 'Acme Exchange', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Market snapshot' })).toBeVisible();
    await page.getByRole('button', { name: 'Contacts', exact: true }).click();
    await expect(page).toHaveURL(/\/contacts$/);
    await expect(page.getByRole('heading', { name: 'Ready for the first insight' })).toBeVisible();

    // 草稿:有改动时关闭会先询问,重新打开可以恢复(frontend-spec 5.6)。
    await page.getByRole('button', { name: 'Add the first record' }).click();
    const editor = page.getByRole('dialog', { name: 'Add organization knowledge' });
    await expect(editor.getByLabel('Title')).toBeFocused();
    await editor.getByLabel('Title').fill('Acme institutional desk');
    await page.keyboard.press('Escape');
    await editor.getByRole('button', { name: 'Keep draft and close' }).click();
    await expect(editor).toBeHidden();
    await page.getByRole('button', { name: 'Add record' }).click();
    await editor.getByRole('button', { name: 'Restore draft' }).click();
    await expect(editor.getByLabel('Title')).toHaveValue('Acme institutional desk');

    await editor.getByLabel('Address / profile URL').fill('desk@acme.test');
    await editor.getByLabel('Business contact for / role').fill('Institutional sales');
    await editor
      .getByLabel('What has been checked, and what happens next?')
      .fill('Listed on the website.');
    await editor.getByLabel('Notes').fill('Public desk address.');
    await editor
      .getByLabel('Original text')
      .fill('  Contact desk@acme.test for institutional accounts.  ');
    await editor.getByRole('button', { name: 'Save record' }).click();
    await expect(editor).toBeHidden();

    const row = page.locator('details.record-card').filter({ hasText: 'Acme institutional desk' });
    await row.locator('summary').click();
    await expect(row).toContainText('Needs review');
    await row.getByRole('button', { name: 'Original source' }).click();
    const drawer = page.getByRole('dialog', { name: 'Original reference' });
    await expect(drawer.locator('pre')).toHaveText(
      '  Contact desk@acme.test for institutional accounts.  ',
    );
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    await row.getByRole('button', { name: 'Edit Acme institutional desk' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit record' });
    await expect(edit.getByLabel('Keep the existing original reference')).toBeChecked();
    await edit.getByLabel('Notes').fill('Public desk address. Confirmed on the website.');
    await edit.getByRole('button', { name: 'Save record' }).click();
    await expect(edit).toBeHidden();
    await expect(row).toContainText('v2');
    await row.getByRole('button', { name: 'History', exact: true }).click();
    const history = page.getByRole('dialog', { name: 'Record history' });
    await expect(history.locator('article')).toHaveCount(2);
    await page.keyboard.press('Escape');

    // 指标:从目录单元格打开数据浏览器,录入一条团队观测后排名更新(9.2、9.3)。
    await page.getByRole('button', { name: 'Back to organizations' }).click();
    await page.getByRole('button', { name: 'Inspect 24h volume for Acme Exchange' }).click();
    const explorer = page.getByRole('dialog', { name: '24h volume' });
    await expect(explorer.getByRole('heading', { name: 'No observation recorded' })).toBeVisible();
    await explorer.getByRole('button', { name: 'Add observation' }).click();
    await explorer.getByLabel('Value').fill('1500000');
    await explorer.getByLabel('Source name').fill('Acme monthly report');
    await explorer.getByLabel('Scope and assumptions').fill('Spot only, 24h to 2026-09-28.');
    await explorer.getByLabel('Original reference text').fill('24h spot volume: $1,500,000');
    await explorer.getByRole('button', { name: 'Save observation' }).click();
    await expect(explorer.getByText('Displayed value')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(explorer).toBeHidden();
    const acme = page.getByRole('row', { name: /Acme Exchange/ });
    await expect(
      acme.getByRole('button', { name: 'Inspect 24h volume for Acme Exchange' }),
    ).toHaveText('$1.50M');
    await expect(
      acme.getByRole('button', { name: 'Explain rank 1 for Acme Exchange' }),
    ).toBeVisible();
  });

  await test.step('org chart and people movements: add, move, drag, history, classify', async () => {
    await page.getByRole('button', { name: 'Acme Exchange', exact: true }).click();
    await page.getByRole('button', { name: 'Org Chart', exact: true }).click();
    await expect(page).toHaveURL(/\/org_chart$/);
    const chart = page.getByRole('region', { name: 'Interactive organization chart' });
    await expect(
      chart.getByRole('heading', { name: 'Build this organization’s people map' }),
    ).toBeVisible();

    // 新建人员:汇报关系默认未确认,新职位的原文同时作为关系证据(6.2、6.4)。
    await chart.getByRole('button', { name: 'Add the first person' }).click();
    const add = page.getByRole('dialog', { name: 'Add person' });
    await add.getByLabel('Role / job title').fill('Chief Executive Officer');
    await add.getByLabel('Person name', { exact: true }).fill('Casey Chief');
    await add.getByLabel('Notes').fill('Named on the team page.');
    await add.getByLabel('Original text').fill('Casey Chief, CEO');
    await add.getByRole('button', { name: 'Save person' }).click();
    await expect(add).toBeHidden();
    await page.getByRole('button', { name: 'Add person' }).click();
    await add.getByLabel('Role / job title').fill('Head of Institutional Sales');
    await add.getByLabel('Person name', { exact: true }).fill('Morgan Manager');
    await add
      .getByLabel('Reports to')
      .selectOption({ label: 'Casey Chief · Chief Executive Officer' });
    await add.getByLabel('Notes').fill('Runs the institutional desk.');
    await add.getByLabel('Original text').fill('Morgan reports to Casey (team page).');
    await add.getByRole('button', { name: 'Save person' }).click();
    await expect(add).toBeHidden();
    await expect(chart.getByText('2 people')).toBeVisible();
    await expect(chart.getByText('Unconfirmed reporting line')).toBeVisible();

    // 键盘调整:在手柄上按 Enter,改为已确认;理由为空时不能保存。
    await chart.getByRole('button', { name: 'Move Morgan Manager' }).press('Enter');
    const move = page.getByRole('dialog', { name: 'Move Morgan Manager' });
    await move.getByLabel('Relationship certainty').selectOption('confirmed');
    await expect(move.getByRole('button', { name: 'Save relationship' })).toBeDisabled();
    await move
      .getByLabel('Original evidence / reason for this change')
      .fill('Casey confirmed the reporting line on the 2026-09-28 call.');
    await move.getByRole('button', { name: 'Save relationship' }).click();
    await expect(move).toBeHidden();
    await expect(chart.getByText('Confirmed reporting line')).toBeVisible();

    await chart.getByRole('button', { name: 'View Morgan Manager' }).click();
    const person = page.getByRole('complementary', { name: 'Selected person' });
    await expect(person).toContainText('Confirmed direct report');
    await person.getByRole('button', { name: 'History' }).click();
    const history = page.getByRole('dialog', { name: 'Record history' });
    await expect(history.locator('article')).toHaveCount(2);
    await expect(history.locator('article').first()).toContainText('Casey Chief · Confirmed');
    await page.keyboard.press('Escape');
    await expect(history).toBeHidden();

    // 拖拽:拖到机构根区域 = 移到顶层,松开后打开确认对话框并预填顶层。
    // 选中人员时侧栏会滚进视口,先把根区域滚回来再量坐标。
    await chart.locator('.chart-root-area').scrollIntoViewIfNeeded();
    const handle = (await chart
      .getByRole('button', { name: 'Move Morgan Manager' })
      .boundingBox())!;
    const root = (await chart.locator('.chart-root-area').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x, handle.y - 20, { steps: 4 });
    await page.mouse.move(root.x + root.width / 2, root.y + root.height / 2, { steps: 8 });
    await expect(chart.getByText('Drop here to remove the recorded manager')).toBeVisible();
    await page.mouse.up();
    await expect(move).toBeVisible();
    await expect(move.getByLabel('Reports to')).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(move).toBeHidden();

    await chart.getByRole('button', { name: 'List', exact: true }).click();
    await expect(chart.getByRole('row', { name: /Morgan Manager/ })).toContainText(
      'Confirmed direct report',
    );

    // 人员变动:按本机构视角分类,月份精度原样显示(6.5、6.8)。
    await page.getByRole('button', { name: 'People Movements', exact: true }).click();
    await page.getByRole('button', { name: 'Add the first record' }).click();
    const editor = page.getByRole('dialog', { name: 'Add organization knowledge' });
    await editor.getByLabel('Title').fill('Robin Fixture leaves Acme');
    await editor.getByLabel('Person name', { exact: true }).fill('Robin Fixture');
    await editor.getByLabel('Event described by source').selectOption('left');
    await editor.getByLabel('Date precision').selectOption('month');
    await editor.getByLabel('Event month').fill('2026-04');
    await editor.getByLabel('Previous role').fill('Trader');
    await expect(editor.getByRole('status')).toHaveText(
      'In Acme Exchange, this will appear as: Departed',
    );
    await editor.getByLabel('Notes').fill('Farewell post.');
    await editor.getByLabel('Original text').fill('Robin: last day at Acme was in April 2026.');
    await editor.getByRole('button', { name: 'Save record' }).click();
    await expect(editor).toBeHidden();
    const movements = page.getByRole('region', { name: 'People Movements', exact: true });
    await expect(movements.getByRole('button', { name: 'Departed 1', exact: true })).toBeVisible();
    await expect(movements.locator('details[open]')).toHaveCount(0);
    await movements.getByText('Robin Fixture', { exact: true }).click();
    await expect(movements).toContainText('Next organization not recorded');
    await expect(movements).toContainText('2026-04 · Month only');
    await movements.getByRole('button', { name: 'Edit movement', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit record' });
    await edit.getByLabel('Previous role').fill('Senior Trader');
    await edit.getByRole('button', { name: 'Save record' }).click();
    await expect(edit).toBeHidden();
    await expect(movements).toContainText('Senior Trader');
    await page.getByRole('button', { name: 'Back to organizations' }).click();
  });

  await test.step('discussion: draft, post, reply, edit, contact conversation history', async () => {
    await page.getByRole('button', { name: 'Acme Exchange', exact: true }).click();
    await page.getByRole('button', { name: 'Comments', exact: true }).click();
    await expect(
      page.getByText('No discussion yet. Start with a question or a short update.'),
    ).toBeVisible();
    const compose = page.getByLabel('Share an update or ask the team');
    const post = page.getByRole('button', { name: 'Post update' });
    await expect(post).toBeDisabled();
    const message = 'Acme asked for a sandbox.\nNeeds a decision by Friday.';
    await compose.fill(message);
    // 草稿:离开 tab 再回来可以恢复(5.9)。
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: 'Comments', exact: true }).click();
    await page.getByRole('button', { name: 'Restore draft' }).click();
    await expect(compose).toHaveValue(message);
    await post.click();
    await expect(compose).toHaveValue('');
    const thread = page.locator('article.discussion-message');
    await expect(thread).toContainText('Needs a decision by Friday.');

    await thread.getByRole('button', { name: 'Reply' }).click();
    await expect(page.getByText('Replying to Browser Owner')).toBeVisible();
    await expect(compose).toBeFocused();
    await compose.fill('Sandbox approved.');
    await post.click();
    await expect(thread.locator('.discussion-reply')).toContainText('Sandbox approved.');
    await thread
      .locator('.discussion-reply')
      .getByRole('button', { name: 'Original reference' })
      .click();
    const drawer = page.getByRole('dialog', { name: 'Original reference' });
    await expect(drawer.locator('pre')).toHaveText('Sandbox approved.');
    await page.keyboard.press('Escape');

    await thread.getByRole('button', { name: 'Edit', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit record' });
    await edit.getByLabel('Message').fill('Acme asked for a sandbox. Decision due Friday.');
    await edit.getByRole('button', { name: 'Save record' }).click();
    await expect(edit).toBeHidden();
    await expect(thread.first()).toContainText('Decision due Friday.');

    // 联系人对话记录:只列关联到这个联系人的讨论。
    await page.getByRole('button', { name: 'Contacts', exact: true }).click();
    await page
      .getByRole('button', { name: 'Conversation history for Acme institutional desk' })
      .click();
    const history = page.getByRole('dialog', { name: 'Acme institutional desk' });
    await expect(history.getByText('No conversations recorded yet.')).toBeVisible();
    await history
      .getByLabel('Record a conversation')
      .fill('Called the desk; onboarding pack sent.');
    await history.getByRole('button', { name: 'Post update' }).click();
    await expect(history.locator('article.discussion-message')).toHaveCount(1);
    await expect(history).toContainText('onboarding pack sent');
    await page.keyboard.press('Escape');
    await expect(history).toBeHidden();
    await page.getByRole('button', { name: 'Comments', exact: true }).click();
    await expect(page.locator('article.discussion-message')).toHaveCount(2);
    await page.getByRole('button', { name: 'Back to organizations' }).click();
  });

  await test.step('relationships: graph, evidence, return state, shared object, claims, links', async () => {
    await page.getByRole('button', { name: 'Acme Exchange', exact: true }).click();
    await page.getByRole('button', { name: 'Relationships', exact: true }).click();
    const graph = page.getByRole('region', { name: 'Relationship graph', exact: true });
    // 组织架构图的两位人员各有自动人员档案,汇报线画在档案之间(6.4、7.4)。
    const morgan = graph.getByRole('button', {
      name: 'Person Morgan Manager Shared object',
      exact: true,
    });
    await expect(morgan).toBeVisible();
    await expect(
      graph.getByRole('button', { name: 'Person Casey Chief Shared object', exact: true }),
    ).toBeVisible();
    // 水平的 SVG 路径没有高度,用键盘触发。
    const line = graph.getByRole('button', {
      name: 'Morgan Manager → Casey Chief · Reports to',
      exact: true,
    });
    await line.press('Enter');
    const details = page.getByRole('region', { name: 'Relationship details' });
    await expect(details).toContainText('Confirmed relationship');
    await details.getByRole('button', { name: 'Read relationship evidence' }).click();
    const drawer = page.getByRole('dialog', { name: 'Original reference' });
    await expect(drawer).toContainText('Casey confirmed the reporting line');
    await page.keyboard.press('Escape');

    // 视图状态:离开再后退时恢复深度、历史、缩放和已选关系(7.8)。
    await page.getByRole('checkbox', { name: 'Include history', exact: true }).check();
    await graph.getByRole('combobox', { name: 'Explore depth', exact: true }).selectOption('2');
    await graph.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await graph.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await line.press('Enter');
    const zoom = await graph.getByRole('button', { name: 'Reset zoom', exact: true }).textContent();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(page).toHaveURL(/\/overview$/);
    await page.goBack();
    await expect(graph.getByRole('combobox', { name: 'Explore depth', exact: true })).toHaveValue(
      '2',
    );
    await expect(
      page.getByRole('checkbox', { name: 'Include history', exact: true }),
    ).toBeChecked();
    await expect(graph.getByRole('button', { name: 'Reset zoom', exact: true })).toHaveText(zoom!);
    await expect(details).toContainText('Confirmed relationship');

    // 新增共享对象:必须选一条已有来源记录(7.10)。
    await page.getByRole('button', { name: 'Add shared object' }).click();
    const create = page.getByRole('dialog', { name: 'Add a shared object' });
    await create.getByLabel('Name').fill('Acme spot API');
    await create.getByLabel('Scope').fill('Spot');
    await create
      .getByLabel('Existing source record')
      .selectOption({ label: 'Acme Exchange · Acme institutional desk' });
    await create.getByRole('button', { name: 'Save' }).click();
    await expect(create).toBeHidden();
    await expect(page).toHaveURL(/object=/);
    await expect(page.getByRole('heading', { name: 'Acme spot API' })).toBeVisible();
    const identity = page.getByRole('region', { name: 'Identity across organizations' });
    await expect(identity).toContainText('Linked records · 1');

    // 两条不同的结论同 scope → 冲突;采纳一条,另一条成为历史(7.11–7.13)。
    for (const value of ['Read-only keys', 'Trading keys']) {
      await page.getByRole('button', { name: 'Add evidence' }).click();
      const claim = page.getByRole('dialog', { name: 'Record a sourced fact' });
      await claim.getByLabel('Value').fill(value);
      await expect(claim.getByLabel('Exact scope')).toHaveValue('Spot');
      await claim.getByLabel('Original information').fill(`Desk email: ${value} are available.`);
      await claim.getByRole('button', { name: 'Save' }).click();
      await expect(claim).toBeHidden();
    }
    await page.getByRole('button', { name: 'Compare evidence 2', exact: true }).click();
    const trading = page.getByRole('article').filter({ hasText: 'Trading keys' });
    await expect(trading).toContainText('Conflicting sources');
    await trading.getByRole('button', { name: 'Review & adopt' }).click();
    const review = page.getByRole('dialog', { name: 'Review the current interpretation' });
    await review
      .getByLabel('Reason for this decision')
      .fill('Signed desk agreement covers trading.');
    await review.getByRole('button', { name: 'Adopt with decision record' }).click();
    await expect(review).toBeHidden();
    // 冲突解除后分组默认收起,展开后看结论与历史。
    await page.getByText('API permission', { exact: true }).click();
    await expect(trading).toContainText('Adopted by team');
    await expect(page.getByRole('article').filter({ hasText: 'Read-only keys' })).toContainText(
      'Previous interpretation',
    );
    await trading.getByText('Decision trail', { exact: true }).click();
    await expect(trading).toContainText('Signed desk agreement covers trading.');

    // 跨机构关联:打开时按对象名搜索;选了候选且写了理由才能确认。
    await identity.getByRole('button', { name: 'Link across organizations' }).click();
    const link = page.getByRole('dialog', { name: 'Link across organizations' });
    await expect(link.getByRole('textbox', { name: 'Search identities and records' })).toHaveValue(
      'Acme spot API',
    );
    await expect(link.getByRole('button', { name: 'Confirm shared identity' })).toBeDisabled();
    await link.getByRole('button', { name: 'Cancel' }).click();

    // 记录详情里的关联对象链接,以及人员变动的「探索此人身份」(5.2、6.5)。
    await page.getByRole('button', { name: 'Contacts', exact: true }).click();
    const desk = page.locator('details.record-card').filter({ hasText: 'Acme institutional desk' });
    await desk.locator('summary').click();
    await desk.getByRole('link', { name: 'Acme spot API · Connections & evidence' }).click();
    await expect(page.getByRole('heading', { name: 'Acme spot API' })).toBeVisible();
    await page.getByRole('button', { name: 'People Movements', exact: true }).click();
    await page.getByText('Robin Fixture', { exact: true }).click();
    await page.getByRole('link', { name: 'Explore identity' }).click();
    await expect(page.getByRole('heading', { name: 'Robin Fixture' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to organizations' }).click();
  });

  await test.step('work: standard onboarding, task actions, dependencies, follow-up tasks', async () => {
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Work' }).click();
    await expect(page.getByRole('heading', { name: 'Work', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No active plan yet' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add from new information' })).toBeDisabled();
    await page
      .getByRole('combobox', { name: 'Organization' })
      .selectOption({ label: 'Acme Exchange' });
    await expect(page).toHaveURL(/organizationId=.*state=actionable/);

    // 启动标准接入计划:9 项,只有 3 项可以马上开始(10.5)。
    await page.getByRole('button', { name: 'Start standard onboarding' }).click();
    const start = page.getByRole('dialog', { name: 'Start standard onboarding' });
    await expect(start.locator('.template-task')).toHaveCount(9);
    await start.getByRole('button', { name: 'Create onboarding plan' }).click();
    await expect(start).toBeHidden();
    await expect(page.getByRole('button', { name: 'Start standard onboarding' })).toBeHidden();
    const rows = page.locator('.task-queue-row');
    await expect(rows).toHaveCount(3);

    // 开始、完成,看解除阻塞的下游(10.4)。
    await rows.filter({ hasText: 'Define account and product scope' }).click();
    const scope = page.getByRole('dialog', { name: 'Define account and product scope' });
    await expect(scope.getByLabel('Task action')).toHaveValue('active');
    await expect(scope.getByLabel('Assign this task to me')).toBeChecked();
    await scope.getByRole('button', { name: 'Start work' }).click();
    await expect(scope.getByRole('status')).toContainText('Task updated.');
    await expect(scope.locator('.task-state').first()).toHaveText('In progress');
    await scope.getByLabel('Task action').selectOption('done');
    await scope.getByLabel('Result or follow-up').fill('Entity and spot products agreed.');
    await scope.getByLabel('Original evidence or decision note').fill('Scope memo from the desk.');
    await scope.getByRole('button', { name: 'Complete task' }).click();
    const feedback = scope.getByRole('status');
    await expect(feedback).toContainText('Task completed. Your result and evidence are saved.');
    await expect(feedback).toContainText('Confirm product and regional eligibility');
    await feedback
      .getByRole('button', { name: /Review the API and connector requirements/ })
      .click();
    const docs = page.getByRole('dialog', { name: 'Review the API and connector requirements' });
    await expect(docs).toBeVisible();
    await expect(docs.getByRole('heading', { name: 'Prerequisites' })).toBeVisible();

    // 依赖图:点节点回到该任务的详情(10.7)。
    await docs.getByRole('button', { name: 'View dependencies' }).click();
    const map = page.getByRole('dialog', { name: 'Task dependencies' });
    await expect(map.locator('.task-map-node')).toHaveCount(3);
    await map.getByLabel('Focus task path').selectOption('');
    await expect(map.locator('.task-map-node')).toHaveCount(9);
    await map.getByRole('button', { name: /Validate the connection for our account/ }).click();
    await expect(map).toBeHidden();
    const validation = page.getByRole('dialog', {
      name: 'Validate the connection for our account',
    });
    await expect(validation.locator('.task-state').first()).toHaveText('Waiting for prerequisites');
    await page.keyboard.press('Escape');
    await expect(validation).toBeHidden();

    // 看板、全部任务;过滤写在 URL,并被记住(10.1、10.2)。
    await page.getByRole('button', { name: 'Board' }).click();
    await expect(page).toHaveURL(/layout=board/);
    await expect(page.locator('.kanban-column')).toHaveCount(1);
    await page.getByRole('button', { name: 'List' }).click();
    await page.getByRole('combobox', { name: 'Status' }).selectOption('');
    await expect(rows).toHaveCount(9);
    await nav.getByRole('link', { name: 'Organizations' }).click();
    await nav.getByRole('link', { name: 'Work' }).click();
    await expect(page).toHaveURL(/organizationId=.*state=&/);
    await expect(rows).toHaveCount(9);

    // 从记录创建跟进任务:来源预填,可见性继承记录(10.6);关系页列出相关工作(7.9)。
    await nav.getByRole('link', { name: 'Organizations' }).click();
    await page.getByRole('button', { name: 'Acme Exchange', exact: true }).click();
    await page.getByRole('button', { name: 'Contacts', exact: true }).click();
    const desk = page.locator('details.record-card').filter({ hasText: 'Acme institutional desk' });
    await desk.locator('summary').click();
    await desk.getByRole('link', { name: 'Create follow-up task' }).click();
    const plan = page.getByRole('dialog', { name: 'New information → New task' });
    await expect(plan.getByLabel('Task title')).toHaveValue('Follow up: Acme institutional desk');
    await expect(plan.getByLabel('Source record')).not.toHaveValue('');
    await plan.getByLabel('Next concrete step').fill('Ask the desk for API documentation.');
    await plan.getByRole('button', { name: 'Save task' }).click();
    await expect(plan).toBeHidden();
    await expect(page).not.toHaveURL(/sourceRecord=/);
    await expect(rows.filter({ hasText: 'Follow up: Acme institutional desk' })).toHaveCount(1);

    await nav.getByRole('link', { name: 'Organizations' }).click();
    await page.getByRole('button', { name: 'Acme Exchange', exact: true }).click();
    await page.getByRole('button', { name: 'Contacts', exact: true }).click();
    await desk.locator('summary').click();
    await desk.getByRole('link', { name: 'Acme spot API · Connections & evidence' }).click();
    await page.getByRole('link', { name: /Follow up: Acme institutional desk/ }).click();
    const followUp = page.getByRole('dialog', { name: 'Follow up: Acme institutional desk' });
    await expect(followUp).toContainText('Ask the desk for API documentation.');
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/task=/);
    await nav.getByRole('link', { name: 'Organizations' }).click();
  });

  await test.step('onboarding and connectors: request engineering help, progress, requests, board', async () => {
    const nav = page.getByRole('navigation', { name: 'Main' });
    await page.getByRole('button', { name: 'Acme Exchange', exact: true }).click();
    await page.getByRole('button', { name: 'Onboarding', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Next actions' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Show full plan/ })).toBeVisible();
    const requests = page.locator('details.integration-plans');
    await expect(requests).toContainText('0 requests');

    // 接入记录选了「Request engineering help」→ 这一版生成请求(11.1)。
    await page.getByRole('button', { name: 'Add record' }).click();
    const editor = page.getByRole('dialog', { name: 'Add organization knowledge' });
    await editor.getByLabel('Title').fill('Acme API test account');
    await editor.getByLabel('Provider connection ID').fill('cex.acme');
    await editor.getByLabel('Features to connect').fill('market, trading');
    await editor.getByLabel('Product / environment scope').fill('Spot test account');
    await editor.getByLabel('Provider account name or ID').fill('acme-test-01');
    await editor.getByLabel('Request engineering help').selectOption('validate_readonly');
    await editor.getByLabel('Business owner').fill('Casey Chief');
    await editor.getByLabel('What is still needed?').fill('Awaiting API approval.');
    await editor
      .getByLabel('What has been checked, and what happens next?')
      .fill('Desk confirmed a test account is possible.');
    await editor.getByLabel('Notes').fill('Test account request.');
    await editor.getByLabel('Original text').fill('Desk email: a test account can be issued.');
    await editor.getByRole('button', { name: 'Save record' }).click();
    await expect(editor).toBeHidden();

    // 进度卡片:只有一张时默认展开,商务与技术两条轨道独立(10.9)。
    const card = page.locator('details.onboarding-card');
    await expect(card).toHaveAttribute('open', '');
    await expect(card).toContainText('Account · acme-test-01');
    await expect(card.getByRole('region', { name: 'Business access' })).toContainText(
      'Access not confirmed',
    );
    await expect(card).toContainText(/\d+ checks before engineering can proceed/);
    await requests.locator('summary').first().click();
    await expect(requests).toContainText('1 request');
    await expect(requests).toContainText('Queued for verification');
    await expect(requests).toContainText('market.spot.trade.ws');
    await expect(requests).toContainText('Awaiting resource: API account access · Casey Chief');

    // Overview 的我方工作摘要(4.8)。
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    const summary = page.getByRole('region', { name: 'Team work summary' });
    await expect(
      summary.getByRole('heading', { name: 'Our work with Acme Exchange' }),
    ).toBeVisible();
    await expect(summary).toContainText('Access not confirmed');
    await summary.getByRole('button', { name: 'Contacts, blockers & details' }).click();
    await expect(summary).toContainText('Record owner · ');

    // Connector 看板:venue → 叶子,后退回到 venue(11.6–11.8)。
    await nav.getByRole('link', { name: 'Connectors' }).click();
    await expect(page.getByRole('heading', { name: 'Connectors', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'acme', exact: true }).click();
    await expect(page).toHaveURL(/venue=acme/);
    await expect(page.getByRole('link', { name: 'Acme Exchange' })).toBeVisible();
    await page.getByRole('button', { name: 'market.spot.trade.ws', exact: true }).click();
    const leaf = page.getByRole('region', { name: 'market.spot.trade.ws' });
    await expect(leaf).toContainText('Latest verification rows');
    await expect(leaf.getByRole('cell', { name: 'passed', exact: true })).toBeVisible();
    await page.goBack();
    await expect(leaf).toBeHidden();
    await page.getByRole('button', { name: '← All connectors' }).click();
    await expect(page).toHaveURL(/\/connectors$/);
    await nav.getByRole('link', { name: 'Organizations' }).click();
  });

  await test.step('roadmap: empty lanes, milestones, filters, follow-up task, edit', async () => {
    const nav = page.getByRole('navigation', { name: 'Main' });
    await page.getByRole('button', { name: 'Acme Exchange', exact: true }).click();
    await page.getByRole('button', { name: 'Roadmap', exact: true }).click();
    await expect(page).toHaveURL(/\/roadmap$/);
    const roadmap = page.getByRole('region', { name: 'Roadmap' });
    const lanes = roadmap.locator('.roadmap-empty-lanes section');
    await expect(lanes).toHaveCount(2);

    // 空态分栏的按钮预选计划类型(10.11);窗口已过的里程碑提示待更新。
    await lanes
      .filter({ hasText: 'Our collaboration' })
      .getByRole('button', { name: 'Add milestone' })
      .click();
    const editor = page.getByRole('dialog', { name: 'Add milestone' });
    await expect(editor.getByLabel('Plan belongs to')).toHaveValue('collaboration');
    await expect(editor.getByLabel('Evidence review')).toHaveValue('unverified');
    await editor.getByLabel('Title').fill('Acme market-making agreement');
    await editor.getByLabel('Target window').fill('2025-Q4');
    await editor.getByLabel('Expected outcome').fill('Signed market-making terms.');
    await editor.getByLabel('Notes').fill('Agreed in the quarterly call.');
    await editor.getByLabel('Original text').fill('Call notes: aim to sign terms in Q4 2025.');
    await editor.getByRole('button', { name: 'Save record' }).click();
    await expect(editor).toBeHidden();
    const rows = roadmap.locator('.roadmap-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('2025 · Q4');
    await expect(rows.first()).toContainText('Target window passed');

    // 目标时间必须是真实日期(10.12)。
    await roadmap.getByRole('button', { name: 'Add milestone' }).click();
    await expect(editor.getByLabel('Plan belongs to')).toHaveValue('organization');
    await editor.getByLabel('Title').fill('Acme derivatives launch');
    await editor.getByLabel('Target window').fill('2027-Q5');
    await editor.getByLabel('Expected outcome').fill('Perpetuals open to institutions.');
    await editor.getByLabel('Notes').fill('Announced on the Acme blog.');
    await editor.getByLabel('Original text').fill('Blog: derivatives launch planned for Q2 2027.');
    await editor.getByRole('button', { name: 'Save record' }).click();
    await expect(editor).toContainText(
      'Enter a valid year, quarter, month or date for the target window.',
    );
    await editor.getByLabel('Target window').fill('2027-Q2');
    await editor.getByRole('button', { name: 'Save record' }).click();
    await expect(editor).toBeHidden();
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Acme market-making agreement');
    await expect(roadmap.locator('.roadmap-summary')).toContainText('2 Open milestones');

    // 过滤只在当前页面(10.11)。
    await roadmap.getByRole('button', { name: 'Organization plans' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('2027 · Q2');
    await roadmap.getByLabel('Milestone status').selectOption('delivered');
    await expect(roadmap).toContainText('No milestones match these filters.');
    await roadmap.getByLabel('Milestone status').selectOption('');
    await roadmap.getByRole('button', { name: 'All plans' }).click();
    await expect(rows).toHaveCount(2);

    // 跟进任务以 sourceRecordId 关联,展开后实时显示任务状态。
    const agreement = rows.filter({ hasText: 'Acme market-making agreement' });
    await agreement.locator('summary').click();
    await agreement.getByRole('link', { name: 'Create follow-up task' }).click();
    const plan = page.getByRole('dialog', { name: 'New information → New task' });
    await expect(plan.getByLabel('Source record')).not.toHaveValue('');
    await plan.getByLabel('Task title').fill('Send the draft terms to Acme');
    await plan.getByRole('button', { name: 'Save task' }).click();
    await expect(plan).toBeHidden();
    await nav.getByRole('link', { name: 'Organizations' }).click();
    await page.getByRole('button', { name: 'Acme Exchange', exact: true }).click();
    await page.getByRole('button', { name: 'Roadmap', exact: true }).click();
    await expect(agreement).toContainText('1 linked tasks');
    await agreement.locator('summary').click();
    await expect(
      agreement.getByRole('link', { name: /Send the draft terms to Acme/ }),
    ).toBeVisible();

    // 编辑进度不改证据复核(10.12)。
    await agreement.getByRole('button', { name: 'Edit milestone' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit milestone' });
    await edit.getByLabel('Milestone status').selectOption('in_progress');
    await edit.getByRole('button', { name: 'Save record' }).click();
    await expect(edit).toBeHidden();
    await expect(agreement.locator('.roadmap-badge')).toHaveText('In progress');
    await expect(agreement).toContainText('Target window passed');
    await agreement.locator('summary').click();
    await expect(agreement).toContainText('Needs review');
    await nav.getByRole('link', { name: 'Organizations' }).click();
  });

  await test.step('talent: graph names, return state, profile import, generated movements, goals', async () => {
    const nav = page.getByRole('navigation', { name: 'Main' });
    // 图谱里的人员名称链到人才库;后退回到图谱时恢复深度、历史、缩放与已选关系(7.7、7.8)。
    await page.getByRole('button', { name: 'Acme Exchange', exact: true }).click();
    await page.getByRole('button', { name: 'Relationships', exact: true }).click();
    const graph = page.getByRole('region', { name: 'Relationship graph', exact: true });
    const details = page.getByRole('region', { name: 'Relationship details' });
    await expect(details).toContainText('Confirmed relationship');
    const zoom = await graph.getByRole('button', { name: 'Reset zoom', exact: true }).textContent();
    const morgan = graph.getByRole('link', { name: 'Morgan Manager', exact: true });
    await expect(morgan).toHaveAttribute('href', /talent\?person=identity%3A/);
    await morgan.click();
    const drawer = page.getByRole('dialog', { name: 'Morgan Manager' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('region', { name: 'Goals & incentives' })).toContainText(
      'No goal or incentive information recorded.',
    );
    await page.goBack();
    await expect(graph.getByRole('combobox', { name: 'Explore depth', exact: true })).toHaveValue(
      '2',
    );
    await expect(
      page.getByRole('checkbox', { name: 'Include history', exact: true }),
    ).toBeChecked();
    await expect(graph.getByRole('button', { name: 'Reset zoom', exact: true })).toHaveText(zoom!);
    await expect(details).toContainText('Confirmed relationship');

    // 目录:组织架构、联系人、人员变动里的人都在;搜索防抖后写入 URL(6.9)。
    await nav.getByRole('link', { name: 'Talent directory' }).click();
    await expect(page).toHaveURL(/\/w\/internal\/talent$/);
    const table = page.locator('table.talent-table');
    await expect(table.getByRole('button', { name: /Casey Chief/ })).toBeVisible();
    await expect(table.getByRole('button', { name: /Robin Fixture/ })).toBeVisible();
    await page.getByLabel('Search talent').fill('Morgan');
    await expect(page).toHaveURL(/q=Morgan/);
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await table.getByRole('button', { name: /Morgan Manager/ }).click();
    await expect(page).toHaveURL(/person=identity/);

    // 从详情导入履历:预绑定当前人员,要写理由;生成的入职事件出现在机构的人员变动(6.13、6.14)。
    await drawer.getByRole('button', { name: '+ Add profile source' }).click();
    await expect(drawer).toBeHidden();
    const profile = page.getByRole('dialog', { name: 'Import personal profile' });
    await expect(profile.getByLabel('Person dossier')).not.toHaveValue('');
    await profile
      .getByLabel('Personal profile URL')
      .fill('https://uk.linkedin.com/in/Morgan-Manager-Fixture/?trk=share');
    await profile
      .getByLabel('Why this is the same person')
      .fill('Same name and role as the team page.');
    const entry = profile.getByRole('group', { name: 'Career entry 1' });
    await entry.getByLabel('Organization in directory').selectOption({ label: 'Acme Exchange' });
    await expect(entry.getByLabel('Organization name in source')).toHaveValue('Acme Exchange');
    await entry.getByLabel('Role', { exact: true }).fill('Head of Institutional Sales');
    await entry.getByLabel('Employment status').selectOption('current');
    await expect(entry.getByLabel('End date')).toBeDisabled();
    await entry.getByLabel('Start date').fill('2024-03');
    await expect(entry.getByRole('status')).toHaveText(
      'Career only: this entry will not appear in organization movement tabs.',
    );
    await entry.getByLabel('Start of this role').selectOption('joined');
    await expect(entry.getByRole('status')).toHaveText(
      'Movement events will also appear in the corresponding organization tabs.',
    );
    await profile
      .getByLabel('Original profile text')
      .fill('Morgan Manager — Head of Institutional Sales, Acme Exchange (Mar 2024–Present)');
    await profile.getByRole('button', { name: 'Save profile' }).click();
    await expect(profile).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Profile saved' })).toBeVisible();
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('.career-timeline')).toContainText('Head of Institutional Sales');
    await expect(drawer.locator('.career-timeline')).toContainText(
      '2024-03 · Month only → Present',
    );
    await drawer.getByText('Profile sources').click();
    await expect(drawer).toContainText('https://www.linkedin.com/in/morgan-manager-fixture/');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page).not.toHaveURL(/person=/);

    await nav.getByRole('link', { name: 'Organizations' }).click();
    await page.getByRole('button', { name: 'Acme Exchange', exact: true }).click();
    await page.getByRole('button', { name: 'People Movements', exact: true }).click();
    const movements = page.getByRole('region', { name: 'People Movements', exact: true });
    await movements.getByText('Morgan Manager', { exact: true }).click();
    const generated = movements.locator('details').filter({ hasText: 'Morgan Manager' });
    await expect(generated).toContainText('2024-03 · Month only');
    await expect(generated.getByRole('button', { name: 'Edit movement' })).toHaveCount(0);
    await generated.getByRole('link', { name: 'Update source profile' }).click();
    await expect(page).toHaveURL(/talent\?person=record(:|%3A)/);
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');

    // 目标与激励绑定组织架构的职位,在架构侧栏和人才详情里都能看到(6.16)。
    await nav.getByRole('link', { name: 'Organizations' }).click();
    await page.getByRole('button', { name: 'Acme Exchange', exact: true }).click();
    await page.getByRole('button', { name: 'Org Chart', exact: true }).click();
    const chart = page.getByRole('region', { name: 'Interactive organization chart' });
    await chart.getByRole('button', { name: 'View Morgan Manager' }).click();
    const person = page.getByRole('complementary', { name: 'Selected person' });
    const goals = person.getByRole('region', { name: 'Goals & incentives' });
    await goals.getByRole('button', { name: '+ Add insight' }).click();
    await goals.getByLabel(/^Type/).selectOption('kpi');
    await goals.getByLabel('Title', { exact: true }).fill('Institutional volume target');
    await goals
      .getByLabel('Summary', { exact: true })
      .fill('Desk target reported on the onboarding call.');
    await goals.getByLabel('KPI pressure').selectOption('target_reported');
    await goals.getByRole('button', { name: '+ Quantitative target' }).click();
    await goals.getByLabel('Applies to').fill('Institutional desk');
    await goals.getByLabel('Metric', { exact: true }).fill('Monthly volume');
    await goals.getByLabel('Target value').fill('250000000');
    await goals.getByLabel('Reported by / source').fill('Morgan Manager');
    await goals.getByLabel('Original evidence').fill('Morgan: the desk must add 250M monthly.');
    await goals.getByRole('button', { name: 'Save', exact: true }).click();
    const card = goals.locator('article.driver-card');
    await expect(card).toContainText('Institutional volume target');
    await expect(card).toContainText('Reported');
    await expect(card).toContainText('+250,000,000');
    await expect(card).toContainText('Unit not specified');
    await card.getByText('Source & validity').click();
    await card.getByRole('button', { name: 'Edit · v1' }).click();
    await expect(goals.getByLabel('Original evidence')).toHaveValue(
      'Morgan: the desk must add 250M monthly.',
    );
    await goals.getByRole('button', { name: 'Cancel' }).click();
    await nav.getByRole('link', { name: 'Talent directory' }).click();
    await page.getByLabel('Search talent').fill('Morgan');
    await table.getByRole('button', { name: /Morgan Manager/ }).click();
    await expect(drawer.getByRole('region', { name: 'Goals & incentives' })).toContainText(
      'Institutional volume target',
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await expect(page).toHaveURL(/\/w\/internal\/talent$/);
    await nav.getByRole('link', { name: 'Organizations' }).click();
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
