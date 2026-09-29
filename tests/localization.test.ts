import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { parse } from 'vue/compiler-sfc';
import {
  baseParse,
  NodeTypes,
  type AttributeNode,
  type DirectiveNode,
  type RootNode,
  type TemplateChildNode,
} from '@vue/compiler-dom';
import { messages } from '../src/locales';
import { messageKey, translate, dateLocale } from '../src/shared/localization';
import { isLocale } from '../src/shared/locale';
import { columns } from '../src/shared/columns';
import { tabs } from '../src/shared/registry';
import { tagDefinitions } from '../src/shared/tags';
import { knowledgeFields } from '../src/shared/knowledge';
import { onboardingTemplate, laneNames, taskStates } from '../src/shared/operations';
import { taskGuidance } from '../src/shared/focus';
import { flagLabels, statusLabel } from '../src/shared/accounts';
import { fieldLabels, fieldRules } from '../src/shared/hft';
import { auditActionLabels, auditCategoryLabels } from '../src/shared/audit';
import { roleLabels } from '../src/web/api';
// 界面语言(frontend-spec 2.10):从 v1 tests/localization.test.ts 迁移,另加 v2 页面的覆盖检查。

const keys = new Set(messages.map((row) => messageKey(row[0])));
const placeholders = (value: string) => [...new Set(value.match(/\{\d+\}/g) || [])].sort();
const missing = (texts: readonly (string | null | undefined)[]) => [
  ...new Set(texts.filter((t): t is string => !!t && !keys.has(messageKey(t)))),
];

test('all messages have complete translations and preserve interpolation parameters', () => {
  const seen = new Map<string, readonly string[]>();
  for (const [english, chinese, korean] of messages) {
    assert.ok(english.trim() && chinese.trim() && korean.trim(), english);
    assert.deepEqual(placeholders(chinese), placeholders(english), english + ' (Chinese)');
    assert.deepEqual(placeholders(korean), placeholders(english), english + ' (Korean)');
    const key = messageKey(english);
    const previous = seen.get(key);
    if (previous)
      assert.deepEqual([chinese, korean], previous, 'Conflicting translations: ' + english);
    seen.set(key, [chinese, korean]);
  }
});

test('localized text preserves names, original content and placeholders in user values', () => {
  assert.equal(translate('zh-CN', 'Settings'), '设置');
  assert.equal(translate('ko', 'Settings'), '설정');
  for (const locale of ['en', 'zh-CN', 'ko'] as const) {
    assert.equal(translate(locale, 'CoinGecko'), 'CoinGecko');
    assert.equal(translate(locale, 'Binance / Sia {original}'), 'Binance / Sia {original}');
    const value = 'CoinGecko <original> {1}';
    assert.ok(translate(locale, 'Source: {0}', [value]).includes(value));
  }
  assert.equal(translate('en', '{0} of {1}', [2, 9]), '2 of 9');
  assert.equal(dateLocale('ko'), 'ko-KR');
  assert.equal(isLocale('fr'), false);
  assert.equal(isLocale('zh-CN'), true);
});

test('every registered tab, metric, tag, field, standard task and v2 label has translations', () => {
  assert.deepEqual(
    missing([
      ...columns.flatMap((c) => [c.title, c.description]),
      ...tabs.flatMap((t) => [t.title, t.description]),
      ...Object.values(tagDefinitions).flatMap((t) => [t.title, t.plural]),
      ...Object.values(knowledgeFields).flatMap((fields) =>
        fields.flatMap((f) => [f.label, f.hint]),
      ),
      ...onboardingTemplate.flatMap((t) => [t.title, t.description]),
      ...Object.values(taskGuidance).flatMap((t) => [t.nextStep, t.completionCriteria]),
      ...Object.values(laneNames),
      ...Object.values(taskStates),
      ...Object.values(statusLabel),
      ...Object.values(flagLabels).map(([, label]) => label),
      ...Object.values(fieldLabels),
      ...Object.values(fieldRules),
      ...Object.values(auditActionLabels),
      ...Object.values(auditCategoryLabels),
      ...Object.values(roleLabels),
      ...runtimeMessages,
    ]),
    [],
  );
});

// v2 页面在脚本里设置、经 tr(变量) 显示的文案(静态扫描看不到)。
const runtimeMessages = [
  'Invited',
  'Active',
  'Disabled',
  'Expired',
  'Revoked',
  'Test',
  'Language preference saved.',
  'The passwords do not match.',
  'Password changed.',
  'Reset this member’s authenticator? They are signed out and need a new link.',
  'Disable this member? Their session ends and all API tokens are revoked.',
  'Reads team information. Cannot change anything.',
  'Adds and edits organizations, records and tasks.',
  'Editor, plus trading accounts, API keys and HFT configuration.',
  'Everything, plus members, data sources and the audit log.',
  'Nothing has changed.',
  'Not a valid IP address.',
  'Add at least one IP address. Only test accounts can omit it.',
  'Fix the IP whitelist.',
  'Portfolio group must not start or end with a space.',
  'Client name must not start or end with a space.',
  'VIP level must be a whole number from 0 to 255.',
  'Market maker level must be a whole number from 0 to 255.',
  'Account type',
  'VIP level',
  'Market maker level',
  'Client name',
  'IP whitelist',
  'Owner',
  'Group {0} (gross / |net| USD)',
  'Fix the problems marked above.',
  'Required.',
  'Remove the spaces at the start or end.',
  'Use BaseAsset_<asset> or Beta_<name>.',
  'This prediction group is listed twice.',
  'Max gross exposure must be greater than 0.',
  'Max |net| exposure must be greater than 0 and not above the gross limit.',
  'Must be a whole number greater than 0.',
  'Must be greater than 0.',
  'Must be greater than 0 and not above the gross limit.',
  'Must be between 0 and 1, exclusive.',
];

// v2 新增接口的错误信息:页面用 tr(错误) 显示,要有译文。v1 移植来的接口与 v1 一致,暂不要求。
test('server error messages of v2 pages have translations', () => {
  const found: string[] = [];
  for (const file of ['access', 'accounts', 'app', 'auth', 'hft', 'members', 'tokens']) {
    const path = `src/server/${file}.ts`;
    const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'problem'
      ) {
        const message = node.arguments[1];
        if (message && ts.isStringLiteralLike(message)) found.push(message.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  assert.deepEqual(missing(found), []);
});

// ---- 组件:tr('…') 的字面量都有译文;模板里没有未经 tr 的英文 ----
/** 不翻译的固定写法:技术标识、格式示例、版本号前缀(spec 2.10「不翻译」)。 */
const untranslated = new Set([
  'SHA-256',
  'v',
  '· v',
  'https://…',
  'https://www.linkedin.com/in/…',
  'YYYY / YYYY-MM / YYYY-MM-DD',
  'Omniboard',
  'Omniboard /',
  'BaseAsset_BTC',
  '52.1.2.3 Neo EIP',
]);
/** 显示给人的属性。 */
const textAttributes = new Set([
  'placeholder',
  'aria-label',
  'title',
  'alt',
  'label',
  'eyebrow',
  'description',
  'submit-label',
]);
type Finding = { file: string; text: string };
function inspectExpression(code: string, file: string, out: { keys: Finding[]; bare: Finding[] }) {
  const ast = ts.createSourceFile(file, `(${code})`, ts.ScriptTarget.Latest, true);
  const bare = (text: string) => {
    const t = text.trim();
    // 形如 'unknown' 的小写单词是枚举值,交给下游的标签函数,不是文案。
    if (/[A-Za-z]{2,}/.test(t) && !/^[a-z_]+$/.test(t) && !untranslated.has(t))
      out.bare.push({ file, text: t });
  };
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'tr'
    ) {
      const first = node.arguments[0];
      if (first && ts.isStringLiteralLike(first) && !keys.has(messageKey(first.text)))
        out.keys.push({ file, text: first.text });
      node.arguments.slice(1).forEach(visit);
      return;
    }
    // 作为显示结果的字面量:整个表达式、三元的分支、拼接、?? / || 的回退、模板字符串的文字部分。
    const parent = node.parent;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const shown =
        ts.isParenthesizedExpression(parent) ||
        (ts.isConditionalExpression(parent) && parent.condition !== node) ||
        (ts.isBinaryExpression(parent) &&
          [
            ts.SyntaxKind.PlusToken,
            ts.SyntaxKind.BarBarToken,
            ts.SyntaxKind.QuestionQuestionToken,
          ].includes(parent.operatorToken.kind));
      if (shown) bare(node.text);
    }
    if (ts.isTemplateExpression(node)) {
      bare(node.head.text);
      node.templateSpans.forEach((span) => bare(span.literal.text));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
function inspectScript(code: string, file: string, out: { keys: Finding[]; bare: Finding[] }) {
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'tr'
    ) {
      const first = node.arguments[0];
      if (first && ts.isStringLiteralLike(first) && !keys.has(messageKey(first.text)))
        out.keys.push({ file, text: first.text });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
function scanComponents() {
  const out = { keys: [] as Finding[], bare: [] as Finding[] };
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|vue)$/.test(path)) continue;
      const file = path.replace(/.*\/src\//, 'src/');
      const source = readFileSync(path, 'utf8');
      if (!path.endsWith('.vue')) {
        inspectScript(source, file, out);
        continue;
      }
      const { descriptor } = parse(source);
      inspectScript(descriptor.scriptSetup?.content || '', file, out);
      const visit = (node: RootNode | TemplateChildNode) => {
        if (node.type === NodeTypes.TEXT) {
          const t = node.content.trim().replace(/\s+/g, ' ');
          if (/[A-Za-z]{2,}/.test(t) && !untranslated.has(t)) out.bare.push({ file, text: t });
        }
        if (
          node.type === NodeTypes.INTERPOLATION &&
          node.content.type === NodeTypes.SIMPLE_EXPRESSION
        )
          inspectExpression(node.content.content, file, out);
        if (node.type === NodeTypes.ELEMENT)
          for (const prop of node.props as (AttributeNode | DirectiveNode)[]) {
            if (prop.type === NodeTypes.ATTRIBUTE) {
              const value = prop.value?.content.trim() ?? '';
              if (
                textAttributes.has(prop.name) &&
                /[A-Za-z]{2,}/.test(value) &&
                !untranslated.has(value)
              )
                out.bare.push({ file, text: `${prop.name}="${value}"` });
            } else if (prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION) {
              const arg = prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION ? prop.arg.content : '';
              const scan = { keys: out.keys, bare: [] as Finding[] };
              inspectExpression(prop.exp.content, file, scan);
              // 只有显示给人的绑定才要求翻译;事件处理与 :to、:class 等不是文案。
              if (prop.name === 'bind' && textAttributes.has(arg)) out.bare.push(...scan.bare);
            }
          }
        if (node.type === NodeTypes.ROOT || node.type === NodeTypes.ELEMENT)
          node.children.forEach(visit);
        if (node.type === NodeTypes.IF) node.branches.forEach((b) => b.children.forEach(visit));
        if (node.type === NodeTypes.FOR) node.children.forEach(visit);
      };
      visit(baseParse(descriptor.template?.content || ''));
    }
  }
  walk(resolve('src/web'));
  return out;
}

test('literal UI translation keys stay covered when components change', () => {
  const { keys: absent } = scanComponents();
  assert.deepEqual(
    [...new Set(absent.map((f) => `${f.file}: ${f.text}`))],
    [],
    'tr() keys without translations',
  );
});

test('component templates show no English text outside tr()', () => {
  const { bare } = scanComponents();
  assert.deepEqual(
    [...new Set(bare.map((f) => `${f.file}: ${f.text}`))],
    [],
    'wrap these in tr() and add translations',
  );
});
