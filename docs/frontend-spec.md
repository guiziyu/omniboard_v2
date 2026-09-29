# Omniboard v2 前端功能与交互规格

- 状态:**Draft**,2026-09-29 从 v1 提炼,待逐页对照(proposal §9 第 6 步)补漏。
- 用途:与 [proposal.md](proposal.md)、[data-model.md](data-model.md) 一起构成 v2 的全部需求。按本文生成前端与对应接口;不写像素级样式,
  布局只写信息分区与先后。
- 依据:v1 仓库 `guiziyu/omniboard` f6ebc16。「来源」里的路径都相对 v1 仓库,测试文件优先;v1 归档后仍可按
  这个 commit 查。标「待核」的是代码有分支但没有测试或文档确认的意图。
- 文案:引号里的英文是 v1 的消息键(界面按 en / zh-CN / ko 翻译,见 2.10),部分小节直接写中文译名。
  v2 保留语义即可,措辞可以改。
- 规格漏写、与 v1 不一致时:先改本文,再改代码(proposal §9)。

## 0 总则

### 0.1 v2 取代的 v1 机制

本文记录 v1 用户可见的功能与交互。下列机制由 proposal 取代,相关条目已标注,v2 按 proposal 实现:

- 登录、会话、成员与角色:proposal §4(强制 TOTP、`reader` / `editor` / `trader` / `admin` 四级、
  影响实盘的操作当场重输 TOTP)。v1 的 `reader` / `editor` / `admin` 行为在 v2 中原样沿用给同名角色。
- 接入请求导出与验证结果投影:proposal §6(`omniboard.v_connector_request` 视图、直接读 `verification.v_*`)。
- 证据原件存储:S3,按 sha256 寻址;用户可见的字段与行为不变(5.10)。
- v2 新增、v1 没有的界面(激活与登录、成员管理、API 令牌、交易账户与 key 录入、`hft_config` 编辑、HFT 重启、
  审计日志、通知):见第 12 节。表结构见 [data-model.md](data-model.md)。

### 0.2 角色与可见性
- 角色 `reader` / `editor` / `admin`(2.2)。reader 的所有写操作按钮都隐藏,服务端对写请求返回 403
  "This role has read-only access.",例外只有:登出、改个人偏好、情报标记已读、关注机构。
- 记录、共享对象、证据快照、任务的可见性为 `team` / `admin`,**创建后不能改**
  ("Visibility cannot change after creation. Create a new record.")。
- 非 admin 看不到 admin 数据:不出现在列表、计数、摘要和错误文案里。直接访问时 v1 各接口返回 403
  或 404 不统一(记录历史、证据为 403;身份、岗位情报等为 404,不透露存在)。v2 统一口径,待核。
- team 数据不能引用 admin 证据("Restricted evidence requires an administrator-only item.")。

### 0.3 对话框与键盘(所有对话框、抽屉共用)
- `/` 或 `Ctrl/⌘+K`:打开全局搜索。仅在没有可见对话框、且焦点不在 input/textarea/select 时生效。
- `Escape`:关闭最上层可见对话框,等同点击它的关闭按钮;关闭按钮禁用(保存中)时无效。
- `Tab` / `Shift+Tab`:焦点困在最上层对话框内,首尾循环;焦点在对话框外时被拉回。
- 对话框出现时自动聚焦第一个 input、button 或 textarea;最后一个对话框关闭后,焦点回到打开前的元素。
- 有对话框打开时页面主体禁止滚动。
- 点击遮罩关闭对话框,保存中例外。
- 来源:tests/browser/locales.spec.ts(Escape 关闭任务对话框);src/web/App.vue keyboard()/MutationObserver;docs/architecture.md §Navigation

### 0.4 显示约定
- **数值**(只影响显示,存储和排序用原始十进制字符串,不经浮点;缺值不当作 0):
  - 空值显示「—」。
  - 限定符前缀:`at_least`→「≥」、`at_most`→「≤」、`more_than`→「>」、`approximately`→「≈」、`exact` 不加。
  - 单位为 USD 时加前缀 `$`;单位为 `/10` 时加后缀 `/10`。
  - 完整显示:千分位分隔,小数截断(不四舍五入)到 2 位,BTC 截断到 4 位。
  - 紧凑显示(目录单元格、指标快照):值 ≥1e6 时用 M、B、T 缩写,保留 2 位小数。
- **日期时间**:按界面语言(en-US / zh-CN / ko-KR)格式化为「年-月-日 时:分」,24 小时制,附时区缩写。
  业务日期一律 `YYYY-MM-DD`,「今天」按 UTC 日界比较。
- **不完整日期**(人员相关视图通用):空值显示 "Date not published";`YYYY` 显示为 "YYYY · 仅年份";
  `YYYY-MM` 显示为 "YYYY-MM · 仅月份";`YYYY-MM-DD` 原样显示。月份不能补成具体某天。
- **来源显示名**:
  - cmc_web → CoinMarketCap,coingecko_web → CoinGecko
  - manual → Original note,attachment → Attachment
  - official_website → Official website,user_report → Team or contact report
  - public_directory → Public directory,public_social → Public social profile
  - public_profile → Public profile,person_profile → Personal profile
  - x → X / Twitter,the_org → The Org
  - provider_agreement → Provider agreement,measurement → Measurement evidence
  - repository_code → Connector source code
  - 以上都不匹配时显示 Reference。public_profile 和 person_profile 的 URL 是 linkedin.com 时显示「LinkedIn」。
  - 缩写:CMC、CoinGecko,其余显示 Manual。
- **状态名**:采集运行 success→Succeeded,failed→Failed,interrupted→Interrupted,running→Collecting;
  记录复核状态 unverified→Unverified,confirmed→Confirmed,in_progress→In progress,done→Completed。
- **枚举展示**:每个枚举值都有展示标签(v1 `src/web/presentation.ts`),展示映射不改存储值与原文;
  已知的导入模板文本替换为可读句子,自由文本不改写。
- 来源:src/web/api.ts;src/web/presentation.ts;src/modules/movement-date.ts;tests/movement-date.test.ts;docs/ui-redesign-2026-09-19.md

### 0.5 并发与刷新
- 快速切换筛选或页面时,只采用最后一次发出的请求的结果(各页面都有请求序号)。
- 编辑一律带 revision,不一致返回 409 并提示重新打开最新版本;每次保存 revision+1 并写一条历史。
- 有自动刷新的页面(工作台、情报收件箱),在打开编辑对话框或保存进行中时暂停刷新,避免覆盖正在填写的内容。

## 1 路由

| 路由 | 内容 | 小节 |
|---|---|---|
| `/` | 重定向到 `/w/internal/organizations` | — |
| `/w/internal/organizations` | 机构目录(按 tag 分组的排名表) | 3 |
| `/w/internal/organizations/:id/:tab?` | 单机构详情,tab 为模块 id,缺省 `overview` | 4–7 |
| `/w/internal/compare/:left/:right/:tab?` | 两机构对比,tab 取两边模块的并集 | 4.5 |
| `/w/internal/talent` | 人才目录,`?person=` 选中人员 | 6.9 |
| `/w/internal/work` | 工作台(任务列表/看板) | 10.1 |
| `/w/internal/intelligence` | 情报收件箱 | 8.1 |
| `/w/internal/activity` | 活动历史 | 8.4 |
| `/w/internal/connectors` | Connector 覆盖与验证看板 | 11.6 |
| `/w/internal/sources` | 数据来源:CMC/CoinGecko 采集与来源身份映射 | 9.5 |
| `/w/internal/members` | 团队成员(仅 admin) | 2.7 |
| `/w/internal/settings` | 个人设置(界面语言) | 2.9 |
| `/w/internal/accounts`、`/w/internal/hft`、`/w/internal/audit`、`/activate` | v2 新增 | 12 |
| 任何未知路径 | 重定向到机构目录 | — |

**重定向**(都用 replace,不增加历史记录):
- 详情页或对比页的 tab 为 `stats` 时,改到同一路径的 `overview`,保留 query,加 `#metrics` 锚点并滚动到指标区。
  「Stats」不再作为独立 tab 显示。
- `/w/internal/work?section=intelligence` → `/w/internal/intelligence`,去掉 `section`,其余 query 保留。
- 已合并为别名的旧机构 ID → 规范 ID,保留 tab 与 query(4.1)。

**跨页深链 query**:`record`(详情 tab 内定位记录)、`object` + `knowledgeView`(关系 tab 选中对象与模式)、
`sourceRecord`(从某条记录发起关联或建任务)、`task` + `organizationId`(工作台选中任务)、`person`
(人才目录选中人员)、`page`(目录分页)、`venue` + `leaf`(connector 看板)。

来源:src/web/main.ts;src/web/components/OrganizationPage.vue;docs/work-navigation.md;docs/architecture.md §Navigation and states

## 2 外壳与全局

### 2.1 启动、登录与会话(登录方式由 proposal §4 取代)
- 启动:检查会话期间显示启动屏(品牌标志和「Opening your workspace…」)。有用户时拉取全局摘要(机构数);
  没有用户时在**当前 URL** 上显示登录页,不跳转。会话查询失败时,错误显示在登录表单里。
- 登录:成功后停在原深链页面,不跳回首页;提交中按钮禁用。v1 的邮箱+密码表单、7 天会话、bootstrap 提示
  由 proposal §4 的 TOTP 登录取代。
- 登出:侧栏个人区的登出按钮。前端清空当前用户并回到登录页;已打开的证据抽屉一并关闭。
- 会话失效:任何非登录接口返回 401 时,立即清空用户、退回登录页,URL 不变。
- 切换账号:清空按账号缓存的探索视图状态(7.8);草稿与筛选记忆的存储键都带用户 id,账号之间互不串用。
- 所有写操作校验 Origin,不在允许列表内返回 403。
- 来源:tests/browser/locales.spec.ts(先 goto /settings,登录后仍在 settings);src/web/App.vue;src/web/api.ts;src/server/app.ts `/api/session`、`/api/login`

### 2.2 角色的前端表现(v2 另加 trader,见 proposal §4)
- 角色枚举：`reader`、`editor`、`admin`。成员表里显示为翻译后的角色名。
- reader：只能读团队可见资料。所有写请求都返回 403「This role has read-only access.」，只有以下几项例外：登出、修改个人偏好（PATCH /api/preferences）、情报标记已读、关注机构。
- editor：reader 的权限，加上新建机构、新建/编辑记录、录入有来源的指标观测。
- admin：editor 的权限，加上管理员可见记录与原文、数据来源采集/定时/身份映射、成员管理。
- 前端按角色隐藏入口：reader 看不到「Add organization」「Add record / Add person / Add the first record」、记录编辑按钮、「Connect to a shared object」「Create follow-up task」。非 admin 看不到侧栏「Team members」、每日采集开关、「Collect now」和来源身份映射区。
- 规则：管理员可见（visibility=admin）的记录或原文，非 admin 请求历史或原文时返回 403。
- 来源：tests/preferences.test.ts（reader 可改语言，建机构返回 403）；tests/integration.test.ts（editor 调 /members 返回 403；reader 建机构返回 403；外域 Origin 返回 403）；src/server/app.ts onRequest 钩子；docs/architecture.md §Access

### 2.3 侧栏导航
- 入口：登录后常驻左侧。
- 内容（自上而下）：
  1. 品牌标志，点击回到机构目录。
  2. 收起/展开导航按钮。
  3. 主导航：Work → Intelligence inbox → Organizations（右侧显示机构总数）→ Talent directory → Connectors。
  4. 分组标签「Administration」：Data sources（带在线圆点，只是装饰）→ Team members（仅 admin 可见）。
  5. 底部：Settings 链接；个人区显示姓名首字母头像、姓名、角色名和登出按钮。
- 交互：
  - 当前页高亮。Organizations 在「不属于其他任何导航项」时高亮，所以详情页和对比页也高亮它。
  - 收起状态记在浏览器 localStorage（`omniboard.sidebar.collapsed`），只存本机；存储不可用时仍能使用。收起后每个导航项仍有 title 和 aria-label。
- 规则：机构总数排除已合并为别名的机构。登录、数据来源采集完成、详情页触发 refresh 事件时重新获取。
- 来源：tests/browser/locales.spec.ts、exploration.spec.ts（complementary > navigation > link）；tests/exchange-identities.test.ts:178（summary 计数排除别名）；src/web/App.vue；src/server/app.ts `/summary`

### 2.4 顶栏
- 内容（从左到右）：移动端菜单按钮；面包屑「Omniboard / 当前页名」；「Search everything」按钮，旁边显示快捷键提示 `⌘ / Ctrl K`；活动历史时钟图标，链接到 `/w/internal/activity`。
- 面包屑页名按以下优先顺序匹配：Settings、Data sources、Team（成员页）、Intelligence inbox、Activity history、Work、Talent directory、Connectors，都不匹配时为 Organizations。
- 来源：src/web/App.vue

### 2.5 移动端
- 交互：顶栏菜单按钮切换侧栏抽屉。任何路由变化都会自动关闭抽屉。
- 来源：src/web/App.vue（watch route.path）

### 2.6 新建机构对话框
- 入口：机构目录标题区的「Add organization」按钮（非 reader 可见）。
- 内容：Organization name（必填，≤160）；Organization tags（13 个 tag 复选，说明「Tags determine the available modules and metrics. Select one or more.」，默认勾选 `company`）；Description（≤3000）。
- 交互：Create 按钮在提交中或一个 tag 都没选时禁用。成功后关闭对话框、清空名称和描述、刷新机构数，并跳到新机构的 `/overview`（沿用当前 query）。失败时在对话框内显示错误。按 Cancel、点遮罩或按 Escape 都会关闭。
- 规则：tag 至少 1 个，重复的会去重，取值必须在 §4.2 的 tag 枚举内。创建时写入审计历史 `organization_created`。
- 来源：tests/rankings.test.ts、tests/preferences.test.ts（reader 创建返回 403）；src/web/App.vue；src/server/app.ts POST /organizations

### 2.7 团队成员页(v2 按 proposal §4 重做)
- 入口：侧栏 Team members（仅 admin）；`/w/internal/members`。
- 内容：标题区「WORKSPACE ACCESS / Team members」，说明「Manage reader, editor and administrator access.」，以及「Add member」按钮；下方是成员表（Member、Email、Role），按创建时间升序。
- 交互：「Add member」打开对话框，字段为 Name（必填，≤80）、Email、Initial password（12–200 字符）、Role（默认 reader，三个选项分别附一句说明）。成功后关闭并刷新列表。
- 状态：非 admin 直接访问该 URL 时，首次加载会显示错误「Administrator access is required.」；如果是从别的页面路由切换进来，不会发请求，只显示空表（待核）。
- 规则：邮箱已存在返回 409「This email is already registered.」。v1 没有改角色、停用和重置密码功能。
- 来源：tests/integration.test.ts:145；src/web/App.vue；src/server/app.ts `/members`；docs/architecture.md §Access

### 2.8 全局搜索
- 入口：顶栏「Search everything」按钮；快捷键 `/` 或 `Ctrl/⌘+K`（见 §0.3）。
- 内容：输入框自动聚焦，最多 160 字符，占位文字「Organizations, people, tasks or information…」。结果按类别分组，组的顺序固定：Organizations → Talent directory（人员）→ Work（任务）→ Source records（记录）。空组不显示组标题。每条结果显示标题、一行上下文和箭头。有结果时底部提示「Showing limited matches in each category…」。
- 交互：
  - 输入防抖 180 ms 后才请求。旧请求的响应一律丢弃。
  - `Enter` 打开第一条结果。
  - 点击结果时先关闭对话框，再跳转：
    - 机构 → `/organizations/:id/overview`
    - 人员 → `/talent?person=<id>`
    - 任务 → `/work?organizationId=<org>&task=<id>`
    - 记录 → `/organizations/<org>/<tabId>?record=<id>`
  - Escape、关闭按钮或点遮罩都会关闭对话框。
- 状态：输入为空时显示用法提示（「…Press Enter to open the first result.」）；加载中显示「Searching…」；出错时显示错误；无结果时显示「No matching results」。
- 规则：
  - 各类别上限：机构 8、人员 8、任务 8、记录 12。
  - 匹配方式均为不区分大小写的子串匹配。
    - 机构：匹配名称和描述，按名称排序；上下文取描述前 120 字符。
    - 人员：匹配姓名、别名、职位和所属机构名；上下文为「机构名 · 机构名」。
    - 任务：匹配标题、机构名、描述和负责人名；上下文为机构名。
    - 记录：匹配标题、正文、人名、结构化字段和机构名，按更新时间倒序；上下文为机构名。
  - 未被人工改名的标准任务，用中文、英文、韩文三种标题都能搜到，并按当前界面语言显示标题。
  - 权限与别名：记录的可见性和其原文的可见性都会检查；已合并为别名的记录和机构都会被排除；空查询返回空数组；超过 160 字符返回 422。
- 来源：tests/talent.test.ts:296（权限、别名、401、422、空查询）；src/web/components/GlobalSearch.vue；src/server/search.ts；docs/ui-redesign-2026-09-19.md（全局行）

### 2.9 设置页
- 入口：侧栏底部 Settings；`/w/internal/settings`。
- 内容：标题「Settings」和说明「Preferences for your account.」；下方是「Language」卡片，包括说明文字、「Display language」下拉（English / 简体中文 / 한국어，每个选项用自己的语言显示）、「专名和原始资料保持原文」的提示，以及「Save preferences」按钮。
- 交互：
  - 保存按钮在所选语言等于当前语言或保存中时禁用。
  - 保存成功后整个界面立即切换语言，并显示状态提示「Language preference saved.」。
  - 修改下拉选项会清掉成功或错误提示。
  - 错误直接显示在卡片内。
- 状态：保存中按钮显示「Saving…」。
- 规则：只接受 `en`、`zh-CN`、`ko`，其他值返回 422。请求体只能含 `locale`，多出字段（比如 memberId）返回 422。reader 也能修改。偏好按账号存储，不影响其他成员，登出再登录后保持。新账号默认 `en`。
- 来源：tests/browser/locales.spec.ts（三种语言保存、刷新后保持、`<html lang>` 随之变化）；tests/preferences.test.ts；src/web/components/SettingsView.vue；src/server/preferences.ts

### 2.10 语言机制与覆盖范围
- 登录后以账号偏好为准。本地另存一份（localStorage `omniboard.locale`），只用于登录前（例如登录页）按上次语言显示；本地存储被禁用时不影响账号保存。
- 当前语言同步写到 `<html lang>`。
- 日期时间按语言格式化（en-US / zh-CN / ko-KR），格式为「年-月-日 时:分」，24 小时制，附时区缩写。
- 翻译覆盖以下内容：
  - 全部界面文案、帮助说明、系统状态
  - 模块标题与描述
  - 指标列标题与描述
  - tag 单复数名
  - 结构化字段的标签与提示
  - 标准接入任务的标题、描述、下一步和完成标准
  - 工作泳道名、任务状态名
- 以下内容不翻译：CoinGecko、CoinMarketCap、机构名、人名、产品品牌和技术标识；用户录入的标题、笔记、原文、历史；已被人工改过的标准任务。缺少译文时回退到英文原文，不调用外部翻译服务。
- 插值：占位符 `{0}`、`{1}` 可以按语言调整顺序；插入的用户值原样保留，即使值里含有 `{1}`、`<…>` 也不做二次替换。
- 来源：tests/localization.test.ts（译文完整性、占位符、注册表覆盖、组件字面量覆盖、标准任务显示本地化但不改存储值）；docs/localization.md；src/web/i18n.ts；src/shared/localization.ts

### 2.11 最近筛选自动记忆（机构目录、人才目录、工作台）
- 入口：进入 `/w/internal/organizations`、`/w/internal/talent`、`/w/internal/work`。嵌入在机构 Onboarding 里的工作台不参与记忆。
- 交互：
  - 筛选状态一律写在 URL query 里，每次变更都用 replace 更新 URL，并同时存进当前账号在本浏览器的记忆。
  - 从别的页面进入这三页，或者切换了账号时：如果 URL 不带任何 query，就用记忆恢复（replace）；如果 URL 带任何 query（哪怕只是选中某个人或任务、没有筛选参数），就以链接为准，不恢复。
  - 「Reset filters」会清空 query，并把空状态写回记忆。
- 规则：只记忆下列键：
  - work：`organizationId, ownerId, lane, state, search, layout`
  - organizations：`tag, sort, direction, unit, year, basis, columns, q`
  - talent：`q, organizationId, duplicates, contact, sort`
- 以下内容不记忆：选中的对象/人员/任务/记录、`sourceRecord`、分页。
- 只保留字符串值，且长度 ≤1000；存储内容损坏或非对象时按空处理。记忆按用户和页面隔离。
- 工作台 URL 校验：`lane` 可为 `'' | business | engineering | compliance | research`；`state` 可为 `'' | actionable | open | ready | active | waiting | blocked | done | skipped`，缺省为 `actionable`，非法值回退到默认。显式的 `state=''` 表示「全部」，要保留。
- v1 早期的「命名保存视图」已移除（见「已排除」）。
- 来源：tests/filter-preferences.test.ts；src/modules/filter-preferences.ts；src/web/composables/useRememberedFilters.ts；docs/work-navigation.md

### 2.12 其他客户端记忆
- 侧栏收起状态：localStorage，本机有效，见 §2.3。
- 表单草稿：记录编辑器、讨论等表单在本标签页的 sessionStorage 中按「账号 + 作用域」自动存草稿，附件不存。与原始值相同时删除草稿。有草稿时由表单提供「恢复」入口。字段类型与当前表单不符的旧草稿会被丢弃。有未保存修改时离开页面，浏览器会弹出离开确认。存储不可用时提示「Draft storage is unavailable. Keep this page open until you save.」。用草稿的表单：记录编辑器(5.6)、讨论与联系人对话(5.9)。
- 探索视图状态：关系/探索页的搜索、筛选、选中项、图谱缩放和滚动位置只保存在内存中，按账号 + 路径 + 机构 + 选中项区分，最多 40 份。离开再返回时恢复，登出或切换账号时清空。
- 来源：src/web/composables/useDraft.ts；src/web/composables/useExplorationView.ts；docs/ui-redesign-2026-09-19.md（讨论与录入行）；tests/browser/graph-navigation.spec.ts（goBack 恢复，待核具体断言）

### 2.13 滚动与缓存
- 机构目录组件在进入详情页或对比页时保持缓存，返回目录时不重新加载，并恢复离开前的滚动位置。离开目录前先记录滚动位置，防止列表卸载后滚动被重置为 0。
- 浏览器前进、后退时使用浏览器保存的滚动位置。
- 同一路径下只有 `page` 变化时，滚动到目录表卡片顶部；其他 query 变化不滚动；换路径时回到顶部。
- 目录中的「打开机构」和详情页的「返回目录」「切换 tab」「对比/替换/交换」都会带上当前 query，所以目录的筛选状态会跟着进入详情页，返回时原样恢复。
- 来源：src/web/main.ts scrollBehavior；src/web/App.vue（KeepAlive、open()）；src/web/components/OrganizationPage.vue chooseTab/close/compare；docs/architecture.md §Navigation

### 2.14 列说明浮层
- 入口：指标列头和列选择器每列旁边的「ⓘ」按钮（aria「About {列名}」）。也用于机构 Stats/指标区。
- 内容：列标题、翻译后的定义文字；列有方法论链接时附「Methodology」外链（新窗口）。
- 交互：
  - 点击按钮切换浮层。浮层靠按钮右侧对齐，下方空间不够时显示在按钮上方。
  - 以下操作会关闭浮层：点外部、点浮层内的关闭按钮、按 Escape、窗口尺寸变化、页面滚动（浮层内部滚动除外）。
  - 点按钮不会触发列头排序。
- 来源：tests/browser/locales.spec.ts（点「关于流动性」按钮后，「流动性说明」区域包含 CoinMarketCap）；src/web/components/ColumnHelp.vue

### 2.15 机构选择器
- 入口：数据来源页「Review / change mapping」对话框；详情页「Compare organizations」与对比页的替换(4.5)。
- 内容：搜索框（自动聚焦）和结果列表。每行显示 logo、机构名、来源缩写（「CMC · CoinGecko」；没有来源时显示「Manually created」）和「Select →」。
- 交互：输入即搜索（不防抖，旧响应丢弃），每次最多 30 条；打开时立即用空查询加载一次。可以排除指定机构（对比时排除自身），也可以只查 exchange tag。点击一行即完成选择。
- 状态：加载中显示「Searching…」；无结果时显示「No matching organizations」；出错时显示错误。
- 对比中选中后的跳转(都保留 query):新对比 `/compare/<当前>/<选中>/<当前tab>`;替换左侧 `/compare/<选中>/<右>/<tab>`;替换右侧 `/compare/<左>/<选中>/<tab>`。
- 来源：src/web/components/OrgPicker.vue；OrganizationPage.vue

### 2.16 机构标志与图标
- 机构标志：有 logo 地址时显示图片（懒加载）；没有地址或加载失败时，显示名称首字母。logo 地址变化后重新尝试加载。有大、小两种尺寸。
- 图标：一组内置线性图标（building、search、compare、database、users、plus、close、arrow、chevron、settings、grid、file、clock、check、menu、logout、info、lock、edit、copy、external、refresh 等），只做视觉提示，不承载独立信息；每个带图标的按钮都有文字或 aria-label。
- 来源：src/web/components/OrgLogo.vue；src/web/components/Icon.vue

## 3 机构目录与排名

### 3.1 页面结构
- 入口：`/w/internal/organizations`；侧栏 Organizations；品牌标志。
- 内容（自上而下）：
  1. 标题「Organizations」，说明「Rank, research and maintain your counterparties.」，以及「Add organization」按钮（非 reader）。
  2. tag 筛选条：单行横向排列，窄屏可以换行，所有类型都可访问。顺序为 All 和 13 个 tag 的复数名（Exchanges, Brokers, Market Makers, Banks, Custodians, Data Providers, Infrastructure Providers, Connectivity Providers, Think Tanks, Trading Companies, Hedge Funds, Companies, Governments）。右侧显示「N organizations」和刷新按钮。
  3. 工具栏：搜索框（「Search organizations…」）、「Rank by」下拉（当前 tag 可用列，再加 Name、Date added）、「Reset filters」，以及「Columns」列选择器。
  4. 排名上下文行：当前排序列名；多单位列显示单位下拉，否则显示单位文字；只有可见列中存在年度指标时才显示「Year」下拉；「Ranking basis」按钮。
  5. 近似值提示：当前页只要有一行的排序值带非精确限定符（≥ ≤ > ≈），就显示「Sorted by recorded bounds or estimates, not confirmed market size…」。
  6. 表格：见 §3.3。
  7. 页脚：「{起}–{止} of {总数} organizations」、Previous / 页码 / Next。
  8. 表格下方脚注：「Every metric retains its source and observation date.」
- 状态：
  - 加载中表格区显示「Loading rankings…」，计数显示「…」。
  - 出错时显示错误（role=alert）。
  - 无数据时整行显示空态：「No matching organizations」和「Add an organization or adjust the search. Metrics appear once a sourced value has been recorded.」。
- 来源：src/web/components/DirectoryView.vue；src/web/App.vue；docs/ui-redesign-2026-09-19.md（机构目录行）；docs/ui-information-design.md

### 3.2 URL 状态与操作
URL：`?tag=&q=&sort=&direction=&unit=&year=&basis=&columns=&page=`，全部用 replace 更新。除直接翻页外，任何筛选变更都会把 `page` 重置为 1，并删除遗留的 `rankedOnly`。

| 参数 | 缺省/非法时 | 说明 |
|---|---|---|
| tag | 缺省时为 **exchange**；`all` 或非法值为 All | 点「All」写入 `tag=all`，以此与「没写 tag 时默认 Exchanges」区分，记忆恢复时两者也不会混淆 |
| sort | 当前 tag 的默认排序列（§3.4） | 必须是当前 tag 的可用列，或 `name`、`updated` |
| direction | `desc` | 只允许 `asc` 或 `desc` |
| unit | 排序列的第一个单位 | 必须在排序列的单位列表内 |
| year | 上一 UTC 年 | 正则 `^(19|20|21)\d{2}$` |
| basis | `preferred` | `preferred`、`cmc_web`、`coingecko_web`、`manual` |
| columns | 各列的 defaultVisible | 逗号分隔的列 id；当前排序列始终可见 |
| q | 空 | 名称子串 |
| page | 1 | 每页 30 条 |

- 交互 → 结果：
  - **点 tag**：切换 tag，同时清空 sort、unit、basis、columns、direction，激活的 tag 按钮自动滚入可视区。
  - **搜索框输入**：防抖 200 ms 后写入 `q`；URL 的 `q` 变化时反向同步输入框。
  - **Rank by 下拉**：设置 sort，清空 unit，direction 置为 `desc`。
  - **点列头**：点的是当前排序列时，在 desc 和 asc 之间切换，并保留单位；点的是其他列时，改为按该列 desc 排序，单位重置。列头用 ↓、↑ 表示当前方向，↕ 表示可排序；列头带 aria-sort。「Organization」列头按名称排序；按 `updated` 排序时额外出现「Date added」列。
  - **Columns**：下拉面板里每列一个复选框和一个列说明按钮（§2.14）。当前排序列的复选框禁用，并标注「ranking」。勾选变化写入 `columns`。点外部、焦点移出或按 Escape 关闭面板；Escape 关闭后焦点回到「Columns」按钮；如果此时有列说明浮层开着，Escape 先关浮层。
  - **单位下拉、年份下拉**：分别写入 `unit`、`year`。年份选项为本年及之前共 16 个年份，外加当前所选年份，降序排列。
  - **Ranking basis**：打开对话框，内容包括：
    - 当前列的定义
    - 「Source selection」下拉：Preferred source；CoinMarketCap only 和 CoinGecko only 仅在 Exchanges 视图出现；Team observations only。选择后写入 `basis`。
    - 三段规则说明：「只取同单位同期间，永不平均或换算」「排名在所选 tag 内、先于搜索和分页计算，同值同名次，缺失值不排名且无论升降序都排最后」「来源身份在复核前保持独立」。
  - **Reset filters**：清空全部 query，回到默认 Exchanges 视图，同时覆盖记忆。
  - **刷新按钮**：按当前条件重新加载。
  - **翻页**：Previous、Next 在边界处禁用；写入 `page`。
  - **遗留链接**：带 `rankedOnly` 参数的旧链接会被去掉该参数后重新加载，不再隐藏无值机构。
  - **并发**：只采用最后一次请求的响应。指标对话框开着时，对应机构的数据会随列表重新加载而更新。
- 来源：src/web/components/DirectoryView.vue；docs/architecture.md §Tag-specific columns and ranking；README.md §Rankings

### 3.3 表格列与单元格
- **Rank / Order 列**：本页有近似值时列头改为「Order」，否则为「Rank」。
  - 有名次且排序列是指标列时，名次是按钮，点击打开该机构该指标的来源对话框。
  - 其他情况显示名次或「—」。
  - 前三名有「领奖台」强调，出现近似值时不强调。
- **Organization 列**：logo 加名称的按钮，点击进入详情 `/organizations/:id/overview`。
- **Tags 列**：只在本页有机构带「当前 tag 以外的 tag」时出现。列出其余 tag；在 Exchanges 视图下不显示 company（交易所隐含 company）。
- **指标列**：
  - 列头依次是标题按钮、列说明按钮、单位，年度列在单位后加「· 年份」。
  - 单元格是按钮，显示紧凑数值（§0.4），悬停显示精确原值，没有值时提示「No matching observation」。
  - 缺值显示「—」，同样可以点击，打开的对话框里编辑者可补录。
  - 点击任意指标单元格都会打开指标来源对话框(9.2)。对话框里的「按此观测排名」会把 sort、unit、basis 设为该观测的值；如果观测的期间是四位年份，year 也设为该年份。
  - 当前排序列有高亮样式。
- **Records 列**：计数列，数值为当前成员可见的记录数，点击进入机构详情。
- **末列**：「›」按钮进入详情。
- 来源：src/web/components/DirectoryView.vue；README.md §Rankings

### 3.4 列注册表、默认排序与排名计算
**tag 视图的列组成**：
- 列入条件：列的适用 tag 与视图的有效 tag 有交集，或者列不属于任何 tag（即通用列 `record_count`）。
- Exchanges 视图的有效 tag 另外包含 company，所以 Revenue、Headcount 也可选，但默认隐藏。
- All 视图只有 `record_count`。

| 列 id | 标题 | 单位 | 期间 | 适用 tag | 默认可见 |
|---|---|---|---|---|---|
| research_budget | Research budget | USD | annual | think_tank | ✓ |
| research_publications | Publications | publications | annual | think_tank | ✓ |
| operating_markets | Operating markets | markets | current | trading_company | ✓ |
| fund_aum | Assets under management | USD | current | hedge_fund | ✓ |
| investment_strategies | Investment strategies | strategies | current | hedge_fund | ✓ |
| coverage_regions | Coverage regions | regions | current | connectivity_provider | ✓ |
| network_routes | Network routes | routes | current | connectivity_provider | ✓ |
| network_pops | Network PoPs | PoPs | current | connectivity_provider | ✓ |
| network_markets | Network markets | markets | current | connectivity_provider | ✗ |
| connected_platforms | Connected platforms | platforms | current | broker | ✗ |
| settlement_volume_monthly | Monthly settlement | USD | current | custodian | ✗ |
| volume_24h | 24h volume | USD, BTC | 24h | exchange | ✓ |
| liquidity | Liquidity | score | current | exchange | ✓（有方法论链接 CMC） |
| trust_score | Trust score | /10 | current | exchange | ✗（有方法论链接 CoinGecko） |
| markets | Markets | markets | current | exchange | ✓ |
| coins | Coins | coins | current | exchange | ✗ |
| weekly_visits | Weekly visits | visits | current | exchange | ✗ |
| revenue | Revenue | USD | annual | company, trading_company | ✓（Exchanges 视图为 ✗） |
| headcount | Headcount | people | current | company, think_tank, trading_company, hedge_fund | ✓（Exchanges 视图为 ✗） |
| gdp | GDP | USD | annual | government | ✓ |
| population | Population | people | annual | government | ✓ |
| execution_venues | Execution venues | venues | current | broker, market_maker | ✓ |
| supported_currencies | Supported currencies | currencies | current | broker, bank | ✓ |
| instruments | Instruments | instruments | current | broker | ✓ |
| liquidity_assets | Liquidity assets | assets | current | market_maker | ✓ |
| trading_counterparties | Trading counterparties | counterparties | current | market_maker | ✓ |
| payment_markets | Payment markets | markets | current | bank | ✓ |
| bank_assets | Total assets | USD, EUR, GBP | annual | bank | ✓ |
| custody_assets | Supported assets | assets | current | custodian | ✓ |
| custody_networks | Supported networks | networks | current | custodian | ✓ |
| assets_under_custody | Assets under custody | USD | current | custodian | ✓ |
| data_venues | Data venues | venues | current | data_provider | ✓ |
| data_history_start | History starts | year | current | data_provider | ✓ |
| data_instruments | Data instruments | instruments | current | data_provider | ✓ |
| cloud_regions | Cloud regions | regions | current | infrastructure_provider | ✓ |
| datacenter_locations | Data center locations | locations | current | infrastructure_provider | ✓ |
| availability_sla | Availability SLA | % | current | infrastructure_provider | ✓ |
| record_count | Records | records | current | （通用，count 类） | ✓ |

每列都有一段定义文字，说明口径和不可比之处，作为列说明、排名口径对话框、数据浏览器说明和录入观测时 assumptions 占位的内容，原文见 columns.ts，需要逐字迁移。

**默认排序列**：exchange→volume_24h，company→revenue，government→gdp，broker/market_maker→execution_venues，bank→payment_markets，custodian→custody_assets，data_provider→data_venues，infrastructure_provider→datacenter_locations，connectivity_provider→coverage_regions。其余 tag 和 All 视图为 record_count。

**排名计算**（服务端）：
- **排名范围**：在所选 tag 的全部机构（排除别名机构）内先算名次，再应用搜索和分页，所以搜索、翻页都不改变名次。
- **名次规则**：
  - 竞争排名，同值同名次，例如 1、1、3。
  - 缺失值名次为空，无论升序降序都排在最后。
  - 0 是真实值，参与排名。
  - 同名次时按名称小写、再按 id 排序。
- **数值比较**：十进制字符串按「整数位数 + 整数 + 小数」构造排序键，不经过浮点。支持 40 位整数、30 位小数。
- **取值**：每个机构在排序列上的值按 9.1 选出;不同货币、不同年份永不混排，也不做换算。
- **非法请求**：sort 不属于当前 tag、unit 不属于该列，或在 All 视图用了 tag 专属列，返回 422。`sort=rank` 等同默认列。
- **限定值**：带 ≥ ≤ > ≈ 的值按其边界数字参与排名。
- **record_count**：按当前用户可见的记录数计算(admin 记录只对 admin 计入)。
- **限制**：API 每页 1–100 条，目录固定每页 30 条；`q` ≤200 字符。
- **排名来源**：目录名次由指标值计算得出，不照搬来源网站公布的排名。
- 来源：tests/rankings.test.ts（列组成、十进制排序、1/1/3/4/null、asc 时缺失值仍在最后、分页和搜索保持名次、BTC/USD 分开排、422、basis 过滤）；tests/business-roles.test.ts（非 exchange/company/government 的 tag 至少 4 列且没有 volume_24h）；tests/browser/exploration.spec.ts（交易所在 Companies 和 All 视图中都只出现一次）；src/modules/columns.ts；src/server/metrics.ts

## 4 机构页

### 4.1 机构详情页框架
- 入口：
  - 路由 `/w/internal/organizations/:id/:tab?`，tab 缺省为 `overview`。
  - 从目录点击机构行进入 `/…/:id/overview`，保留当前目录 query。
- 内容：从上到下依次为：
  1. 面包屑："← Organizations" > 机构名。
  2. 标题：机构名 + 标签徽章（按 tag 显示名）。
  3. 副标题：来源简称用 " + " 连接（CMC / CoinGecko / quant / Manual），有来源时追加 "· Original page available"；没有来源时显示 "Team-maintained organization profile"。
  4. 右侧显示 Logo。
  5. 模块导航。
  6. 内容区。
  7. 页脚："Internal workspace" 与 "Omnitra · Research with references"。
- 交互：
  - 返回：回到 `/w/internal/organizations` 并带上原 query。目录恢复离开前的滚动位置（进入详情前记录 scrollY）。
  - "Compare organizations" 按钮（非对比模式）：打开机构选择器，见 2.15。
  - 旧机构 ID（合并后的 alias）：服务端解析到规范 ID，前端 `router.replace` 到规范 ID，保留 tab 与 query。
  - 旧路由 `/…/:id/stats` 和 `/compare/:l/:r/stats` 重定向（replace）到 `/overview#metrics`，并滚动到指标区。
- 状态：
  - 首次加载："Loading organization details…"。
  - 同一路径刷新：保留旧内容，另显示 "Refreshing organization details…"。
  - 刷新失败但已有内容：显示 "Could not refresh: {err} Showing the last loaded information." 和 "Retry refresh" 按钮。
  - 首次加载失败：错误标题 + "Back to Overview" 按钮。
  - tab 不属于该机构："This module is not configured for this organization."。
  - 同一机构内切换 tab：身份区与导航不闪烁、不清空；内容只在新 tab 数据到达后才替换，不会在新 tab 下显示旧模块内容。
- 来源：`src/web/components/OrganizationPage.vue`，`src/web/main.ts`，`docs/internal-operations.md`（导航与技术），`docs/organization-identity.md`

### 4.2 模块注册与 tag 组合（规则）
**tag 枚举**（13 个，顺序固定）：exchange, broker, market_maker, bank, custodian, data_provider, infrastructure_provider, connectivity_provider, think_tank, trading_company, hedge_fund, company, government。每个 tag 都有单数名和复数名。未注册的 tag 显示时会去掉 `_`、`-` 并改成首字母大写。

**有效 tag**：带 exchange 的机构隐含 company。影响目录列的组成，以及交易所会出现在 Companies 视图。

**模块**（按 order 升序显示；kind 决定渲染方式）：

| id | 标题 | order | kind |
|---|---|---|---|
| overview | Overview | 10 | overview |
| stats | Stats | 20 | stats（UI 中已并入 overview#metrics） |
| services | Services | 25 | records |
| market_access | Market Access | 26 | records |
| payments | Payments & Settlement（短名 Payments） | 27 | records |
| custody | Custody | 28 | records |
| data_coverage | Data Coverage | 29 | records |
| infrastructure | Infrastructure | 30 | records |
| contacts | Contacts | 40 | records |
| org_chart | Org Chart | 50 | chart |
| relationships | Relationships | 55 | records（专用知识面板） |
| people_movements | People Movements | 60 | timeline |
| compliance | Compliance | 70 | records |
| capital_optimization | Capital Optimization | 80 | records |
| tech_stack | Tech Stack | 90 | records |
| api_optimization | API Optimization | 100 | records |
| onboarding | Onboarding | 110 | records（专用进度面板） |
| roadmap | Roadmap | 115 | records（专用路线图） |
| comments | Comments | 120 | comments |

每个模块都有一句描述，作为模块头说明，原文见 registry.ts。

**所有 tag 共有的基础模块**：overview, stats, contacts, org_chart, relationships, people_movements, roadmap, comments。

**各 tag 附加模块**：
- exchange：api_optimization, capital_optimization, tech_stack, compliance, onboarding
- broker：services, market_access, api_optimization, capital_optimization, tech_stack, compliance, onboarding
- market_maker：services, tech_stack
- hedge_fund：services
- trading_company：services, market_access
- think_tank：services, data_coverage
- bank：services, payments, capital_optimization, compliance, onboarding
- custodian：services, custody, compliance, onboarding
- data_provider：services, data_coverage, onboarding
- infrastructure_provider、connectivity_provider：services, infrastructure, onboarding
- company、government：无

**组合规则**：
- 机构的模块 = 基础模块 ∪ 其全部 tag 的附加模块，去重后按 order 排序，与 tag 的先后无关。
- 对比页取两边的并集。
- 研究对象类 tag（market_maker、hedge_fund、trading_company、think_tank）不带 onboarding、api/capital_optimization、compliance；和 exchange 或 broker 组合时，这些模块才出现。
- 服务商类 tag 都带 onboarding，但不带 api_optimization。

**tab 交互**：
  - 点击 tab 后 push 新路由并保留 query。
  - 当前 tab 自动水平居中（容器尺寸变化时也会重新居中）。
  - 对比模式下，任一侧该模块为 not_applicable 时，tab 上显示一个圆点。

来源：tests/domain.test.ts（company 和 government 各 8 个模块、exchange 13 个，顺序无关，并集）；tests/tag-module-scope.test.ts；tests/business-roles.test.ts；src/modules/registry.ts；src/modules/tags.ts；docs/ui-information-design.md §当前导航顺序

### 4.3 模块状态
- `not_applicable`：机构的 tag 不含该模块，只会在对比时出现。显示「NOT APPLICABLE」徽章、「Not available: {模块名}」，以及「该模块未为这些 tag 配置，为对比保留可见」。响应中不含 records 字段。
- `restricted`：非 admin，该模块只有管理员可见的记录，且没有来源数据或资料。显示锁图标、「RESTRICTED / Restricted records / Your account does not have access to these records.」，不返回记录和原文引用。
- `empty`：没有记录、来源和资料。records 类模块显示空态：「Ready for the first insight」，说明「该模块可用，添加带引用的记录与团队共享」；非 reader 另有「Add the first record」按钮（chart 类为「Add the first position」）。relationships、onboarding、roadmap 和 stats、chart、overview、comments 类模块用各自的空态。
- `ready`：正常显示。
- 规则：以上四种状态在单页和对比页中都必须能区分，不能把无权限显示成无数据。
- 来源：tests/integration.test.ts（对比时 empty 与 not_applicable 同屏，not_applicable 不含 records）；src/server/queries.ts moduleData；src/web/components/ModuleView.vue

### 4.4 模块头与专用面板分派
- 模块头：overview、relationships、roadmap 以外的模块，显示模块标题、描述和新增按钮。stats、comments 类不显示新增按钮；reader 看不到新增按钮。新增按钮文案：chart 类为「Add person」，其余为「Add record」。
- 同一个 tab 内按模块分派专用面板：
  - comments：讨论面板(5.9)
  - compliance：合规矩阵，有记录时显示(5.8)
  - roadmap：路线图(10.11)
  - relationships：关系与证据(7)
  - onboarding：资源进度卡片（有记录时）、Next actions、Engineering requests(10.8)
  - overview：概览(4.7–4.11)
  - timeline：人员变动，有记录时显示(6.5)
  - chart：组织架构图(6.1)
- 通用记录列表（§5.1）只在同时满足以下条件时出现：有记录；kind 不是 chart、timeline、comments；id 不是 onboarding、roadmap。overview 下的列表带小标题「Team knowledge」和记录数。
- 来源：src/web/components/ModuleView.vue

### 4.5 机构对比
- 入口：路由 `/w/internal/compare/:left/:right/:tab?`，通过详情页 "Compare organizations" 进入。目录没有行多选。
- 内容：
  - 标题 "Organization comparison"，说明 "Compare available capabilities, resources and evidence across organizations."。
  - tab 取两侧的并集，顺序与详情页相同。
  - 页脚："Values with different units are not directly compared."。
- 交互：
  - 顶部操作：
    - "Replace left" / "Replace right"：打开选择器，排除另一侧机构。
    - "Swap sides"：交换 URL 左右，移动端切回 A。
  - 两种模式，模式存在组件内、不进 URL，默认 matrix：
    - **matrix（字段对比）**：仅当 tab 有字段契约且不是 onboarding 时可用，即 services 类、api/capital/tech、compliance、contacts、roadmap。见 4.6。
      - "Open full records side by side" 切到 details。
      - details 模式顶部的 "Compare the same fields" 切回 matrix。
    - **details（并排）**：左右两栏各带身份头（A/B 字母 + Logo + 名称 + 标签），各渲染完整模块。其他 tab 固定为此模式。
  - 移动端：出现 A/B 切换按钮（"A · 名称" / "B · 名称"），一次只显示一侧。
  - 对比模式下 Overview 的 Team workspace 快捷链接、工作摘要链接都停留在对比路由内，只切换 tab。
- 状态：某一侧 not_applicable 或 restricted 时，该侧显示对应空态，另一侧照常显示。
- 来源：`src/web/components/OrganizationPage.vue`，`src/modules/registry.ts`（unionTabs），`tests/domain.test.ts`，`docs/verification.md`

### 4.6 字段对比矩阵
- 内容：
  - 标题 "Compare the same fields"，勾选框 "Differences & unknowns only"。
  - 说明："Select one record on each side with comparable account, product and region. Matching text alone does not establish equivalent conditions."。
  - 表格：
    - 首行 "Compared scope"：每侧一个记录下拉框（选项为记录标题，默认该侧第一条记录），下方显示所选记录的 scope。
    - 之后每行一个字段：字段契约中的字段，去掉 sourceRef、verification、sensitivity、sourceKind、owner、evidenceLevel。
    - 末行 "Evidence"：每侧 "Original reference" 按钮，打开证据抽屉。
  - 列头为机构名，旁边有 "Replace" 按钮。
- 交互：
  - 勾选 "Differences & unknowns only" 后隐藏两侧相同的字段。相同的定义：两侧都有值、值不是 `unknown`、且完全相等。
  - 不同的行高亮。
  - 全部相同时显示 "No differences in the selected recorded fields."。
- 状态：某侧不可比时，整列显示原因："Module not available for this type" / "Restricted records" / "No record for this scope"。
- 规则：枚举值用展示标签显示（见 5.7），空值显示 "Not recorded"。
- 来源：`src/web/components/ComparisonMatrix.vue`

### 4.7 简介（About）
- 内容：
  - 标题 "About {name}"。
  - 正文优先用导入的 profile.about，其次用机构 description；都没有时显示 "An introduction has not been added yet. Team notes and public references can be added below."。
- 交互：
  - 超过 240 字符时默认折叠，"Read full introduction" / "Show fewer" 切换。
  - 展开后若来自 profile，显示 "{来源} profile · Captured {时间}"。
  - "Reference"：打开 about 的证据。
  - "Add note"（非 reader）：打开记录编辑器，tab=overview，为无结构字段的普通记录。
- 规则：
  - profile（about/facts/links）**只能通过导入写入，UI 没有编辑入口**。
  - 每条 fact/link 必须带 rawId，引用的是同 workspace 的证据快照。
  - fact/link 的 key 用小写 slug，在各自集合内唯一。
  - link 只允许 http/https，URL 中不能带用户名或密码。
  - 上限：about 12000 字、facts 80 条、links 40 条。
  - 保存带 revision：重复保存相同内容 revision 不变；revision 不符返回 409。
  - 每条 claim 按引用证据的可见性单独过滤；profile 全部受限时，对无权者既不显示内容也不暴露元数据。
  - 编辑者不能覆盖含有自己看不到的 claim 的 profile（403）。
  - profile 不产生排名观测。
- 来源：`src/web/components/OrganizationOverview.vue`，`src/server/organization-profile.ts`，`tests/organization-profile.test.ts`

### 4.8 我方工作摘要 "Our work with {name}"
- 入口：只在该机构的 tab 包含 onboarding 时显示在 Overview 中。
- 内容：
  - 三张信号卡。onboarding 为 not_applicable 时前两张不可点，否则都链到对应 tab：
    1. **Business access**：
       - 标题：1 条 onboarding 记录时显示其业务进度标签；多条时显示 "{n} access approvals recorded"（n = 业务状态为 granted 且未过期的条数）；0 条时显示 "Not recorded" / "Restricted" / "Not applicable"。
       - 副标题：有需关注的记录时显示 "{n} onboarding record(s) need attention"，否则显示 "Approvals for our products and accounts"。
    2. **Technical connection**：
       - 标题：1 条时显示技术进度标签；多条时显示 "{n} live account checks recorded"（production_verified 的条数）。
       - 副标题："{n} connection record(s) · scoped checks only"，或 "Progress is recorded per connection"。
    3. **Contacts**：
       - 标题："{n} contact record(s)" 或空态标签。
       - 副标题：任一联系人为 active 时显示 "Active relationships recorded"；有联系人但都不是 active 时显示 "Public details do not imply a relationship"；没有联系人时显示 "People and business channels"。
  - "Next steps"：最多 2 个未完成任务，排序为 ready 的在前，其余按标题字母序；每项链到 `/w/internal/work?organizationId=…&task=…`。
- 交互："Contacts, blockers & details" / "Hide team details" 展开或收起详情。展开后先显示说明 "From records visible to you. Provider offerings, account approval and connection tests are tracked separately."，下面分两部分：
  - **Next steps** 区：
    - 标题旁显示 "{n} need(s) attention"。
    - 任务列表：状态 + 负责人；"View all {n} open tasks" 链到 Work 并按该机构过滤。
    - 随后列出最多 2 条 onboarding 跟进记录，排序为需关注的在前、有 nextStep 的在前。每条显示：
      - 范围：product；若是导入的占位文本，改显示为 "Account and product scope not confirmed"。
      - 资源类型 · 业务进度。
      - 下一步：nextStep，其次 verification，都没有时显示 "Next step not recorded."。
      - 关联请求的第一条 blocker（可读化后）。
      - "Record owner · X"（未指派显示 "Not assigned"）。
      - "Source" 按钮打开证据。
    - onboarding 记录超过 2 条时显示 "View all {n} onboarding records"。
    - 空态："Onboarding records are restricted to administrators." 或 "No open task or follow-up recorded. Open Onboarding to plan the next steps."。
  - **People & channels** 区：
    - 最多 2 个联系人，排序为 active 在前、有人名的在前。每项显示人名或标题、角色预览（去掉 "Published role: " 前缀和 " Suggested outreach purpose (inferred):" 之后的内容）、渠道 · 关系；点击链到 contacts tab `?record=<id>`。
    - 超过 2 条时显示 "View all contacts"。
    - 空态："Contact records are restricted to administrators." 或 "No contacts recorded yet."。
  - **Access conditions**（compliance tab 适用时）：
    - 最多 2 条合规记录：可读标题、司法辖区 · 产品，链到 compliance `?record=<id>`。
    - 超过 2 条时显示 "View all access conditions"。
    - 空态："Access conditions are restricted to administrators." 或 "No access rules recorded. Eligibility has not been established."。
- 状态：
  - 加载中："Loading team progress…"。
  - 失败："Team progress could not be loaded: {err}" + "Try again"。
  - 未登录返回 401，机构不存在或跨 workspace 返回 404。
- 规则：
  - 业务进度（resourceStage）：
    - unknown → "Access not confirmed"
    - requested → "Access requested"
    - negotiating → "Terms in discussion"
    - granted → "Access recorded as granted"
    - expired → "Access expired"
    - rejected → "Request declined"
    - granted 且 expiresOn（YYYY-MM-DD）早于今天（UTC 日期） → "Expiry needs review"，提示中带上过期日期。
  - 技术进度（integrationStage）：
    - unknown → "Progress not recorded"
    - docs_only → "Documentation reviewed"
    - implemented → "Code available · tests not recorded"
    - unit_tested → "Automated code tests passed"
    - sandbox_verified → "Test account verified"
    - production_verified → "Live account verified"
    - 非法值按 unknown 处理。
  - 业务进度与技术进度互相独立：记录了技术通过不代表业务授权。
  - 「需关注」：业务状态为 expired / rejected / expiry_review，或该记录的**当前 revision** 关联的验证请求为 failed 或有 blocker。旧 revision 的请求不计入。
  - 摘要中不能泄露 admin 记录的任何文本。
- 来源：`src/web/components/OrganizationWorkSummary.vue`，`src/modules/work-progress.ts`，`src/server/work-summary.ts`，`tests/work-summary.test.ts`

### 4.9 指标快照与详细指标（原 Stats）
- 入口：Overview 中的指标区，锚点 `#metrics`。标题对 exchange 为 "Market snapshot"，其余为 "Key metrics"。
- 内容：
  - 快照网格：只显示该机构**有值**的指标列(按 9.1 的值选择规则选出)。每格显示指标名、帮助提示（定义 + 可选外部方法论链接）、紧凑数值、单位（annual 指标显示 "· 年份"）。
  - 年份选择：该机构有 annual 指标时显示 "Reporting year" 下拉，范围为今年往前 16 年（倒序），默认去年（UTC）。
  - 折叠区 "Detailed metrics"：表格列为 Metric / Value / Period / Captured / Reference，仅列有值的指标。
  - 折叠区内的样本历史：有来源观测时显示 "Sample history" / "Hide history" 切换。表格列为 Collected / Source / Rank / 24h volume / Reference，数据取自所有成功采集批次，最多 200 行。
  - 说明行："Last market capture {最近采集时间} · Select a value for sources and assumptions."（有来源时显示）。
  - 全无值时显示 "No recorded metrics for this period."。
- 交互：点击任一数值或 "Inspect sources" 打开数据浏览器（见 9.2）；在浏览器中保存观测后，列表重新加载。
- 状态：加载中 "Loading metrics…"；失败时显示错误。
- 来源：`OrganizationOverview.vue`，`OrganizationMetrics.vue`，`ModuleView.vue`（metric-history slot），`src/server/queries.ts`（observations）

### 4.10 事实、链接、快捷入口与参考来源
- 内容：
  - **事实区**：profile.facts 按 section 分组，组与组内都保持导入顺序。每条显示 标签：值，值是一个按钮，悬停提示 "来源名 · 采集时间"，点击打开证据。
  - **Useful links**：外链在新窗口打开，旁边的 ⓘ 按钮打开证据。
  - **Team workspace 快捷入口**：
    - 始终显示：Contacts（"People and business channels"）、Org chart（"Roles and reporting relationships"）。
    - tab 存在时显示：Onboarding（"Connection and account progress"）、Compliance（"Entity, product and access rules"）。
  - **Market data references**（可折叠，显示数量）：每个来源显示提供方名（外链到来源页）、采集时间、"Original snapshot"（打开证据）。
- 来源：`OrganizationOverview.vue`

### 4.11 团队笔记（Overview 下的记录）
- 内容：标题 "Team knowledge" + 数量，按 5.1 的通用记录列表渲染。这些记录没有结构化字段，行右侧显示更新时间。
- 来源：`ModuleView.vue`

## 5 记录与证据

### 5.1 通用记录列表：折叠行
每条记录是一个可展开的原生折叠块。折叠行显示：
- **图标**：contacts 用人像图标，其余用文件图标。
- **主标题**：contacts 且有人名时显示人名，否则显示可读化标题。有 sourceId 时，以代码样式附在后面。
- **一行上下文**（只在没有决策要点时显示）：
  - 叙述型情报模块（api_optimization、capital_optimization、tech_stack）显示正文。
  - contacts 显示「渠道名 · 职位」。
  - 其余模块取摘要字段中前 2 个已记录、且值不为 `unknown` 的字段值，用「 · 」连接。

  摘要字段：services、market_access、payments、custody、data_coverage、infrastructure 为 coverage、delivery；compliance 为 decision、jurisdiction、legalEntity、product；onboarding 为 integrationStage、resourceType、resourceStage、product；contacts 为 channel、role、relationship。
- **决策要点**：叙述型模块以外，显示 4 列「字段名 / 值」小网格，窄容器下为 2 列。取值字段：
  - compliance：jurisdiction、legalEntity、product、effectiveOn
  - services 等 6 个能力模块：coverage、delivery
  - 叙述型模块虽然在代码中有配置，但不显示。
- **contacts 附加一行**：「联系值 · Owner: 负责人或 Not assigned」。
- **右侧状态**：
  - 模块有结构化字段表时：
    - 上行是业务状态：contacts 取 relationship，compliance 取 decision，api_optimization 取 entitlement，其余取 sourceKind。值未记录时不显示。
    - 下行是复核状态，显示翻译后的复核标签；`expiresOn` 早于今天时改为「Review overdue」，并用待复核色。
  - 没有字段表的模块显示更新时间。
- **「已记录」判定**：空、空白、`unknown`、`not_recorded`、`unverified`（不区分大小写）都算未记录；`0`、`-1`、`not_requested`、`rejected` 算已记录。
- **contacts 行内快捷操作**（点击不会展开折叠块）：
  - 打开渠道（新窗口）：email 用 `mailto:`，phone 用 `tel:`，其余直接用值作为 URL；wechat 不提供链接。
  - 复制：复制联系值，没有联系值时复制人员邮箱。成功时状态提示「Copied」，失败时提示「Could not copy. Select the address to copy it manually.」。
  - 接触记录：打开对话框，标题为人名或记录标题，内容是限定于该联系人的讨论面板。
- 规则：业务状态只来自结构化字段，不从正文或复核状态推断。来源为「官方」不代表账户已获授权或已测试通过。
- 来源：tests/record-summary.test.ts；tests/narrative-intelligence.test.ts；tests/wechat-contact.test.ts（微信不生成假链接）；src/modules/record-summary.ts；src/modules/knowledge.ts contactHref；src/web/components/ModuleView.vue；docs/ui-redesign-2026-09-19.md（情报摘要、联系人行）

### 5.2 通用记录列表：展开详情
按先后顺序：
1. **头部**：
   - 来源徽章：「Source: {证据等级}」，悬停显示说明。证据等级：REPORTED=Reported information，OFFICIAL=Official source，CONTRACTED=Written approval，VERIFIED=Verified with evidence，ENFORCED=Control in place。REPORTED 且 sourceKind 为 public_directory、public_social、repository_code 或 repository_document 时，改为显示来源种类名。
   - visibility=admin 时显示「Administrator」锁徽章。
   - 版本号 `vN`。
   - 编辑按钮，非 reader 可见，打开记录编辑器(5.6)。
2. **标题**：可读化后的记录标题。
3. **有证据等级时**：敏感度徽章，以及「{负责人} · Reviewed {复核日期}」。
4. **contacts**：主联系值（能生成链接时显示为链接），以及人名或「Organization channel」。
5. **人员邮箱**：显示为 mailto 链接；与 contacts 的联系值相同时不重复显示。有人名但没有邮箱的联系人显示「Email not published」。
6. **正文与结构化字段**：
   - 叙述型模块先显示正文，结构化字段折叠在「Supporting details」下。
   - 其他模块直接显示字段网格。
   - 网格只列已记录的字段，排除 evidenceLevel、sensitivity、owner、reviewedOn、value、verification；每个值下附该取值的解释（如有）。
7. **下一步**（verification 字段）：标题按模块不同，onboarding 为「Checks and next steps」，contacts 为「Contact notes and follow-up」，其他为「What to check next」。
8. **正文**：非叙述型模块在此显示；随后显示适用范围标签，其中「Organization-wide」需要翻译。
9. **关联链接**：
   - 每个关联的共享对象显示「{对象名} · Connections & evidence」，链接到 `/organizations/:id/relationships?object=`。
   - 没有关联对象且非 reader 时，显示「Connect to a shared object」，链接到 `relationships?sourceRecord=`。
   - 非 reader 另有「Create follow-up task」，链接到 `/work?organizationId=&sourceRecord=`。
10. **页脚**：「作者 · 更新时间」，以及「Original source」（原文抽屉）、「Attachment」（有附件时）、「History」三个入口。
- 规则：关联对象在列表加载后单独请求（relationships 模块不请求）；请求失败时静默忽略，原记录照常显示。
- 来源：src/web/components/ModuleView.vue；src/web/presentation.ts；docs/architecture.md §Workbench presentation / §Curated research

### 5.3 联系人分组与筛选
- 分组按钮：All、People、Team channels、Official channels，每个按钮后面显示卡片数。
- 分组规则：有人名的归 People；`relationship=public_channel` 的归 Official channels；其余归 Team channels。
- 合并卡片：只有明确关联到同一个 person 共享对象的多条记录，才合并成一张卡片。同名不合并；一条记录关联了多个不同 person 对象时，保持独立。
- 合并卡片的显示：折叠行显示人名、去重后的职位列表和「渠道: 值」预览；展开后每条子记录以渠道名作为标题。
- 来源：tests/contact-groups.test.ts；src/modules/contact-groups.ts；src/modules/record-summary.ts contactGroup

### 5.4 深链定位与合规选择
- `?record=<id>`：数据或 query 变化后，如果该记录在当前模块中，就展开它（外层是联系人合并卡片时一并展开）并滚动到它。关联对象加载完成后会再定位一次。
- compliance 模块的列表只显示在矩阵里选中的那一条记录，并提供「Close」按钮取消选择。点击矩阵单元格会选中该记录，然后平滑滚动到它并展开。
- 来源：src/web/components/ModuleView.vue；docs/ui-redesign-2026-09-19.md（合规行）；docs/ui-information-design.md（来自 Overview 的深链接打开对应记录）

### 5.5 记录版本历史
- 入口：记录页脚的「History」，也可由架构图、人员流动、接入、路线图面板触发。
- 内容：对话框标题「VERSION HISTORY / Record history」，版本从新到旧排列。每个版本显示 vN、标题、正文和人员邮箱。chart 模块另外显示汇报关系：上级名，上级记录不可见时显示「Position unavailable」，没有上级时显示「No recorded manager / Top level」；再加 Confirmed 或 Unconfirmed、关系说明和「Relationship reference」原文。有结构化字段时，可展开「Structured fields」查看 JSON。每个版本的页脚为「作者 · 时间」和「Version reference」原文入口。
- 规则：管理员可见记录的历史只有 admin 能看。
- 来源：src/web/components/ModuleView.vue；src/server/app.ts `/records/:id/history`、`/organizations/:id/history`；docs/architecture.md §Access and maintenance

### 5.6 记录编辑器
- 入口：各 tab 的 "Add record"、Overview 的 "Add note"、记录上的编辑按钮、讨论的 "Edit"。
  - 标题随场景变化："Add organization knowledge" / "Edit record" / "Add person" / "Edit person" / "Add discussion" / "Add milestone" / "Edit milestone"。
  - 眉标为 "机构名 / tab 名"。
- 内容：表单字段按以下顺序：
  1. Title（必填，≤160）。chart 的标签为 "Role / job title"；comments 没有标题，取正文第一行的前 160 字。
  2. chart / timeline：Person name（必填，≤100）。
     - chart 额外有 "Reports to"：选项为 "No recorded manager / Top level"，以及同可见性、且不是自己后代的职位。
     - timeline 额外有：
       - 事件类型（必填）：joined / left / role_change。
       - 日期含义：announcement / effective / reported / unknown。
       - 日期精度：day / month / year / unknown。切换精度时自动截断日期（year 取 4 位，month 取 7 位，unknown 清空，day 若不是 10 位则清空）。
       - 日期输入：精度不是 unknown 时必填。
       - "Date wording in source"（≤500）。
       - "Before and after" 组：前/后机构、前/后职位。
       - 实时预览："In {org}, this will appear as: {类型}"。
  3. chart 有上级时：
     - "Reporting relationship"：unconfirmed（虚线）/ confirmed（实线）。
     - "Relationship evidence / reason for change"：关系发生变化且保留原引用时必填。
  4. 结构化字段（有字段契约的 tab，见 5.7）：
     - 编辑区标题 "Record details"。
     - onboarding 分为 4 组：Resource & business access / Technical connection / Next step & ownership / Evidence & review。
     - 必填字段标 `*`。
     - 选择 constraintKind 后提示 "Expected keys for {kind}: …"。
  5. contacts / chart / timeline：Person email（可选，email 格式，≤200）；contacts 另有 Person name（可选）。
  6. Notes（必填，≤20000）；comments 的标签为 "Message"。
  7. Scope（必填，≤300，默认 "Organization-wide"）和评审状态："Needs review"(unverified) / "Marked confirmed"(confirmed) / "Follow-up in progress"(in_progress) / "Follow-up complete"(done)。roadmap 中该项标签为 "Evidence review"。comments 没有这两项。
  8. "Keep the original reference" 区（comments 没有）：
     - 编辑时有勾选框 "Keep the existing original reference"，默认勾选。
     - 不勾选或新建时：Original text 必填（≤100000），Source URL 可选（http/https）。
     - Attachment 可选，≤5MB。
  9. Visibility（仅 admin 可见）：Internal team / Administrators only；编辑时禁用。
  10. 页脚："Current version v{n}"（编辑时）或 "Edits retain the original reference."（新建时）；Cancel；"Save record" / "Save person"。
- 交互（草稿与离开保护）：
  - 草稿自动存到本浏览器标签页的会话存储，键为 用户 + 机构 + tab + 记录ID + revision。
    - 表单回到初始值时自动删除草稿。
    - 重新打开时若有草稿，显示 "An unsent draft is available in this tab." 和 "Restore draft" / "Discard draft"。
    - 附件不进草稿。
  - 有改动时点 Cancel、关闭按钮或遮罩：先出内联提示 "Close the editor and keep its text draft? Attachments are not saved."，按钮为 "Keep draft and close" / "Continue editing"。
  - 有改动时切换路由：浏览器 confirm "Leave the editor? Your text draft stays in this tab; attachments must be selected again."。
  - 有改动时关闭或刷新页面：触发浏览器离开提示。
  - 存储不可用时提示 "Draft storage is unavailable. Keep this page open until you save."。
  - 保存成功后清除草稿、关闭编辑器、刷新模块。
- 规则（服务端）：
  - 新建的默认值：
    - 每个下拉字段取第一个选项（onboarding.environment 默认 `dev-cred`）。
    - owner = 当前用户名；reviewedOn = 今天（UTC）。
    - status = unverified，visibility = team。
  - 乐观并发：编辑必须带 revision，不匹配返回 409 "This record has changed. Reopen the latest version."。每次保存 revision+1，并写入一条编辑历史。
  - 原引用：新建时不能选「保留原引用」（422）；不保留时必须有原文（422 "Original reference text is required."）。原文按字节原样保存，前后空白也保留。
  - 附件为 1 字节到 5MB；前端超限提示 "The attachment limit is 5 MB."。
  - NDA 规则：
    - 敏感度为 NDA 的记录必须是 admin 可见（422 "NDA records must use administrator visibility."）。
    - NDA 与证据等级 OFFICIAL 不能同时出现。
    - admin 可见的记录只有 admin 能创建或编辑。
  - 汇报关系只允许用于 Org Chart（其他 tab 返回 422）。关系变更必须附依据（422 "Record the evidence or reason for this relationship change."）。上级不能造成循环，不能跨机构，可见性必须相同。
  - People Movements：必须有人名与事件类型。日期格式为 `YYYY-MM-DD` / `YYYY-MM` / `YYYY` / 空，精度必须与日期一致。
  - 来自个人档案的职业条目不能在此编辑（422，提示去人才库档案中修改）。
  - stats tab 不接受记录。
  - comments 的引用校验：
    - replyTo 必须指向同机构 comments 中的根消息（不能回复一条回复）。
    - relatedRecord 必须指向同机构的 contacts 记录。
    - 引用受限记录时，本条也必须是 admin。
    - 回复的 relatedRecord 必须与父消息一致。
- 来源：`src/web/components/RecordEditor.vue`，`src/web/components/KnowledgeFields.vue`，`src/web/composables/useDraft.ts`，`src/server/app.ts`（records 路由），`src/server/discussion.ts`，`src/modules/movement-date.ts`，`tests/knowledge.test.ts`，`tests/public-research.test.ts`（日期精度）

### 5.7 字段契约（按 tab）
- 规则（通用）：
  - 未知字段拒绝（strict）。文本 ≤500，textarea ≤4000。
  - number：十进制，不带分隔符，最多 24 位整数、12 位小数，不接受科学计数；除 makerFeeBps 外不允许负数。
  - date：合法的 YYYY-MM-DD。
  - 选项值必须在枚举内。
- **通用证据字段**（附在 services 类 / api / capital / tech / compliance / onboarding / contacts 之后）：
  - 必填：evidenceLevel、sensitivity、sourceKind、owner、reviewedOn、verification。
  - 可选：sourceRef、expiresOn。
  - evidenceLevel 枚举：REPORTED "Reported information" / OFFICIAL "Official source" / CONTRACTED "Written approval" / VERIFIED "Verified with evidence" / ENFORCED "Control in place"。每项有解释提示，例如 OFFICIAL 提示 "does not confirm access for our account"。
  - sensitivity 枚举：PUBLIC / INTERNAL / NDA。
  - sourceKind 枚举：user_report / public_directory / public_social / repository_code / repository_document / official_website / provider_agreement / measurement。
- **services / market_access / payments / custody / data_coverage / infrastructure**：product*、coverage*（textarea）、delivery、conditions*（textarea）。
- **api_optimization**：
  - 字段：
    - mechanism*：depth_stream / trade_stream / whitelist / account_routing / rate_limit / protocol / fee_query。
    - product*。
    - accountModel：unknown / standard / portfolio_margin / portfolio_margin_pro / unified / contract / multi。
    - entitlement：unknown / not_requested / requested / granted / rejected / expired。
    - endpoint、intervalMs、p50Us、p99Us（均为 number）。
    - prerequisites*。
    - environment。
  - 另加结构化约束字段：
    - sourceId：`SRC-<venue>-<slug>`，小写；同机构内唯一，重复返回 409。
    - constraintKind：none / whitelist / rate_limit / protocol / endpoint / account_model / network_route / entitlement。
    - constraintValue：JSON 对象，按 kind 校验其结构(各 kind 的 schema 见 v1 `src/shared/verification-contract.ts`,与 quant 验证契约同源)。
    - constraintExportable：yes / no。
    - affectsFeatureKeys：逗号分隔，形如 `a.b.c` 或 `a.b.*`。
    - 约束规则：kind=none 时 constraintValue 必须为空；kind≠none 时必须有 sourceId；NDA 的约束必须设 constraintExportable=no。
- **capital_optimization**：
  - mechanism*：vip_qualification / collateral_financing / fee_discount / borrow_cost / rebate / strategy_economics。
  - product*、vipTier、holdingAsset、holdingAmount（number）。
  - holdingMethod：unknown / owned / borrowed / mixed。
  - borrowAprBps、makerFeeBps（负数表示返佣）、capitalUsd、qualificationCostUsd（均为 number）。
  - conditions*、economics*。
- **tech_stack**：
  - layer：unknown / network_edge / api_gateway / matching_engine / client_deployment。
  - cloud、region、zoneLabel、zoneId、instanceType。
  - route：unknown / public_cdn / public_direct / private_link / colocation。
  - allocation：unknown / standard / sample_and_measure / guaranteed。
  - endpoint、constraints*。
  - 另加上面的约束字段。
- **compliance**：
  - decision：unknown / whitelist / blacklist / conditional，标签依次为 "Access rules not confirmed" / "Only listed users / products allowed" / "Listed users / products restricted" / "Access depends on conditions"。
  - jurisdiction*、legalEntity*、product*、authority、license、effectiveOn（date）、control*。
- **contacts**：
  - channel：email / telegram / wechat / x / linkedin / website / phone。
  - value*、role*。
  - relationship：public_channel / not_contacted / contacted / active / inactive。
  - 校验：email 渠道必须是合法邮箱；telegram / x / linkedin / website 必须是 https URL（拒绝 `javascript:` 等）；wechat 只是账号 ID，不生成链接。
- **onboarding**(进度界面见 10.9,请求见 11.1)：
  - venueKey*：`^[a-z][a-z0-9_-]*\.[a-z0-9_-]+$`，例如 cex.binance。
  - integrationStage：unknown / docs_only / implemented / unit_tested / sandbox_verified / production_verified。
  - resourceType：api_credentials / whitelist / low_latency_stream / vip_tier / credit_line / colocation / market_data_rights / general_access。
  - resourceStage：unknown / requested / negotiating / granted / expired / rejected。
  - capabilities*：从 market / wallet / trading / wallet_actions / transfer / asset_network 中逗号分隔选取。
  - accountRef；credentialRef（只接受 `secret://…`）；resourceRef。
  - product*。
  - environment*：dev-us / dev-cred / colo-live，默认 dev-cred。
  - nextAction：none / validate_readonly / prepare_config / propose_adapter_change。
  - businessOwner、technicalOwner、nextStep（textarea）、blockers*。
- **roadmap**：
  - planType：organization / collaboration。
  - roadmapStatus：planned / in_progress / on_hold / delivered / cancelled。
  - targetPeriod：YYYY / YYYY-Q1..Q4 / YYYY-MM / YYYY-MM-DD，可空。
  - owner、successCriteria*、impact、nextStep、reviewedOn*。
- **comments**：只有 replyTo、relatedRecord、occurredOn（date），均可空。
- 展示：每个枚举值都有英文展示标签，完整映射表在 `src/web/presentation.ts`。
  - 展示映射**不改动**存储的枚举值与原文。
  - 已知的导入模板文本（notes / blockers / titles）替换为可读句子；自由文本不改写。
- 来源：`src/modules/knowledge.ts`，`src/modules/constraints.ts`，`src/web/presentation.ts`，`tests/knowledge.test.ts`，`tests/work-summary.test.ts`

### 5.8 Compliance 规则矩阵
- 入口：compliance tab 有记录时，显示在记录列表上方。
- 内容：
  - 说明："Each row is a recorded policy scope. Unknown eligibility does not mean permission to trade."。
  - 列：Exact legal entity / Jurisdiction / Product and customer scope / Who can use this?（decision 标签，按取值区分样式）/ Effective on / Reference。
  - 空值显示 "Not recorded"。
- 交互：
  - "Rule & evidence"：下方记录列表只显示该条规则，自动展开并滚动到它。
  - "Close"：取消选择，下方列表清空。
  - `?record=` 深链有同样效果。
- 来源：`src/web/components/ComplianceMatrix.vue`，`ModuleView.vue`

### 5.9 讨论（Comments tab）与联系人对话记录
- 入口：
  - Comments tab。
  - contacts 行上的时钟按钮，打开对话框 "Conversation history"，标题为联系人名或记录标题。
- 内容：
  - 撰写框（非 reader）：
    - 标签在 Comments tab 为 "Share an update or ask the team"，在对话记录中为 "Record a conversation"。
    - 占位文字："What changed, what did you learn, or what needs a decision?"，≤20000 字。
    - 提示 "Your message is saved as its original reference."。
    - admin 发新主题时可选可见性。回复和联系人对话继承父级/联系人的可见性。
  - 消息列表：
    - 根消息：作者、时间、admin 锁标，操作为 "Reply" / "Original reference" / "Edit"（仅 Comments tab）/ "Create follow-up task"。
    - 回复只有一层，缩进显示在父消息下，只有 "Original reference" 操作。
    - 每条消息的 DOM 锚点为 `record-<id>`。
  - 联系人对话记录只列出 relatedRecord 等于该联系人的讨论。
- 交互：
  - Reply：进入回复模式，显示 "Replying to {作者}" 和 "Cancel reply"，焦点移到撰写框。
  - 草稿：键为 用户 + 机构 + (联系人ID | general)，保存正文、可见性和回复目标；恢复与丢弃的提示同编辑器。
  - 正文为空时发送按钮禁用。发送成功后清空并刷新。
  - Edit 打开记录编辑器（comments 模式）。编辑保存时，正文本身作为新的原引用保存。
- 状态：
  - 无消息："No discussion yet. Start with a question or a short update."。
  - 联系人无对话："No conversations recorded yet."。
- 规则(联系人对话)：关联的联系人必须是本机构中调用者可见的记录，否则 422(admin 联系人、其他机构的联系人、不存在的记录都拒绝)。原文按原样保存为证据。
- 来源：`src/web/components/DiscussionPanel.vue`，`src/server/discussion.ts`，`RecordEditor.vue`，`tests/talent.test.ts`

### 5.10 证据抽屉
- 入口：全局单例，任何 "Reference"、"Original source"、"Original reference"、"Inspect evidence"、事实值、指标观测等按钮都会打开，参数为证据 ID。
- 内容：
  - 眉标 "SOURCE REFERENCE"，标题 "Original reference"。
  - 来源徽章：来源类型的显示名。public_profile 或 person_profile 且 URL 为 linkedin.com 时显示 "LinkedIn"。
  - 文件名；元数据：Captured、Parser version、File size（字节）、SHA-256。
  - "Open source page"（有 URL 时，新窗口打开）；"Download original file"（以附件方式下载原始字节）。
  - 说明："Saved original content. HTML is displayed as text; page scripts are not executed."。预览超过 500000 字节时截断，并追加 "Preview truncated. Download the full file to see all content."。
  - 文本类内容以等宽原样显示。非文本（附件）显示 "Attachment saved"、"Download the attachment to view its original content."。
- 交互：Esc、关闭按钮或点遮罩关闭，焦点回到触发按钮（浏览器已验证 Escape 行为）。同一时间只开一个抽屉；打开新证据会替换当前内容。
- 状态：加载中 "Loading original reference…"；错误时显示错误，例如 403 "Administrator access is required."、404 "Reference not found."。
- 规则：
  - 证据按 sha256 内容寻址存储。同内容多次保存会生成多条快照元数据（各自有 URL、类型、时间、可见性），但共用同一份原件。
  - 手工原文的 parserVersion 为 `manual-v1`，默认文件名为 `reference.txt`。
  - 快照的可见性随所属记录或对象，admin 快照对非 admin 返回 403。
  - 编辑记录时，旧版本的原引用永久保留，历史中仍可打开。
  - v2 的原件放 S3，但以上用户可见字段与行为保持不变。
- 来源：`src/web/components/EvidenceDrawer.vue`，`src/server/evidence.ts`，`src/server/app.ts`（/evidence/:id），`tests/rankings.test.ts`，`tests/knowledge.test.ts`，`docs/verification.md`

## 6 人员

### 6.1 组织架构图(机构 → 组织架构 标签)
- 入口:`/w/internal/organizations/:orgId/org_chart`。这是所有机构类型都有的基础标签。`?record=<recordId>` 深链会先初始化图，再展开这个人的所有上级、选中他、居中显示(即 1.2 的定位)。
- 内容(自上而下):
  1. 模块标题 + "添加人员"(Add person,reader 看不到)。
  2. 工具栏:图/列表切换;"画布模式"开关;"聚焦选中分支"(仅在已选中人员且未聚焦时显示)或"返回完整机构"(聚焦时显示);搜索框(占位 "Find a person or role…");人数"N person/people";缩放组(−、百分比、+、"适应");"全部展开/全部收起"(至少有一人有下属时才显示)。
  3. 搜索结果列表(搜索框非空时显示)。
  4. 图例:实线=已确认直属汇报，虚线=未确认关系;附一句提示——可编辑用户看到"拖动手柄到上级即可调整汇报"，reader 看到"只读图表"。
  5. 机构根区域：机构 logo 和名称、"顶层 · 未记录上级"、没有上级的职位数(N position/positions)。
  6. 画布或列表。
  7. 状态行(role=status,拖拽提示用)。
  8. 脚注："虚线是未确认关系，不是已核实的汇报线;没有上级记录的人留在顶层。"
  9. 人员详情侧栏(选中后出现)。
- 交互:
  - 图/列表切换：切换展示方式;"在图中定位"会自动切回图。
  - 画布模式：固定铺满视口(四周留少量边距),工具栏吸顶，画布高度 = 视口高度 − 230px。Esc 退出(拖拽中或改汇报对话框打开时 Esc 不退出)。普通模式下画布高度 = clamp(布局高度×缩放 + 16, 360, 680)px。
  - 缩放:± 步长 10%,范围 40%–140%,缩放时保持视口中心点不变。"适应":缩放 = clamp(0.4, 1, (视口宽 − 24)/布局宽),然后把根节点水平居中，滚到顶部。
  - 全部展开/收起：当前有任何收起的节点 → 全部展开;否则收起所有有下属的节点。
  - 聚焦分支：只显示选中人员的子树(选中者当根),缩放重置为 100%,根居中。
  - 搜索：在全部人员(不受聚焦分支限制)的姓名、职位、邮箱里做不区分大小写的子串匹配;画布上高亮匹配节点;结果列表每项显示"姓名 + 职位",点击即定位;无结果显示"没有匹配的人员"。
  - 定位：切到图模式;目标不在当前分支里就退出聚焦;缩放设为 100%;选中目标;展开它的全部上级;平滑滚动，使节点水平居中、顶端离视口上沿 30px。
  - 点击节点主体 → 选中，打开详情侧栏，侧栏自动滚进可见区域。
  - 节点上的"N 名下属 +/−"按钮 → 展开或收起该节点的子树(aria-expanded)。
  - 切换机构时全部重置：搜索、选中、聚焦、列表模式、画布模式、缩放 100%、初始收起状态，并把根居中。首次数据异步到达时只初始化一次;之后保存引起的刷新保留展开状态和缩放。
- 状态:没有人员时显示空态(图标;"建立该机构的人员地图";"先添加人员和职位，了解更多后再连接汇报关系";可编辑用户另有"添加第一个人"按钮)。
- 规则(布局):
  - 自上而下的树。`reportsTo` 为空、指向不存在的人或指向自己的记录都是根，放在第一层。
  - 同一上级的下属按姓名(en locale)升序排列，同名再按 id。
  - 卡片 232×184;兄弟卡片水平间距 32,层间垂直间距 76。子树宽度 = max(卡片宽, 各子树宽之和 + 间距);父卡片居中于子树跨度之上;多个根从左到右排列。卡片互不重叠。
  - 连线是正交折线：父卡片底边中点 → 垂直到层间中线 → 水平 → 垂直到子卡片顶边中点。线型由子节点的 `relationshipKind` 决定(confirmed 实线，unconfirmed 虚线)。
  - 收起的节点不显示后代，但仍显示下属数量。遇到循环不死循环。
  - 初始收起：根和根的直接下属可见;凡是"自己有上级且自己有下属"的节点都收起。
- 规则(节点卡片):
  - 可编辑用户看到拖拽手柄"⠿"(aria "Move {姓名}",提示"拖到另一位上级，或按 Enter 选择")。
  - 头像显示姓名前两个词的首字母(大写)、姓名、职位。
  - 汇报状态徽标三选一:"已确认汇报线"/"未确认汇报线"/"未记录上级"。
  - 有下属时显示"N report(s) +/−";没有下属时显示"未记录下属"。
- 规则(列表模式):
  - 列：姓名(点击选中)| 职位 | 上级(姓名，或"未记录上级 / 顶层")| 关系("已确认直属汇报"/"未确认关系";没有上级时为"—")| "在图中定位"。
  - 搜索框非空时列出搜索结果，否则列出当前分支的人员。
- 来源:`src/web/components/OrgChart.vue`、`src/modules/org-chart.ts`、`tests/org-chart.test.ts`(第一个 test)

### 6.2 调整汇报关系(拖拽 / 键盘 / 对话框)
- 入口：拖动节点手柄;在手柄上按 Enter/Space;详情侧栏的"调整汇报"。只对可编辑用户开放。
- 交互(拖拽):
  - 鼠标左键按住手柄。保存进行中时不能开始拖拽。移动超过 6px 后拖拽才生效，出现一个跟随指针(偏移 14px)的姓名标签，源卡片置灰。
  - 放置目标按指针下方的元素判定:
    - 机构根区域：仅当被拖的人当前有上级时有效，含义是"移到顶层"。拖拽中根区域的文案变成"拖到这里即移除已记录的上级"。
    - 其他节点：有效条件是——不是自己或自己的后代、不是当前上级、可见性相同。
  - 状态行实时提示：有效时显示"将 X 移到 Y,松开后确认";无效时显示"请放到另一位上级或顶层区域，后代不能成为上级"。
  - 指针在画布内离边缘不到 42px 时，画布每帧自动滚动 12px。
  - 在有效目标上松开 → 打开确认对话框，并预填该目标。在无效处松开 → 状态行显示"已取消移动，汇报关系未变"。Esc 或 pointercancel 也会取消拖拽。
- 内容(确认对话框):
  - 眉题"{机构} / 汇报关系";标题"移动 {姓名}";显示当前上级。
  - "汇报给"下拉：顶层，加上所有"不是自己或后代、可见性相同"的人员(显示"姓名 · 职位")。
  - "关系确定性":选了上级才显示，可选"未确认 · 虚线"和"已确认直属 · 实线"。只要改成非当前上级，就自动重置为未确认;打开时，若目标就是当前上级则沿用现有确定性，否则默认未确认。
  - "原始证据 / 变更理由":必填，最长 100000 字，占位提示写清谁、什么、何时。
  - "来源 URL":选填。
  - 一句说明：人员原始引用保留，这次关系变更单独留引用和历史。
- 交互:
  - "保存关系"按钮只在"上级变了，或上级不变但确定性变了"且理由非空时可用;保存中显示"Saving…"。
  - 保存中取消、关闭和遮罩点击都无效。
  - 保存成功 → 关闭对话框并刷新;失败 → 在对话框内显示错误。
- 规则(服务端，测试断言):
  - reader → 403。
  - 理由为空白 → 422。上级在其他机构 → 422。上级可见性不同(例如 team 员工挂到 admin 上级)→ 422。上级是自己或后代(会成环)→ 422。来源 URL 不是 http(s)(如 `javascript:`)→ 422。
  - revision 过期 → 409。editor 移动 admin 记录 → 404。
  - 移动时新建一份独立的关系证据(`relationshipRawId`),人员自己的原始证据、正文、邮箱都不变;revision +1,写入版本历史。
  - 移到顶层时确定性强制为 unconfirmed。
  - 新建人员的关系默认 unconfirmed,即使记录状态是"已确认"也一样;没有关系元数据的旧数据读出来也是 unconfirmed。
  - 通用编辑器改上级时，必须提供新的关系理由，否则 422。只改其他字段时保留原有确认状态。
- 来源:`src/web/components/OrgChart.vue`、`tests/org-chart.test.ts`(第二个 test)

### 6.3 人员详情侧栏(组织架构)
- 入口：选中节点、点列表姓名，或 `?record=` 深链。
- 内容:
  - 眉题"人员详情"、姓名、职位、关闭按钮。
  - 邮箱:mailto 链接;没有时显示"未公布 / 未记录"。
  - 上级：姓名 + 确定性。
  - 最后更新：作者 · 时间 · vN。
  - "目标与激励"区块(见 6.16)。
  - 备注正文。
  - 若有关系证据说明，显示"关系证据"。
- 交互(底部按钮):"编辑人员"和"调整汇报"(仅可编辑用户);"人员引用"(打开人员原始证据);"关系引用"(有关系证据时);"历史"(打开版本历史)。
- 来源:`src/web/components/OrgChart.vue`

### 6.4 新增 / 编辑人员(组织架构专属字段)
- 入口：模块标题的"添加人员"、空态按钮、侧栏的"编辑人员"。通用记录编辑器(草稿、原始引用、附件、状态、可见性)见 5.6,本节只写组织架构特有部分。
- 内容:
  - 标题"添加人员/编辑人员"。
  - "角色/职位":必填，≤160 字，占位"例如 Head of Institutional Sales"。
  - "姓名":必填，≤100 字。
  - "汇报给":顶层，或非后代且可见性与表单一致的人员。
  - 选了上级时显示"汇报关系"(未确认虚线/已确认实线)。
  - 选了上级或关系有变化时显示"关系证据/变更理由";关系有变化且沿用原引用时，该项必填。
  - "邮箱(如已知)":选填。
  - 保存按钮"保存人员"。
- 规则：保存任何带姓名的记录后，服务端会自动为它建一个独立人员档案(`person-record:<id>`),同名记录不会合并。
- 来源:`src/web/components/RecordEditor.vue`、`src/server/app.ts`(ensurePersonDossier)、`src/server/person-profiles.ts`

### 6.5 人员变动列表(机构 → 人员变动 标签)
- 入口:`/w/internal/organizations/:orgId/people_movements`(timeline 类标签)。`?record=<id>` 会展开并滚动到对应卡片。
- 内容:
  - 视角说明："相对于 {机构} 的变动"。
  - 类型筛选按钮：全部 N | 入职 N | 离职 N | 岗位变动 N | 其他动态 N。"其他动态"计数为 0 时隐藏。计数按合并后的"变动"算，不按来源条数算。
  - 搜索框("搜索人员、机构或职位")。
  - 变动卡片列表：默认全部折叠。
- 交互:
  - 类型按钮单选(aria-pressed),"全部"清除筛选。
  - 搜索在一组所有来源的姓名、标题、前后职位、前后机构里做不区分大小写的子串匹配。
  - 点击卡片摘要展开或收起。
- 内容(卡片摘要):
  - 类型徽标：图标 + 名称，悬停提示说明。按当前机构视角着色：入职绿，离职红，岗位变动紫，其他中性。
  - 姓名;如果有多个来源，附"N 个来源 · 同一变动"。
  - 路线:
    - 岗位变动且有职位时显示"原职位 → 新职位"(未知写"职位未记录");没有职位时显示记录标题。
    - 其他类型显示"原机构 → 新机构",当前机构高亮;未知写"原机构未记录"/"去向未记录"。
  - 日期：日期含义标签(有日期时才显示)+ 按精度格式化的日期。
- 内容(展开详情,按顺序):
  1. 来源标题。
  2. "之前/之后"两栏，每栏是机构 + 职位。
  3. 固定说明:"缺失的职位或机构保持未知，离职不代表已知去向。"
  4. 若 `transitionBasis=adjacent_profile_roles`:说明"根据同一份履历的相邻任职关联;同月或同年不代表确切交接日，也不排除空档"。
  5. 若 `transitionBasis=explicit_profile_transition`:说明"按来源证据显式关联，日期分别保留"。
  6. "上一职位结束:X · 下一职位开始:Y"(有值时显示，缺失写"未记录")。
  7. "来源时间表述:{dateLabel}"。
  8. 若 dateBasis 为 announcement:警示"这是公告日期，不是确定的入职或离职日期"。
  9. 正文。
  10. "该变动的其他来源"(可折叠):每个来源显示标题、日期含义 · 日期、正文，以及"原始来源""历史"按钮。
  11. 审核状态徽标 + 适用范围。
  12. 底部：作者 · 更新时间;操作按钮。
- 交互(卡片操作):
  - "探索此人身份"(Explore identity):跳到 `/w/internal/organizations/:orgId/relationships?object=<包含该记录的共享对象 id>`;找不到共享对象时用 `record:<recordId>`。
  - "原始来源""历史"。
  - 若记录由个人履历生成(`structured.personProfileId` 存在):显示"更新来源履历",跳到 `/w/internal/talent?person=record:<id>`,不提供直接编辑。否则非 reader 看到"编辑人员变动"(Edit movement)。
- 状态:
  - 标签内没有记录时，显示通用空态"可以录入第一条信息"+"添加第一条记录"。
  - 筛选后为空时显示"没有符合筛选条件的人员变动"。
- 规则(排序):已知日期在前;日期字符串降序(因此同月内，精确到日的排在只有月份的前面);最后按 id 升序。
- 来源:`src/web/components/PeopleMovements.vue`、`tests/browser/exploration.spec.ts`(第一个 test)、`tests/browser/career-links.spec.ts`、`docs/relationship-exploration.md` §人员变动

### 6.6 机构视角分类规则
- 规则:
  - 机构名匹配只做 NFKC、去首尾空白、压缩空白、忽略大小写。不推断别名:`Binance.US` 不等于 `Binance`。
  - 先补全端点:
    - 结构化字段 `fromOrganization`/`toOrganization` 优先。
    - 旧事件类型只在不与显式端点冲突时，才把当前机构补作端点:
      - `left`:去向不是本机构时，把本机构补作来源。
      - `joined`:来源不是本机构时，把本机构补作去向。
      - `role_change`:另一端为空或是本机构时，把本机构补到空的那一端。
  - 再分类：来源和去向都是本机构 → 岗位变动;只有来源是 → 离职;只有去向是 → 入职;都不是 → 其他动态。
  - 例子:"Binance → Bitget" 在 Binance 视角是离职，在 Bitget 是入职，在 OKX 是其他动态。
  - 分类只影响显示，不改写来源的事件类型。
- 规则(人员级摘要，用于人才库):来源和去向都已知且不是同一机构 → 类型为"转任"(`transferred`,徽标用岗位变动的颜色),显示"A → B",机构取去向;否则用视角分类的结果。未知类型显示"类型未记录"。
- 来源:`src/modules/people-movements.ts`、`tests/movement-perspective.test.ts`、`tests/exploration.test.ts`(第三个 test)

### 6.7 多来源合并展示
- 规则:
  - 只有 `structured.movementGroupId` 相同且姓名相同的记录才合并成一个"变动"。不按姓名 + 日期做模糊去重;没有这个键的记录各自独立。
  - 合并组的主记录优先级:dateBasis 为 `effective` 最高，其次 `reported`,其余并列最后;同级再按日期排序。所以默认展示任职时间，不展示公告时间。
  - 所有来源都保留，放在"其他来源"里。
- 来源:`src/modules/people-movements.ts`(groupMovementRecords)、`tests/movement-perspective.test.ts`、`docs/personnel-audit-2026-09-20.md`

### 6.8 新增 / 编辑人员变动(timeline 专属字段)
- 内容:
  - 姓名(必填，≤100)。
  - "来源描述的事件":必填，可选 入职/离职/岗位变动。
  - "日期含义":公告日期 `announcement` / 生效日期 `effective` / 来源日期 `reported` / 含义未注明 `unknown`,默认 unknown。
  - "日期精度":精确到日 / 仅月份 / 仅年份 / 未公布。
  - 日期输入框：精度不是"未公布"时显示且必填;年份用 4 位数字文本，月份用月份选择器，日用日期选择器。
  - "来源中的日期原文":≤500 字，占位如"Post: 2mo ago; exact joining date not stated"。
  - "变动前后"字段组:原机构、新机构、原职位、新职位，各 ≤200 字。机构框的占位显示按当前视角推导出的端点。说明文字:"只填来源明确给出的值，未知留空"。
  - 实时预览:"在 {机构} 中将显示为:{类型}"。
  - 邮箱(选填)。
- 交互：改日期精度时自动截断已填日期——年份保留前 4 位，月份保留前 7 位;精度改为"日"但日期不完整，或改为"未公布",都清空日期。
- 规则:
  - 日期只接受空值、`YYYY`、`YYYY-MM`(01–12)、合法的 `YYYY-MM-DD`(如 `2026-02-29` 不合法)。`2026-2`、`11mo` 这类都拒绝。
  - 精度必须与日期格式一致，否则 422;不填时由服务端推导。
  - dateBasis 只能取上述四个枚举值。
  - 元数据字段白名单(strict):`eventDatePrecision`、`dateBasis`、`dateLabel`、`fromRole`、`toRole`、`fromOrganization`、`toOrganization`、`movementGroupId`(≤300)。
  - 显示时，未注明日期含义的中性显示为"来源日期"。
- 来源:`src/web/components/RecordEditor.vue`、`src/modules/movement-date.ts`、`tests/movement-date.test.ts`、`tests/movement-perspective.test.ts`、`tests/browser/exploration.spec.ts`

### 6.9 人才目录列表
- 入口:`/w/internal/talent`,侧边栏"机构"下方的"人才目录"。它与管理登录权限的"团队成员"是两回事。
- 内容:
  - 页头：标题"人才目录" + 副标题;"导入个人履历"(Import personal profile,非 reader);"刷新"(加载中禁用)。
  - 成功提示条(导入后出现)。
  - 疑似重复切换条：仅当存在疑似重复或正处于该筛选时显示，两个按钮是"全部人员"和"疑似重复档案 · N"。
  - 筛选行:
    - 搜索框(占位"搜索姓名、职位、机构或联系方式…")。
    - 机构下拉：全部机构 + 所有可见人员关联到的机构，按名称排序。
    - 联系方式:"全部"或"有联系方式"。
    - 排序:"最近更新"(默认)或"姓名"。
    - "重置筛选"链接。
  - 表格列:
    1. 姓名：首字头像、姓名，副行显示当前职位的第一个，否则显示职位的第一个，都没有则显示"职位未记录"。有疑似重复时另加链接"疑似重复档案 · N"。
    2. 关联机构：前 2 个链接到机构概览;更多时显示"+N more"按钮。
    3. 最近变动：类型徽标;说明行(转任显示"A → B",否则显示机构名);转任且有新职位时显示新职位;"日期含义:日期"。没有变动时显示"—"。
    4. 联系方式："N 种联系方式"按钮，或"未记录"。
    5. 更新时间。
  - 分页栏:"共 N 条匹配",上一页 / 页码 / 下一页。
- 交互:
  - 搜索输入防抖 250ms 后写入 URL;按 Enter 立即写入。
  - 下拉变化立即写入 URL。所有筛选改动都用 replace,并清空 `page` 和 `person`。
  - 分页写 `page`。上一页在第一页、下一页在最后一页、加载中时都禁用。
  - 点姓名、疑似重复链接、"+N more"、联系方式数量 → push `?person=<id>`,打开详情。
  - 重置筛选 → 清空全部 query。
- 状态：加载中用"正在加载…"替代表格;错误显示 alert;无结果时显示空态"没有匹配的人员",并说明"组织架构、联系人、人员变动里记录的人会出现在这里"。
- 规则(URL 与偏好):
  - URL 键:`q`、`organizationId`、`duplicates=review`、`contact=available`、`sort=updated|name`、`page`、`person`。
  - 记忆的筛选只有 `q`、`organizationId`、`duplicates`、`contact`、`sort`,不含 `page` 和 `person`。按用户存到 localStorage,键名 `omniboard.last-filters.<userId>.talent`。
  - 进入页面且 URL 没有任何 query 时恢复上次筛选;只要带了显式 query(哪怕只有 `person`)就以链接为准。
  - 存储不可用时静默降级。单个值超过 1000 字或不是字符串时丢弃。
- 规则(服务端查询):
  - 默认每页 30 条，最多 100。页码超出时回落到最后一页。
  - 搜索范围：姓名、别名、职位、机构名、联系方式值、变动的前后职位;不区分大小写，支持中文。
  - 排序:`updated` 按更新时间降序，再按姓名、id;`name` 按姓名、id。
  - 服务端另支持 `identity=all|linked|unlinked`,界面未暴露。
- 来源:`src/web/components/TalentDirectory.vue`、`src/server/talent.ts`、`src/modules/filter-preferences.ts`、`src/web/composables/useRememberedFilters.ts`、`tests/talent.test.ts`、`tests/filter-preferences.test.ts`、`docs/talent-directory.md`

### 6.10 人才条目的组成规则(读模型)
- 规则:
  - 每个 person 类型的身份，只要有可见来源记录或履历，就是一行，id 为 `identity:<objectId>`。
  - 没有关联身份、但带姓名的记录各成一行，id 为 `record:<recordId>`。同名不合并，同邮箱也不合并。
  - 纳入的记录：任意标签里有 `personName`,或已关联到 person 对象的记录。排除:
    - 非 admin 用户看到的 admin 记录或 admin 证据;
    - 已归并(退役)的记录别名;
    - 退役机构下的记录;
    - 没有姓名的机构公共邮箱或渠道。
  - 数量是记录数，不宣称是去重后的独立人数。
  - 关联机构 = 来源记录所在机构 ∪ 履历中已映射的机构。关联不代表仍在职。
  - 联系方式:
    - 来源:`personEmail` 当作 email;联系人标签的 channel/value。
    - 只保留能生成有效链接的:email 格式合法 → `mailto:`;phone 匹配 `^\+?[\d ()-]{5,40}$` → 去掉空格、括号和横线后生成 `tel:`;telegram、x、linkedin、website 必须是 https URL。
    - wechat 例外：没有链接也保留。
    - 按 channel + value 去重。
    - 个人履历来源另加一条 linkedin 或 website 联系方式，职位写"Personal profile"。
  - 职位 = 履历职位 ∪ 组织架构和联系人记录中的职位或标题。当前职位 = 履历中 `tenure=current` 的条目，格式为"职位 · 机构"。
  - 更新时间 = 来源记录和履历来源中最新的时间。
  - 最近变动：只取 joined、left、role_change 三类记录，先按 6.7 规则合并，再按 6.5 规则排序，取第一条，用 6.6 的人员级摘要显示。晚发的公告不能覆盖更晚的生效事件。
  - 统计值 `counts`:identities、unlinkedRecords、possibleDuplicates。
  - 只读：浏览不创建身份，也不写入任何身份决定。
- 规则(疑似重复):
  - 条件：另一个身份行的姓名规范化后相同(NFKC、小写、去掉空白和标点),且可见性相同。
  - 判为"不是同一人"的组合不再出现。
  - "稍后核对"的仍列出并标记，但不计入 `duplicateCount`,因此也不进"疑似重复"筛选。
- 规则(详情接口):`/talent/identity:<旧id>` 会解析到合并后的规范身份;`/talent/record:<id>` 返回包含该记录的那一行(即使记录已关联身份);找不到时 404"Person not found."。
- 来源:`src/server/talent.ts`、`tests/talent.test.ts`、`tests/wechat-contact.test.ts`、`tests/person-profiles.test.ts`

### 6.11 人员详情抽屉
- 入口:URL `?person=identity:<id>` 或 `?person=record:<id>`,可以直接深链;由列表点击、关系图姓名链接、人员变动"更新来源履历"等处进入。导入对话框打开时抽屉暂时隐藏。
- 内容(模态，自上而下):
  1. 眉题"人才目录"、姓名(加载前显示"人员详情")、关闭按钮。
  2. "目标与激励"(见 6.16),范围是该人所有组织架构记录对应的岗位。
  3. 职业经历(见 6.12)。
  4. 履历来源(见 6.12)。
  5. 疑似重复档案(见 6.15)。
  6. 别名：除本名外的别名，用" · "连接。
  7. "+ 添加履历来源"(非 reader)。
  8. "档案维护与合并历史"(默认折叠，仅身份行有):内容是跨机构身份组件(7.14)。
  9. "关联机构":链接到机构概览，附说明"关联包含历史记录，不代表当前在职"。
  10. "查看关系与证据"(Explore relationships)按钮：有身份或非 reader 时显示。
  11. "联系方式"(折叠，带数量):每条显示渠道名 · 机构;值(有链接时新标签打开);职位;"原始引用"。没有时显示"未记录联系方式"。
  12. "职位、变动与证据":每条来源记录一个折叠块。摘要显示机构名，再显示"原机构 → 新机构"(按该记录所属机构的视角)或记录标题;变动类记录另有类型徽标。展开后依次是：日期含义:日期;之前/之后职位;来源标题;正文;"原始引用";"打开来源记录"(→ `/w/internal/organizations/<org>/<tab>?record=<id>`)。
- 交互:
  - 关闭(X、遮罩、Esc)→ replace,去掉 `person`。
  - "查看关系与证据" → 跳到第一条来源记录所在机构(没有来源记录时取第一个关联机构)的 `/relationships`。有身份时带 `?object=<identityId>&knowledgeView=map`,否则带 `?sourceRecord=<recordId>&knowledgeView=map`。
  - "+ 添加履历来源" → 打开导入对话框，预绑定当前身份和姓名。
  - 档案有变更(合并、撤销等)后重新加载详情和列表。
- 状态：加载中显示"正在加载…",出错显示 alert。
- 来源:`src/web/components/TalentDirectory.vue`、`tests/browser/graph-navigation.spec.ts`、`tests/browser/position-drivers.spec.ts`

### 6.12 职业经历与履历来源
- 内容(职业经历，没有履历时整块隐藏):
  - 说明:"每个来源的日期和措辞都保留，兼任职位分开显示。"
  - 时间线条目:"开始 → 至今|结束"(按精度格式化);职位;机构(已映射时链接到机构概览);在职状态标签，三选一:"当前职位"/"过往职位"/"任职日期不完整";"来源说明"(可折叠);"LinkedIn · 查看证据"按钮(非 LinkedIn 时显示 provider 名)。
  - 排序：当前职位在前，然后按开始日期降序，最后按 id。
- 内容(履历来源，可折叠，带数量):
  - 每个来源：链接"LinkedIn ↗"(新标签)、URL、来源说明、"更新来源履历"(非 reader)。
  - "采集历史 · N"(可折叠):每次采集显示"观察日期 · 录入人",加"录入于 时间",以及"查看证据"和说明。按最新在前排列。
- 来源:`src/web/components/PersonCareer.vue`、`src/server/person-profiles.ts`、`docs/personnel-profiles.md`

### 6.13 导入 / 更新个人履历
- 入口：列表页"导入个人履历";详情里"+ 添加履历来源"(预绑定当前身份);履历来源里"更新来源履历"(进入更新模式)。
- 内容(对话框，标题"导入个人履历"或"更新来源履历"):
  - 说明:"一份个人主页对应一个人;录入来源所示的任职，并保留原文。"
  - 姓名(必填，≤160);个人主页 URL(必填;更新模式只读)。
  - "归入已有人员"(可折叠，仅新导入模式;预绑定身份时默认展开，已选时显示 ✓):
    - "查找匹配档案"按钮：按当前姓名搜 person 身份。
    - "人员档案"下拉：第一项是"如果是新主页则新建人员";预绑定的身份也在列表里;其余显示"姓名 · 机构列表"。
    - 选了档案后出现"判断依据"(必填)。
  - 观察日期(日期，必填，默认今天);访问范围("内部团队"或"仅管理员";后者只有 admin 能看到;更新模式禁用)。
  - "职业经历"说明:"保留仅年份和仅月份的日期，缺失留空;职位结束不一定是离开机构。"
  - 每条任职一个字段组(legend "Career entry {n}"):
    - 目录机构(下拉，第一项"仅保留来源名称";选中后自动把机构名填成目录名)。
    - 来源中的机构名(必填)、职位(必填)。
    - 在职状态:未说明 / 当前职位 / 过往职位。
    - 开始日期、结束日期(占位 `YYYY / YYYY-MM / YYYY-MM-DD`;当前职位时结束日期禁用)。
    - "人员流动事件"子区(默认展开):
      - "该职位的开始":仅职业经历 / 加入该机构 / 机构内转岗。
      - "确认的上一职位":第一项"无显式关联",其余为本表单中其他条目，显示"机构 · 职位 · 结束日期或未记录"。
      - 说明:"只有证据把两个职位连起来时才关联;离职和入职日期可以不同。"
      - 勾选框"来源确认已离开该机构":只有过往职位能勾。
      - 实时提示(role=status):既没选开始类型也没勾离职时显示"仅职业经历，不会出现在机构的人员变动标签";否则显示"变动事件也会出现在对应机构的标签"。
    - 来源说明(文本框)。
    - "移除条目":仅新导入模式且条目多于 1 条时显示。
  - "+ 添加任职条目";整体来源说明;"原始履历文本"(必填，占位"粘贴来源页面上可见的原文")。
- 交互:
  - 提交前先在前端校验(schema + 关联规则),只显示第一条错误。
  - 保存成功 → 关闭对话框，显示提示:无变化时为"该采集已记录，未产生重复",否则为"已保存，任职已归入同一人员";URL 切到 `?person=identity:<id>`;重新加载详情和列表。
  - 失败时在对话框内显示错误。保存按钮在保存中或没有任何条目时禁用。
- 规则(URL 规范化):
  - 只接受 https,且不能带用户名密码或端口。
  - LinkedIn(`linkedin.com` 及其任意子域):路径必须是 `/in/<slug>`,slug 解码后做 NFKC、转小写，只能含字母、数字、`_`、`-`。忽略地区子域、跟踪参数和子页面，统一成 `https://www.linkedin.com/in/<slug>/`。帖子、公司页、仿冒域名(如 `linkedin.com.example.test`)都不算 LinkedIn 人员键。
  - 其他站点：去掉 hash 和 `utm_*` 参数后整条 URL 作为键。
- 规则(字段校验):
  - 任职 1–100 条，key 唯一。
  - 日期为空、`YYYY`、`YYYY-MM` 或合法的 `YYYY-MM-DD`;结束不早于开始(按两者中较短的精度比较)。
  - 当前职位不能有结束日期，也不能勾离职;勾离职必须是过往职位。
  - 原文 1–200000 字。观察日期必须是合法日期，且不能晚于今天(422)。
- 规则(关联上一职位):
  - 所选条目必须存在且不是自己，否则报"请选择另一个已有的上一职位"。
  - 同一个上一职位只能被一次关联使用。
  - 两端都必须映射到目录机构，且上一职位为"过往"。
  - 语义必须一致:"加入"要求机构不同且上一职位已勾离职;"转岗"要求同一机构且未勾离职;"仅职业经历"不能关联。
  - 不能形成环。
  - 服务端按保存后的完整履历(包括本次没有提交的旧条目)再校验一次，违反则 422,整批不写。
- 规则(服务端写入):
  - reader → 403。editor 导入 admin 范围 → 403。
  - 来源已存在但访问范围不同 → 409"该来源无法以所请求的访问级别导入"。
  - 指定的身份必须是 person,且可见性相同，否则 422。
  - 来源已属于另一个人 → 409,提示先核对档案再合并。
  - 首次把来源归入指定身份时必须写理由(422)。
  - 新建人员时至少要有一条任职映射到机构(422)。
  - 已映射机构的条目在更新时不能取消映射(422)。
- 规则(去重与更新):
  - 同一来源键始终对应同一个人。原文和结构化内容完全相同(条目顺序、URL 变体都不算变化)→ 无操作，返回 `unchanged`,不新增采集。
  - 有变化时:
    - 保存一份不可变的原文快照，revision +1;
    - 更新请求必须带当前 revision,否则 409"该来源已变更，请重新加载";
    - 观察日期早于最近一次采集 → 409。
  - 任职条目按 key 稳定，改日期或职位不会新增经历。本次没提交的旧条目保留，不能据此推断离职。
- 规则(自动合并):已有记录明确指向同一个个人主页时，自动与其身份合并，合并记录可撤销。"指向"指 `profileUrl`、`linkedinUrl`、LinkedIn 渠道值，或同名且证据 URL 相同。只凭姓名、新闻 URL 或邮箱不合并。
- 来源:`src/web/components/PersonProfileImport.vue`、`src/modules/person-profile.ts`、`src/server/person-profiles.ts`、`tests/person-profiles.test.ts`、`tests/browser/career-links.spec.ts`、`docs/personnel-profiles.md`

### 6.14 由履历生成的人员变动
- 规则:
  - 只有已映射机构的条目才生成事件:
    - 开始类型选了"加入"或"转岗" → 在开始日期生成 joined 或 role_change;
    - 勾了离职 → 在结束日期生成 left;
    - 其他情况只作为履历，不生成事件。
  - 生成的记录固定为:
    - 标签 people_movements,范围"Personal profile",状态待审核;
    - `dateBasis=effective`,精度由日期推导，`dateLabel` 固定说明"日期来自个人主页，保留精度，未独立核实";
    - 标题"{姓名} · Joined/Departure/Role change · {职位}"。
  - 事件 id 稳定，重新导入时原地更新(同时出现在两个机构视图里)。已生成的事件在条件取消后，记录保留、类型清空(待核：界面上的表现)。
- 规则(跨条目衔接):
  - 显式关联按用户指定。
  - 自动衔接必须同时满足:
    - 双方都唯一;
    - 上一职位是过往、结束日期字符串与本条开始日期完全相同、已映射机构、职位非空，且没有被显式关联占用;
    - 转岗要求同机构、未离职;加入要求不同机构、已离职。
  - 同月出现兼任、日期精度不一致(如 2023 对 2023-06)、结束日期为空、去向是其他机构时，一律不猜。
  - 衔接成功时:
    - 两端事件共享 `movementGroupId`,都带前后机构和职位、`previousRoleEnd`、`nextRoleStart`;
    - `transitionBasis` 为 `explicit_profile_transition` 或 `adjacent_profile_roles`;
    - 部分更新时，前一职位的名称同步刷新到两端事件。
  - 转岗不会推断出离职。
- 来源:`src/server/person-profiles.ts`、`tests/person-profiles.test.ts`(后 6 个 test)、`tests/browser/career-links.spec.ts`

### 6.15 疑似重复档案处理
- 入口：详情抽屉"疑似重复档案 · N"(可折叠);列表的"疑似重复档案"筛选。
- 内容：说明"这些档案同名，请比对职位和来源再决定"。每个候选显示姓名、机构列表、职位列表(优先当前职位)、来源 URL(新标签)、"打开档案"链接;已"稍后核对"的标注出来。底部是"为何是同一人"文本框(非 reader)。
- 交互(非 reader):
  - "不是同一人"/"稍后核对":提交决定。理由为空时使用默认理由("已核对确认不是同一人"/"等待更多来源证据")。
  - "合并到当前档案":文本框非空才可点;把对方身份合并进当前身份，需带双方 revision。
  - "打开档案" → 把 `person` 切到 `identity:<对方id>`。
  - 任一操作成功后刷新;失败时在区块内显示错误。
- 规则：两个都必须是 person、不是同一个、可见性相同，否则 422。决定按无序对存储，可覆盖。每次决定都记录理由、原始证据和操作人。
- 来源:`src/web/components/PersonCareer.vue`、`src/server/person-profiles.ts`、`tests/person-profiles.test.ts`(matching names 那条)

### 6.16 岗位目标与激励(OKR / KPI / 激励)
- 入口：组织架构人员侧栏(对应单个岗位);人才库详情抽屉(对应该人所有组织架构岗位)。没有岗位时整块不显示。
- 内容:
  - 标题"目标与激励" + "+ 添加情报"(非 reader,编辑中隐藏)。说明:"绑定此人当前岗位，不会沿用到另一雇主。"
  - 每张情报卡:
    - 类型(OKR/KPI/Incentive)。
    - 复核状态：已停用为"Retired";复核日期早于今天为"Review due";否则为"Reported"。
    - 标题;"姓名 · 职位 · 机构"。
    - 适用范围:"个人目标/动机"/"岗位规则 · 个人适用未确认"/"适用范围未知"。
    - 摘要。
    - 压力为"未报告"时显示"未报告 KPI 压力"。
    - 数值目标:适用人群;金额(按比较方式加前缀:`+`、`≥ `、`≤ `,等于不加前缀;数字按当前语言格式化);"指标 · 单位"(单位为空时写"未注明单位");比较基准。
    - "目标周期";不确定事项。
    - "来源与有效期"(可折叠):来源类型 · 提供者;"获知日期:X · 复核截止:Y"(没有时写"未设到期");说明"转述不等于独立核实";操作按钮"查看证据"、"原始附件"(有附件时)、"编辑 · vN"(非 reader)。
- 交互(表单，内联在区块内;新增和编辑共用):
  - 字段:
    - "关联岗位"(编辑时禁用)。
    - 类型、适用范围(默认未知)、标题(必填 ≤160)、摘要(必填 ≤4000)。
    - KPI 压力：未知 / 未报告 KPI 压力 / 已报告目标。
    - 目标周期(≤100)。
    - 数值目标 0–10 个，每个包含:适用人群(必填 ≤300)、指标(必填 ≤200)、比较方式(增加 / ≥ / ≤ / =)、目标值(≥0 的数字)、单位(≤60,占位"未知请留空")、比较基准(≤300)、"移除目标"。
    - 来源类型：联系人转述 / 团队转述 / 来源文档 / 公开来源，默认团队转述。
    - 提供者/来源(必填 ≤300)。
    - 获知日期(必填，默认今天)、复核日期(不早于获知日期)。
    - 不确定事项(≤4000)、原始证据(必填 ≤100000)、来源 URL(选填，仅 http(s))、原始附件(≤5MB)、状态(有效/停用)。
  - 编辑时回填原始证据文本和来源 URL;附件不回填，不重新上传就保留原附件。
  - 保存 → 关闭表单并重新加载;取消 → 关闭表单。
- 状态：加载中显示"正在加载…";没有数据时显示"尚未记录目标或激励信息";错误显示 alert;附件超过 5MB 提示"附件须在 1 字节到 5 MB 之间"。
- 规则:
  - 复核日期不能早于获知日期。压力为"未报告"时不能有数值目标(422)。
  - 更新必须带当前 revision,否则 409。每次写入保存独立的原始证据和编辑历史。
  - 情报按岗位记录绑定：同一人在另一家机构的岗位看不到。
  - 权限：同时检查机构、岗位、证据和情报本身的可见性。reader 只读(写入 403);岗位属于其他机构时 404;admin 情报不会因为岗位后来放宽而对外开放。
  - 不根据数值目标生成完成率。
- 来源:`src/web/components/PositionDrivers.vue`、`src/modules/position-drivers.ts`、`tests/position-drivers.test.ts`、`tests/browser/position-drivers.spec.ts`、`docs/position-drivers.md`

## 7 关系与证据

### 7.1 关系与证据页(宿主)
- 入口:机构的"关系"标签 `/w/internal/organizations/:orgId/relationships`。URL 参数:
  - `object`:选中节点 id。
  - `knowledgeView=map|evidence|sources`:模式，默认 map。
  - `sourceRecord=<recordId>`:从记录进入。
- 内容:
  - 页头"关系与证据",按钮："查找对象/隐藏对象浏览器"、"刷新"、"新增共享对象"(非 reader)。
  - 对象浏览器(左侧，默认收起)。
  - 主区依次为：选中对象的标题区(图谱模式下选中的是本机构根节点时隐藏);跨机构身份组件(选中共享对象时);汇总条(非图谱模式时);视图条;模式内容;关联任务。
- 交互:
  - 选中对象和模式变化时，用 replace 同步到 URL 的 `object` 和 `knowledgeView`。URL 变化(包括浏览器前进后退)也会反向更新选中和模式。
  - 选中新节点时清除已选关系，来源列表的分页重置为 8。
- 交互(`sourceRecord` 进入):该记录已属于某共享对象时直接选中它;否则自动打开"新增共享对象"对话框并预填。只处理一次。
- 规则(选中解析):加载时用 `identityAliases` 把旧对象 id 映射到合并后的 id,所以旧链接合并后仍然有效。id 无效时回到本机构根节点。
- 状态：加载中显示"正在加载关系…";错误显示 alert 加"重试"。
- 来源:`src/web/components/KnowledgePanel.vue`、`tests/browser/identities.spec.ts`、`tests/browser/graph-navigation.spec.ts`

### 7.2 对象浏览器
- 内容:
  - 搜索框("名称、类型或范围"),匹配名称、范围、来源记录标题、类型名。
  - 类型下拉：全部 / 人员 / 账户 / 服务商能力 / 我方资源与审批 / 机构 / 来源记录。
  - 结果数"N 个结果"。
  - 结果列表每项：类型(admin 数据带锁图标)、名称、出处("来自已有记录"/"共享对象"/"机构上下文")、来源标签页 · 记录标题。当前选中的高亮。
  - 底部说明:"同名记录在团队关联到同一对象之前保持独立。"
- 交互：点击结果 → 选中该节点。
- 来源:`src/web/components/KnowledgePanel.vue`

### 7.3 选中对象标题区与视图条
- 内容:
  - 标题区:
    - 类型眉题;名称(可跳转时为链接，见 7.7)。
    - 副标题：机构节点显示"机构上下文";关联多于 1 家机构的共享对象显示"已在 N 家机构共享";其余显示范围。
    - 操作(非 reader):共享对象有"连接对象"和"添加证据";来源记录节点有"整理为共享对象"。
  - 来源记录节点另有提示:"来自已有来源记录，身份、权限和结论均未自动核实。"
  - 汇总条(非图谱模式):来源记录数、共享对象数、已记录关系数，以及冲突数按钮。冲突数按钮点击后回到根节点并进入证据对照;没有结构化陈述时显示"—/未评估"。
  - 视图条:
    - "打开机构":选中的是另一家机构时显示，跳到那家机构的关系页。
    - 模式切换:"关系图谱"|"证据对照"(有冲突时带数量)|"来源记录"(带数量)。
    - "包含历史"勾选框。
- 规则：证据对照模式见 7.12、7.13。
- 来源:`src/web/components/KnowledgePanel.vue`、`src/modules/exploration.ts`(claimGroups)、`tests/exploration.test.ts`

### 7.4 关系图谱数据模型
- 规则(节点):
  - 本机构根节点 `organization:<id>`。
  - 共享对象(人员、账户、能力、资源)。
  - 共享对象关联到的其他机构节点。
  - 本机构中没有被共享对象承接的记录，作为来源节点 `record:<id>`:有 personName 的归人员类，onboarding 标签的归资源类，其余归来源记录类。
  - 被共享对象承接的记录不再单独生成节点。
  - 同名的来源节点保持两个节点，不合并。
- 规则(边):
  - 上下文边(context):从所属机构指向每个非机构节点。共享对象的所属机构是它关联的全部机构;来源节点的所属机构是记录所在机构。这种边只表示"资料属于该机构",不代表雇佣或授权。
  - 业务关系边(relationship):来自已录入的关系。
  - 汇报边(reporting,标签"Reports to"):由组织架构的 reportsTo 生成，确定性取记录的 relationshipKind,证据取 relationshipRawId。只有当下属和上级各自唯一映射到不同节点时才生成;一条记录被多个对象引用时不猜。
  - 每条边有 `current` 属性(当前日期是否在有效期内);不勾"包含历史"时隐藏非当前的边。
- 规则(数据范围):服务端返回本机构的可见记录，加上共享对象关联的其他机构记录;按权限过滤;浏览不写入任何数据。
- 来源:`src/modules/exploration.ts`、`src/server/operations/exploration.ts`、`tests/exploration.test.ts`(第二个 test)、`tests/identities.test.ts`

### 7.5 关系图谱视图(画布)
- 入口：关系页"关系图谱"模式(默认)。
- 内容(自上而下):
  1. 按类型展开条:"按对象类型展开",类型包括人员与职位、关联机构、账户、服务商能力、资源与审批，各带数量，数量为 0 的不显示;若有被折叠的来源节点，另有勾选框"展开来源节点 N"。
  2. 工具条:
     - "探索深度":直接连接 / 两层连接。
     - "N 个可见节点"。
     - 缩放组(有节点时显示):−;百分比按钮(aria "Reset zoom");+;"适应画布";"扩大画布/收起画布"。
  3. 图例：实线=已确认关系，虚线=未确认关系，点线=仅资料关联。选中的是机构时，另有勾选框"显示资料关联线"(勾了"展开来源节点"时强制勾上并禁用)。
  4. 画布。
  5. 提示区。
  6. "仅有资料关联的 N 个对象"(可折叠列表)。
  7. 固定提示:"点名称看档案，点卡片探索连接，点连线读证据。"
  8. 超量提示:"已显示 X / Y 个相连节点" + "显示更多关系"。
  9. 关系详情(选中连线时)。
  10. "画布上的 N 条关系"(可折叠列表)。
- 交互:
  - 选中节点变化时重置视图(返回时恢复原节点则不重置):显示上限回到 24,关闭"展开来源节点"和"资料关联线"。类型集合：选中的是机构且有人员时，只开人员和机构;否则全部类型都开。
  - 类型按钮切换该类型的显示(aria-pressed),显示上限重置为 24。
  - 缩放:± 步长 15%,范围 25%–180%,保持视口中心;百分比按钮回到 100%。
  - 适应画布:缩放 = min(1, 可用宽/图宽, 可用高/图高),下限 25%,滚到左上。每次布局完成后自动适应一次，但下限提到 85%,保证名字可读。
  - 扩大/收起画布：切换后按可读下限(85%)重新适应。
  - 悬停或聚焦节点：只高亮该节点及其直接相连的边和邻居，其余变暗(不做传递高亮)。悬停或聚焦连线：只高亮这条线和两个端点。
  - 默认不铺满关系标签：只在当前关注的连线上显示一个标签，位置在该线最长线段的中点;点标签等同于点线。
  - 点击连线，或键盘聚焦连线后按 Enter/Space → 选中该关系，下方出现关系详情。连线有无障碍名"起点 → 终点 · 标签"。上下文边(点线)不能点，也没有箭头。
  - 点节点卡片空白处 → 以它为新中心探索(触发选中)。
  - 点节点上的名称链接 → 打开档案(见 7.7)。它是真实的 `<a>`,Ctrl/Cmd+点击会在新标签打开，原页面 URL 不变。
  - 点节点上的"N 个来源"徽标 → 选中该节点，并切到"来源记录"模式。
  - "显示更多关系" → 显示上限 +24。
  - 关系列表每项显示"起点 → 终点 + 标签"、确定性、"超出有效期"标记;点击选中该关系，悬停或聚焦时在画布上高亮。
  - 资料关联列表每项有类型图标、名称(可跳转时为链接)、来源上下文;点击以它为中心探索。
- 内容(节点卡片):类型图标和类型名(admin 数据带锁)、名称、上下文描述、来源数徽标。上下文描述三选一:"{来源标签} · {记录标题}"/"共享对象"/"机构上下文"。选中的卡片加重，来源节点用派生样式。
- 状态:
  - 布局中显示"正在排布关系…"。
  - 布局失败显示"无法排布图谱，数据未变",加"重试"。
  - 画布没有节点:若有资料关联对象，提示"此视图没有记录业务关系，请查看下方关联对象"(列表自动展开);否则提示"没有符合筛选的连接，请展开其他类型或包含历史"。
  - 画布只有 1 个节点时也提示后者。
- 规则(选择与折叠):
  - 从选中节点做广度遍历，到"探索深度"为止。经过的机构节点(起点除外)不再向外扩展，避免把全机构人员都算成邻居。
  - 排序依次按：距离、业务边度数(降序)、名称、id;截取前 N 个(默认 24,至少 1)。只保留两端都可见的边。
  - "被折叠的来源节点"指非人员的来源记录节点，同时满足：不是任何业务边的端点、不是当前选中。它们只在勾了"展开来源节点"时参与。
  - 其余节点按类型开关过滤;来源记录类节点始终参与。
  - 类型计数来自当前探索范围，不受该类型是否展开的影响。
- 规则(画布与资料关联分区):选中的是机构、且没勾资料关联线或来源节点时，画布只放至少有一条业务边(非 context)的节点，只画业务边;其余节点(根节点除外)进入"仅有资料关联"列表，列表附说明"这不代表汇报、雇佣或业务关系"。选中的不是机构时，画布放全部节点和边。
- 规则(连线样式):
  - 业务或汇报关系:confirmed 实线，unconfirmed 虚线，带方向箭头。
  - 上下文边：浅色点线，无箭头。
  - 超出有效期的边用历史样式。
- 来源:`src/web/components/RelationshipGraph.vue`、`src/modules/relationship-view.ts`、`tests/relationship-view.test.ts`、`tests/browser/exploration.spec.ts`、`tests/browser/graph-navigation.spec.ts`、`docs/relationship-exploration.md`

### 7.6 图谱布局规则
- 规则:
  - 分层布局，从左到右;连线正交布线;减少交叉(层扫描);按输入顺序稳定;随机种子固定为 1,所以同样输入得到同样结果。
  - 卡片 210×94,不重叠。间距：节点 20,层间 105,边与节点 22,边与边 16;四周内边距 32。
  - 同一对节点之间的多条边分别布线(路径互不相同);自环要能正常输出;方向保持原始 from → to。画布最小 320×260。
  - 只有两端都在画布上的边参与布局。
  - 布局引擎按需懒加载。异步布局只采用最新一次请求的结果;组件卸载后丢弃。
  - 不支持拖动节点、手动固定位置、保存布局或路径搜索;密集图不保证没有交叉。
- 来源:`src/modules/relationship-layout.ts`、`tests/relationship-view.test.ts`(最后一个 test)、`docs/relationship-exploration.md`

### 7.7 从图谱跳到档案
- 规则(名称链接目标):
  - 机构节点(`organization:<id>`)→ `/w/internal/organizations/<id>/overview`;id 为空时不生成链接。
  - 人员共享对象 → `/w/internal/talent?person=identity:<对象id>`。
  - 单条记录的人员来源节点 → `/w/internal/talent?person=record:<recordId>`。
  - 其他情况(账户、能力、资源、来源记录，或含多条记录的非对象人员节点)不生成链接。
  - 链接一律用稳定 id,显示名相同不作为身份依据。
- 来源:`src/modules/exploration-navigation.ts`、`tests/exploration-navigation.test.ts`、`tests/browser/graph-navigation.spec.ts`

### 7.8 视图状态记忆与返回
- 规则:
  - 以"用户 + 路径 + 机构 + 选中节点"为键，在会话内存里保存以下状态：浏览器搜索词和类型、浏览器开关、包含历史、来源分页、选中关系、页面滚动 Y;图谱状态(深度、上限、缩放、类型、来源节点和资料关联开关、扩大画布、两个列表的展开状态、画布滚动位置)。
  - 最多保存 40 条，超出时淘汰最旧的;用户变化(登出、换人)时清空;不缓存任何证据或档案数据。
  - 离开该路径时保存，回来时恢复。页面滚动要等异步布局完成后再恢复。
  - 切换图谱、证据、来源模式时，画布缩放保持不变。
- 交互(验收):从图谱点名称进入人才库，再按浏览器后退，必须恢复这些状态：深度、包含历史、选中节点、缩放百分比、已选关系的详情、画布的横纵滚动位置、页面滚动位置。
- 来源:`src/web/composables/useExplorationView.ts`、`tests/browser/graph-navigation.spec.ts`

### 7.9 关系详情与来源记录模式
- 内容(关系详情，role=region "Relationship details"):
  - "起点 → 终点"、关闭按钮。
  - 标签 · 确定性(已确认/未确认)。
  - "生效起:X · 生效止:Y"(没有时写"未记录");超出有效期时加提示。
  - "阅读关系证据"(有证据时显示)。
  - 所选关系在当前视图中不再可见时自动取消选中。
- 内容(来源记录模式;证据对照模式下也显示在下方):
  - 列出选中节点的来源记录;选中机构根节点时列出该机构全部记录。每次显示 8 条,"显示更多来源记录"再加 8 条。
  - 每条可折叠：摘要显示"机构 · 标签 · 来源名"、标题、审核状态;展开后依次是正文、最多 6 个结构化字段(不含核验和元数据类字段)、"范围 · 作者 · 时间"。
  - 操作:"原始来源";"打开来源记录"(→ 该记录所在机构的对应标签，带 `?record=`);"创建跟进任务"(非 reader,→ `/w/internal/work?organizationId=&sourceRecord=`,打开的任务对话框预填标题"Follow up: {记录标题}"和来源记录)。
  - 空态:"没有与该对象关联的来源记录"。
  - 下方"与该证据相关的工作":列出关联到该对象或其记录的任务，显示任务文案和状态，链接到任务。
- 来源:`src/web/components/KnowledgePanel.vue`、`tests/browser/exploration.spec.ts`(第二个 test)

### 7.10 共享对象：新增 / 整理 / 连接
- 入口:"新增共享对象";来源节点上的"整理为共享对象";`?sourceRecord=` 深链;共享对象上的"连接对象"。
- 内容(新增共享对象):
  - 对象类型：人员 / 账户 / 服务商能力 / 我方资源与审批，默认能力。
  - 名称(必填 ≤160)、范围(必填，占位"产品、法人、账户或角色")。
  - 访问范围("仅管理员"只有 admin 能看到)。
  - 已有来源记录(必填):本机构中可见性相容的记录——admin 对象可以选所有记录，team 对象只能选 team 记录。
  - 说明:"同一个人、账户或能力跨标签只用一个对象，创建后再关联其他记录。"
- 规则(整理来源节点时的预填):名称取 personName 或标题(截断到 160);类型:有姓名为人员，onboarding 为资源，否则为能力;访问范围和范围沿用记录。
- 规则(服务端):
  - reader → 403。
  - 人员类型：如果记录已有人员档案，就复用它(返回同一个 id,201),重复请求也不新建;复用的档案如果是还没动过的自动档案，就用新名称和范围改名;可见性不一致 → 422。
  - 建好后，该记录不再以来源节点出现，原有汇报边改挂到对象上。
- 内容(连接对象):
  - "从"(当前对象，只读);"到"(同可见性、非自己的共享对象，显示"名称 · 类型");关系标签(必填，占位"reports to / manages / grants access to")。
  - 确定性:"转述 · 需确认"(默认)或"已由引用证据确认"。
  - 生效起止日期(选填)。
  - 引用:已有来源记录，或"使用下方原文";原文在没选记录时必填;来源 URL。
- 规则：这里不做语义匹配，也不自动推断关系。
- 来源:`src/web/components/KnowledgePanel.vue`、`src/server/operations/knowledge.ts`、`tests/exploration.test.ts`

- 补充规则(服务端):
  - 新增共享对象:必须选择来源记录,不根据同名自动合并;team 对象不能引用 admin 记录(422)。
    写入活动日志 "Object added · {name}"。保存后自动选中新对象。
  - 连接对象:两端必须是不同对象且可见性相同(422);引用证据必须来自其中一端所关联的机构。
    图中实线表示已确认,虚线表示待确认。写入活动日志 "A → B"。
- 来源(补充):`src/server/operations/shared.ts`、`tests/operations.test.ts`

### 7.11 记录结论（Add evidence / claim）
- 入口：选中共享对象后点 "Add evidence"，对话框 "Record a sourced fact"。
- 内容：
  - Fact type 预设：API permission / Regional eligibility / Subscription interval / Trading fee / Borrow rate / Hosting region / Account approval / Custom field。选 Custom field 时出现 Field 输入框（≤100）。
  - Value（必填，≤2000）。
  - Exact scope（必填，默认为对象 scope）。
  - Observed on / Valid from / Valid until（日期均可选），提示 "Leave unknown dates empty. The recording time is saved separately."。
  - 引用：
    - "Existing reference" 下拉：可选已有记录，或 "Use original text below"。
    - "Original information"：没选已有记录时必填，占位 "…Do not replace it with an unsupported summary."。
    - Source URL。
- 规则：
  - 结束日期不能早于开始日期（422）。observedOn 不能在未来（422）。日期必须合法。
  - 必须提供原文或选已有记录（422 "Add the original information or select an existing source record."）。
  - 结论必须属于对象已关联的机构（422 "Link this identity to the organization before adding its evidence."）。
  - 新结论的状态为 `reported`（界面显示 "Awaiting review"），revision=1。
  - 写入活动日志 "Evidence added · {对象} · {字段}"。
- 来源：`KnowledgePanel.vue`，`src/server/operations/knowledge.ts`，`tests/operations.test.ts`

### 7.12 比较证据（evidence 模式）与冲突判定
- 内容：
  - 按「对象 + 机构 + 字段 + scope」分组，每组是一个可展开的问题；冲突组排在前面，其余按字段名排序。冲突组默认展开。
  - 组头：字段、对象名 · 机构名 · scope；右侧显示 "Conflicting sources" 或 "{n} source statements"。
  - 冲突组内提示："These sources disagree within the same scope. Compare their dates and originals before choosing a conclusion."。
  - 每条结论为一张卡片：
    - 状态标签：
      - superseded → "Previous interpretation"
      - 有冲突 → "Conflicting sources"
      - accepted → "Adopted by team"
      - 其余 → "Awaiting review"
    - `v{revision}`、值。
    - Source：来源类型和 URL。
    - Observed：观察日期，没有时显示 "Not recorded"。
    - Validity：
      - 过期 → "Expired"
      - 未生效 → "Not yet effective"
      - 都没填 → "Validity not recorded"
      - 其余 → "Within recorded dates"
      - 下方附起止日期。
    - Recorded：录入时间。
    - 操作：
      - "Read original reference"。
      - "Review & adopt"：仅对当前有效、非 reader、且（未采纳或有冲突）的结论显示。
      - "Create follow-up task"：结论来自某条记录且非 reader 时显示。
    - "Decision trail" 折叠区：列出历次采纳的 作者 · 时间 · 理由。
  - 下方同时列出 5.7 的来源记录。
- 状态：没有结论时显示 "No structured conclusions yet. Source records remain available below."。
- 规则：
  - 「当前有效」= 状态不是 superseded，且 今天 ∈ [validFrom, validUntil]（任一端为空视为不限）。
  - **冲突** = 同对象、同机构上下文、同字段、同 scope 的两条当前有效结论值不同。
    - 字段、scope、值都是精确字符串比较，区分大小写，不做语义等价。
    - 值相同的重复结论不算冲突，但只要组内有异值，组内所有当前结论都标为冲突。
    - 过期结论不参与冲突判定。
  - 默认隐藏 superseded 结论，勾选 "Include history" 后显示。
- 来源：`src/web/components/EvidenceReview.vue`，`src/modules/claim-conflicts.ts`，`src/modules/exploration.ts`（claimGroups），`src/modules/operations.ts`（dateIsCurrent），`tests/claim-conflicts.test.ts`

### 7.13 采纳结论（Review & adopt）
- 入口：结论卡片上的 "Review & adopt"，对话框 "Review the current interpretation"。
- 内容：
  - 字段 · scope；值（引用样式）。
  - 说明："Adopt this value for its current scope. Other currently valid claims for this same field and scope will remain in history as previous interpretations."。
  - "Read original reference"。
  - "Reason for this decision"（必填）。
  - 提交按钮 "Adopt with decision record"。
- 规则：
  - 必须带当时的 revision，不一致时返回 409 "This evidence changed. Reload before reviewing."。
  - 过期、未生效或已被替代的结论不能采纳（422 "Only a currently valid claim can be adopted. Add updated evidence first."）。
  - 采纳后，同对象、同字段、同 scope、同机构的其他当前结论变为 superseded，本条变为 accepted，两边 revision 都 +1。原文和历史都保留。
  - 写入活动日志 "Evidence reviewed · {对象} · {字段}"，载荷含理由和被替代的 ID。
  - 过期提醒不会自动撤销历史，也不会修改生产资源。
- 来源：`KnowledgePanel.vue`，`src/server/operations/knowledge.ts`，`tests/operations.test.ts`，`tests/browser/exploration.spec.ts`，`docs/internal-operations.md`

### 7.14 跨机构身份(身份关联组件)
- 入口：关系页选中共享对象时显示;人才库详情里的"档案维护与合并历史"。
- 内容:
  - 标题"跨机构身份",说明"一个身份;各机构的职位、证据和权限保持独立"。按钮"跨机构关联"(非 reader)。
  - 机构链接列表：每家关联机构一个链接，指向那家机构关系页的 `?object=<id>&knowledgeView=map`,跳转后仍选中同一身份。
  - "已关联记录 · N"(可折叠):每条显示机构名、"标签 · 标题"、"原始来源";记录多于 1 条时有"取消关联"(非 reader)。
  - "身份决定 · N"(可折叠，有记录时显示):每条显示类型(记录已关联 / 记录已取消关联 / 身份已合并 / 合并已撤销)+ 对方名或记录标题、理由、"作者 · 时间"、"决定引用";可撤销时有"撤销身份合并"(非 reader)。
- 交互(关联对话框):
  - 打开时搜索词预填为对象名并自动搜索;也可以改词再"搜索"。搜索中显示"正在搜索身份…"。
  - 候选是单选列表:
    - 共享身份：同类型、同可见性、非自身，显示"名称 · 共享身份 · 机构列表 · 范围";
    - 未关联记录：没有被任何对象引用、不在本对象里;team 对象只列 team 记录。显示"姓名或标题 · 机构 · 标签 · 标题"。
  - 选中后出现"核对原始引用":列出候选的每条记录，可打开原始来源。选的是身份时附说明"合并仅用于统一显示，原记录和机构内结论不变，可撤销"。
  - 无候选时提示"没有匹配的身份或未关联记录"。
  - "身份判断理由"必填(≤4000,占位"例如：同一官方主页明确列出两个职位")。"确认共享身份"要选了候选且理由非空才可用。
  - 提交:选的是身份时，把当前对象合并进所选身份(所选身份保留);选的是记录时，把记录关联到当前对象。成功后关闭对话框，选中结果身份并重新加载。
- 交互(撤销合并 / 取消关联对话框):说明"原记录和证据保留，请为团队写明更正原因",理由必填，按钮与标题同名。
- 规则:
  - 所有写操作都要带当前 revision(过期 → 409),并记录理由(缺失 → 422)、操作人、时间和独立的决定证据。
  - 只有同类型、同可见性的身份才能合并(editor 对 admin 身份操作 → 404;admin 合并不同可见性的身份 → 422);admin 记录不能关联到 team 身份。
  - 其他工作区、退役记录和退役机构都不会成为候选(关联 → 404)。
  - 对象的最后一条记录不能取消关联(422)。取消关联不删除记录，之后可以重新关联。
  - 撤销：链式合并必须先撤销后发生的那次;重复撤销 → 409。撤销后恢复原来的身份归属，任务引用也还原。
  - 合并后:旧对象 id 仍可访问(解析到合并后的身份);原名保留为可搜索别名;任务引用指向合并后的身份;各机构的结论冲突仍按"身份 + 机构 + 字段 + 范围"分别判断;原始记录不变。
- 来源:`src/web/components/IdentityConnections.vue`、`tests/identities.test.ts`、`tests/browser/identities.spec.ts`、`docs/shared-identities.md`

## 8 情报与活动

### 8.1 收件箱页面
- 入口：
  - 路由 `/w/internal/intelligence?organizationId=&record=`。
  - 旧链接 `/w/internal/work?section=intelligence` 重定向到这里，其余 query 保留。
  - 任务详情中的 "Open source information" 会带上 organizationId 和 record 跳到这里。
- 内容：
  - 页头：标题 "Intelligence inbox" 和说明 "Read updates, review evidence and decide what needs action."；机构下拉，含 All organizations 选项，修改时 replace `?organizationId`；选定机构时显示 "Follow organization" / "Following organization" 切换。
  - **"Evidence to review"**：可折叠，默认展开，带计数。
    - 内容为当前范围内的结论提醒：有冲突，或 validUntil ≤ 今天+30 天。
    - 每条显示 "{对象} · {字段}"，以及原因之一："Conflicting values need review" / "Evidence validity ended · {日期}" / "Expires soon · {日期}"。已被替代的结论不提醒。
    - 提示："Conflicts and validity checks remain here until the evidence is resolved. Reading does not resolve them."。
    - 点击跳到 `relationships?object=<对象>`。
  - 范围说明文字（按条件三选一）：
    - 选了机构："Information recorded for this organization."
    - 范围为 all："The latest recorded information across all organizations you can access."
    - 否则："Based on organizations you follow and your assigned or unassigned team work."
  - 筛选：
    - Relevance：related（默认）/ all；选了机构时禁用。
    - Show：Unread revisions（默认）/ All information。
    - Review queue：All / Needs review / Review overdue。**改变 Review queue 会自动把 Show 设为 All**。
    - 总数 "{n} records"；"Refresh"。
  - 条目，按更新时间倒序：
    - 第一行："机构 · tab 名"，未读时附 "New to you"。
    - 标题：可读化后的标题。Org Chart / People Movements 的标题中不含人名时，前面加 "人名 · "。
    - 摘要：正文前 260 字并加 "…"；没有正文时用 scope；再没有时显示 "Open the recorded information and its original source."。
    - 评审状态徽章；"Updated · v{n}"（revision>1 时）或 "Recorded"，后跟时间。
    - 相关性原因（用 " · " 连接）："You have work at this organization" 或 "Open team work at this organization"，以及 "You follow this organization"。
  - 分页：每批 30 条，"Load more" 追加，按 ID 去重。
  - 页脚："Read status is personal and applies to this revision. Reading does not confirm or verify a claim."。
- 交互：
  - 自动刷新：每 30 秒一次，条件是页面可见、没有打开详情、没有保存进行中。页面级的提醒数据在窗口重新获得焦点时也会刷新。
  - `?record=<id>`：直接打开该条详情。
- 状态：
  - 首次加载："Loading intelligence…"。
  - 空态：Show 为 unread 时标题为 "You are caught up in this scope"，否则为 "No information in this scope"。说明 "Follow an organization or broaden the scope…"，并按情况给出一个按钮：
    - Relevance 为 related 且没选机构："Explore all organizations"（切到 all）。
    - 否则若 Show 为 unread："Include read information"（切到 all）。
  - 错误：显示错误 + "Retry"。
- 规则：
  - 覆盖范围：只包含各记录（module_records）的**最新版本**，不列出历史版本，也不包含排名快照、profile claims 和独立结论。
  - 权限：当前用户看不到的记录、证据、别名记录或别名机构都不出现。
  - related 范围 = 我关注的机构 ∪ 有「我负责或未分配、未完成、我可见」任务的机构。
  - Needs review = 记录状态为 unverified。Review overdue = expiresOn 非空且早于今天。
  - 未读 = 我的已读 revision 小于记录当前 revision。记录出新 revision 后重新变为未读。
- 来源：`src/web/components/IntelligencePage.vue`，`src/web/components/IntelligenceInbox.vue`，`src/server/intelligence.ts`，`src/server/operations/work.ts`（alerts），`src/web/main.ts`，`docs/internal-operations.md`（Focus 与情报收件箱），`tests/operations.test.ts`，`tests/browser/workflow.json`

### 8.2 情报详情（检查器）
- 入口：点击收件箱条目。打开时，把当前列表的顺序快照作为本次浏览队列；"已处理数" 清零。
- 内容：
  - 对话框标题为机构名，眉标 "INTELLIGENCE"。
  - 导航："← Previous" / "{i} of {n}" / "Next →"。
  - 基本信息："tab · Recorded {时间}"；标题；证据等级徽章（有 evidenceLevel 时）；评审状态徽章；已读时显示 "Read by you"。
  - 相关性原因；正文（可读化，保留换行）；"Scope: …"。
  - **"What changed"**：与上一个历史版本比较 title / body / scope / status 和每个结构化字段，逐项以删除线显示旧值、加粗显示新值。
    - revision>1 但没有变化时："No text or structured-field change in the available comparison. Check the source and full history for other changes."。
    - 没有上一版本时："An earlier revision is not available for comparison."。
  - 来源块：来源名、"Captured {时间}"、"Inspect evidence"。
  - "All recorded fields"：可折叠，列出全部结构化字段，用展示标签显示。
  - **"Connected work"**：
    - 列出直接关联的任务：任务的来源记录就是该条，或任务关联到该条所属的对象。每项附 "Linked through this reference or a shared object · {状态}"。
    - 没有时显示 "No task is directly linked to this information yet."。
    - 非 reader 可点 "Create evidence-backed follow-up"：跳到 Work 并带 organizationId 和 sourceRecord。
  - "Other work at {机构} · {n}"：可折叠，列出同机构的其他任务，标注 "Relevance to this information has not been established."。
  - "Related objects"：列出包含该记录的共享对象，链到 `relationships?object=`。
  - "Contacts at this organization"：可折叠，最近更新的最多 5 个联系人，说明 "Contact relevance to this topic is not confirmed."，链到 contacts `?record=`。
  - "Open full record & review options"：跳到 `/organizations/<org>/<tab>?record=<id>`。
- 交互：
  - **打开详情不会自动标为已读。**
  - "Mark read" / "Mark unread"：成功后刷新列表，反馈 "Marked read. Evidence status is unchanged." 或 "Marked unread."。
  - 主按钮 "Mark read & next"：标为已读后打开队列中的下一条。队列末尾时按钮文字为 "Mark read & finish"：标为已读后关闭详情，列表上方显示 "You reached the end of this batch. {n} records marked read."（n = 本批从未读变为已读的数量）。
  - 保存中所有按钮禁用。每次打开详情都会滚回顶部。
- 规则：
  - 已读状态按 成员 + 记录 + revision 保存。用旧 revision 标记已读返回 409 "This information changed. Reopen the latest revision before marking it read."。
  - 已读不改变记录的评审状态、证据等级或任务状态。
  - reader 可以标记已读和关注机构。
  - 已读与关注状态都是个人的：A 已读不影响 B 的未读。
- 来源：`IntelligenceInbox.vue`，`src/server/intelligence.ts`，`tests/operations.test.ts`（intelligence 两个测试），`tests/browser/workflow.json`

### 8.3 关注机构
- 交互：在情报页选定机构后，点 "Follow organization" 或 "Following organization" 切换关注状态。成功后刷新提醒与列表。
- 规则：关注状态是个人的，只影响 related 范围和相关性原因。机构不存在时返回 404。
- 来源：`IntelligencePage.vue`，`src/server/intelligence.ts`

### 8.4 活动历史

- 入口：顶栏时钟图标，路由 `/w/internal/activity?organizationId=`。
- 内容：
  - 标题 "Activity history"，说明 "Task, object and evidence changes"。
  - 机构下拉（All organizations + 各机构），修改时 replace query；"Refresh" 按钮。
  - 说明："Shows the latest 100 changes you can access in the selected scope."。
  - 事件列表按时间倒序，最多 100 条：标题，以及 机构名 · 作者 · 时间。
- 交互：点击事件时按类型跳转：
  - task → `/w/internal/work?organizationId&task`。
  - scenario → 该机构的 capital_optimization tab，带 `?object=`。
  - 其他（object / claim / relation） → 该机构的 relationships tab，带 `?object=`。
- 状态：加载中 "Loading…"；无事件时 "No activity in this scope."；错误时显示错误。
- 规则：只显示当前用户可见的事件（admin 事件对非 admin 隐藏）。事件标题的格式见 7.10–7.13。
- 来源：`src/web/components/ActivityHistory.vue`，`src/server/operations/work.ts`

## 9 指标与数据来源

### 9.1 值选择规则（一个机构在某列显示哪个值）
- 规则：
  1. 候选观测有两类：
     - 机器观测：每个来源**最近一次成功采集批次**中的值。
     - 团队观测：手工录入。
     - 对同一「机构 + 列 + 来源 + 来源名 + 单位 + 周期」，只保留最新的一条，按 capturedAt 倒序，再按录入序倒序。
  2. 只考虑单位与周期都匹配的候选。周期规则：annual 列的周期为所选年份；current / 24h 列的周期为字面值 `current` / `24h`。
  3. basis 为 `preferred` 时按 CoinMarketCap > CoinGecko > 团队观测 的顺序选；同一优先级内按时间取最新。basis 为 `cmc_web` / `coingecko_web` / `manual` 时只用对应来源。
  4. 不求平均，不做币种换算。不同币种、不同年份不混用。
- 规则说明文字（数据浏览器内显示）：
  - exchange 列：preferred 时为 "Prefer CoinMarketCap, then CoinGecko, then team observations."；指定单一来源时为 "Use {来源} only."。
  - 其他列或 manual："Use the latest saved observation with the selected unit and reporting period…"。
- 来源：`src/modules/columns.ts`（choosePoint、selectionPolicy），`src/server/metrics.ts`，`tests/rankings.test.ts`

### 9.2 数据浏览器（指标详情对话框）
- 入口：
  - Overview 指标格或详细指标表中的数值或 "Inspect sources"。
  - 目录单元格。从目录打开时，当前排序列会显示排名徽章 "Rank #n"。
- 内容：
  - 眉标 "{机构} / DATA EXPLORER"，标题为列名。
  - 徽章：单位、周期，以及可选的 "Rank #n"。
  - 列定义；"How this value is selected" 块：选择规则 + "Use the latest observation within each source for this unit and period. Different currencies and years are not mixed. Values are never averaged."。
  - 观测卡片：该机构该列的全部候选观测，每条一张。
    - 徽章：当前显示值为 "Displayed value"；单位或周期不符时为 "Different unit" / "Different period"；其余为 "Alternative observation"。
    - 内容：来源名、数值、单位 · 周期、assumptions、"Captured {时间} · Recorded number: {原始数字串}"。
    - 操作：
      - "Original reference"：打开证据。
      - "Source page"：外链。
      - "Rank using this basis"：跳到目录并设置 `tag=<列的第一个标签>&sort=<列>&unit=<单位>&year=<周期为4位年份时取它，否则用当前所选报告年份>&basis=<该观测的来源>`；从目录打开时则就地更新目录 query 并关闭对话框。
  - 有观测时提示 "Only observations saved for this organization are used in its rankings."。
  - **"Other source matches"**：其他来源中同名但未确认身份的档案。卡片带 "Identity not confirmed" 徽章。说明："Same-name profiles awaiting identity review. These observations are excluded from this organization's values and rankings until an administrator links the source."。admin 可点 "Confirm identity and link"（进行中显示 "Linking…"）。
  - 非 reader 可点 "Add observation" 展开录入表单（见 9.3）。
- 状态：
  - 加载中 "Loading observations…"。
  - 没有观测时："No observation recorded"，说明 "Add a sourced value with its reporting period and assumptions. Missing data is never treated as zero."。
- 规则：
  - 机器观测没有 assumptions 时自动生成："{提供方}. {列定义}"；volume_24h 另加 " Original {USD|BTC} amount; no currency conversion."。
  - 同名候选的条件：
    - 名称大小写不敏感相等。
    - 候选链接尚未经人工映射。
    - 本机构还没有该来源的链接。
    - 最多 10 条。
  - 确认链接后，那条来源链接归属到本机构，源观测随之计入本机构，并写入审计记录。
- 来源：`src/web/components/MetricDialog.vue`，`src/server/metrics.ts`（sourceMatches、explain），`src/web/components/DirectoryView.vue`（rankWith），`README.md`（Rankings and source exploration）

### 9.3 添加团队观测
- 入口：数据浏览器中的 "Add observation"，表单标题 "Record a sourced value"。
- 内容：
  - Value（必填，占位 "Number, without separators"）。
  - Unit：该列可用的单位。
  - Number qualifier：Exact / At least (≥) / Up to (≤) / More than (>) / Approximately (≈)。
  - Reporting year：仅 annual 列，必填，默认为当前所选年份。
  - Source name（必填，≤160）。
  - Source URL（可选）。
  - Scope and assumptions（必填，≤3000，占位为列定义）。
  - Original reference text（必填，≤100000）。
  - 提示："A new observation preserves previous values and their original references."。
  - 按钮：Cancel、"Save observation"。
- 交互：保存成功后收起表单，重新加载观测，并通知外层刷新（目录或 Overview 数值随之更新）。
- 规则：
  - value 必须匹配 `(0|[1-9]\d{0,29})(\.\d{1,18})?`：不接受科学计数、负数或前导零。
  - 列必须属于该机构的标签，单位必须属于该列；annual 列的周期为 19xx/20xx/21xx 年份，其他列的周期必须等于该列周期。不满足时返回 422。
  - sourceUrl 只能是 http/https。原文不能是纯空白。reader 保存返回 403。
  - 只追加：旧观测和原文永远保留。同一来源名的新观测替代旧观测的显示；不同来源名作为并列候选同时显示。
  - 保存时写入证据（原文 → `{列}-reference.txt`）和一条编辑历史。
- 来源：`MetricDialog.vue`，`src/server/metrics.ts`（metricInput、recordMetric），`tests/rankings.test.ts`

### 9.4 来源身份（CMC / CoinGecko 档案与机构的归属）
- 规则：
  - 机构是交易对手，不是某个来源的一行数据。同一交易所在 CMC 与 CoinGecko 的档案属于**同一个**机构，但两边的排名、数值、币种、时间和原始快照各自独立保存。
  - 采集时，只按一张**人工审核过的 slug 对照表**把 CMC 与 CoinGecko 档案归到同一机构，与采集顺序无关：
    - 表中条目：Binance、Binance.US、Coinbase Exchange、Upbit、OKX、Bybit(cg: bybit_spot)、Bitget、Gate、KuCoin、MEXC、Crypto.com Exchange(cg: crypto_com)、Bitfinex、BingX、Kraken、LBank、Bitstamp、Bithumb、Gemini、Pionex、Toobit、Ourbit、CoinW、WhiteBIT、WEEX、Bitunix、Bitvavo。
    - 不在表中的同名档案**不会**自动合并。Global、US、TR、TH、EU 等地区实体不能合并。
    - 管理员已做过的映射优先。
  - 新 slug 首次出现时，自动创建一个带 exchange 标签的机构。
  - 管理员可在 Data sources 页修改映射（见 9.6），也可在数据浏览器中确认映射。目标机构必须带 exchange 标签（422）；同一机构对同一来源只能有一个链接（409）。映射变更写入审计。
  - 旧机构 URL（alias）解析到规范机构，tab 和 query 保留。
- 来源：`src/server/exchange-identities.ts`，`docs/organization-identity.md`，`tests/exchange-identities.test.ts`，`src/server/app.ts`（/sources/mappings）

### 9.5 数据来源页
- 入口：侧栏 Administration → Data sources；`/w/internal/sources`。所有角色都能看到页面，管理操作仅限 admin。
- 内容（自上而下）：
  1. 标题区「DATA FOUNDATION / Data sources」，说明「Trace every update from the organization back to its original source.」。admin 另有「Daily collection: On/Off」切换按钮。
  2. 两张来源卡片，CoinMarketCap 和 CoinGecko，各包含：
     - 来源名、页面类型说明（CMC「Spot exchange ranking page」，CG「Trust Score exchange ranking page」）
     - 最近一次运行的状态徽章，从未运行时显示「Awaiting collection」
     - 最近一次成功运行的有效记录数，以及成功时间，没有成功过时显示「No successful batch yet」
     - 固定说明「Top 50 target · Actual coverage recorded」
     - 最近一次运行的错误信息
     - 「View original page」：最近一次成功运行的原文快照，在原文抽屉中打开
     - admin 可见「Collect now」按钮
  3. 「Collection activity」表：说明「A failed run never replaces the last successful data.」。列为 Source、Time（开始时间）、Status、Valid rows（仅成功运行显示，其余为「—」）、Details / reference（错误信息和「Original page ↗」），显示最近 50 条，按开始时间倒序。
  4. 「Source identity mappings」（仅 admin）：见 §9.6。
- 状态：
  - 没有运行记录时显示「No collection runs yet. An administrator can start one above.」。
  - 加载失败时显示错误。
  - 运行错误中如果含有数据库内部错误特征，一律改为显示「Data processing failed. This batch was not published.」，不暴露内部错误。
- 来源：src/web/components/SourcesView.vue；src/server/app.ts `/sources`

### 9.6 来源身份映射（仅 admin）
- 内容：
  - 说明：来源记录一开始各自独立，确认是同一实体后再链接；原始记录与历史保留。
  - 过滤框「Filter source names…」：按来源名做客户端子串过滤，不区分大小写。
  - 表格列：来源机构名（下方附 slug）、来源、当前链接的机构、复核状态、「Review / change mapping →」。复核状态为「Reviewed」（有人确认过）或「Independent source profile」。
  - 排序：先按来源，再按名称。
- 交互：「Review / change mapping →」打开对话框，眉标为「来源名 / 来源机构名」，标题为「Link to an organization」，提示「选中即保存，来源观测保持独立」，内嵌仅限 exchange 的机构选择器（§2.15）。选中后立即保存，关闭对话框，刷新本页和全局数据。失败时关闭对话框，并在页面显示错误。
- 规则：
  - 只能链接到带 exchange tag 的机构，否则返回 422。
  - 同一机构对同一来源只能有一个链接，冲突返回 409「This organization already has a different link to this source.」。
  - 每次映射都写入审计记录（`source_mapped`，包含原机构和新机构）。
  - 原机构保留为独立档案，其记录不会被移走或删除。之后的采集按保存的映射归档。
  - 仅凭同名永不自动合并。未确认的同名候选只在指标对话框里标注为「Identity not confirmed」，不参与排名。
- 来源：tests/integration.test.ts（editor 映射返回 403，admin 返回 200，合并后 USD 和 BTC 两种货币都保留）；src/web/components/SourcesView.vue；src/server/app.ts PATCH `/sources/mappings/:id`；docs/architecture.md §Source semantics；README.md §Rankings

### 9.7 排名采集（CMC / CoinGecko 公开排行页）
- 入口：
  - Data sources 页 `/w/internal/sources`，写操作仅 admin。
    - 每个来源一张卡片，有 "Collect now" 按钮。
    - 页头有 "Daily collection: On/Off" 切换，默认关闭。
    - 命令行 `npm run collect` 也能触发，v2 可改用等价的后台任务。
  - 采集目标页：
    - CMC：`https://coinmarketcap.com/rankings/exchanges/`，现货。
    - CoinGecko：`https://www.coingecko.com/en/exchanges`。
    - 每次目标前 50 条。
- 交互：
  - 点 "Collect now" 后立即返回 202 Accepted，采集在后台进行。
  - 任一采集正在运行时，所有 "Collect now" 按钮禁用，文字变为 "Collection in progress"。服务端对第二个请求返回 409 "A collection is already running."。
  - 运行期间页面每 2.5 秒轮询；结束后触发全局刷新，目录和机构指标随之更新。
  - 开启每日采集后，服务每分钟检查一次：没有运行中的任务时，对「最近一次运行 ≥24 小时前」的来源发起一次采集，每次只发起一个。
- 状态（失败表现）：
  - 失败的运行记为 failed，并记录错误文本（最长 500 字）。**上一次成功批次的数据继续生效**，失败批次不发布。
  - 数据库类错误在界面上统一显示为 "Data processing failed. This batch was not published."。
  - 服务重启时，仍处于 running 的运行改为 interrupted，错误为 "Interrupted after restart. The last successful batch is retained."。
  - 以下情况整批拒收：
    - 返回反爬挑战页，即标题含 just a moment / access denied / verify you are human / attention required。
    - 表头变化，无法确认指标定义。
    - 有效行数少于 min(50, 10)，或 slug、名次有重复。
    - 带 24h 量的行不足 80%。
    - CoinGecko 的量既不是 BTC 也不是 USD。
    - CMC 页面内嵌数据与可见表格前 10 行不一致（名称、名次或量相差 >1）。
    - 行数少于上一次成功批次的 80%。
    - HTTP 非 2xx、响应不是 HTML、页面超过 5MB、超时 30 秒、发生重定向。
- 规则：
  - 每次采集都保存原始 HTML 证据（sha256、字节数、采集时间、解析器版本 `cmc-html-v1` / `coingecko-html-v1`）。
  - CMC 采集字段：24h 现货量（USD）、liquidity、weekly visits、markets、coins。CoinGecko 采集字段：trust score（/10）、24h 量（按页面显示的 BTC 或 USD，保留页面显示的精度，不取隐藏的换算值）。
  - 数字保持原始十进制字符串；无法解析的（如 "—"）存为缺值，不当作 0。
  - 只有最近一次成功批次参与值选择；历史批次只出现在 Overview 的 Sample history 中。
  - 采集到的来源名次只保存为观测元数据，不作为目录排名。
  - 历史数据不迁移，v2 重新采集（按任务说明）。
- 来源：`src/collectors/collect.ts`，`src/collectors/parsers.ts`，`src/server/index.ts`（每日定时），`src/server/app.ts`（/sources），`src/web/components/SourcesView.vue`，`tests/domain.test.ts`，`tests/rankings.test.ts`，`tests/exchange-identities.test.ts`

## 10 工作台与路线图

### 10.1 工作台页
- 入口:侧栏第一项 "Work",路由 `/w/internal/work`。旧链接 `/w/internal/work?section=intelligence` 重定向(replace)到 `/w/internal/intelligence`,其余查询参数保留。
- 内容(自上而下):
  1. 标题 "Work" + 说明 "Move tasks forward, follow up on responses and resolve blockers."。右侧操作(非 reader):"Start standard onboarding"(条件见 10.5)、"Add from new information"(未选机构时禁用)。
  2. 工具栏:机构下拉("All organizations" + 所有机构,按名称排序,合并掉的别名机构不列)、负责人下拉、状态下拉、"Filters · N" 展开按钮;右侧 "Reset filters"、"View dependencies"(只在选了机构且该机构有任务时显示)、布局切换 List / Board。
  3. 展开的过滤区:Track 下拉("All tracks" / Business / Engineering / Compliance / Research),Search 输入框(占位 "Task, organization or owner")。
  4. 任务集合(列表或看板,见 10.2)。
- 负责人下拉:`Everyone`(空)/ `My work`(当前用户)/ `Unassigned`(值 `__unassigned`)/ 其他成员(排除自己)。
- 状态下拉:`actionable` "Work to move forward"(默认)/ `open` "All open tasks" / 空 "All tasks" / 以及按显示状态精确筛选的 ready、active、waiting、blocked、done、skipped。
- 过滤逻辑(全部 AND):
  - 机构:限定该机构。
  - 负责人:`__unassigned` 只留没有负责人的,其他值按 ownerId 精确匹配。
  - Track:按 lane 匹配。
  - 状态:`actionable` 见 10.3 的"待推进"定义;`open` 表示未 done/skipped;空值表示全部;其余按 displayState 精确匹配。
  - Search:不分大小写的子串匹配,匹配范围是显示标题(翻译后)、原标题、机构名、描述、负责人名。
- "Filters · N" 的 N 统计四项:负责人非空、Track 非空、状态不等于 `actionable`(包括"All tasks")、搜索非空。机构不计入。
- 交互:
  - 改任意过滤项或布局后,立即用 `router.replace` 写回 URL 查询(`organizationId, ownerId, lane, state, search, layout`),不新增历史记录。
  - URL 查询变化时反向更新过滤项:非法的 `lane` / `state` 回落到默认值;URL 里没有 `state` 时默认 `actionable`,显式 `state=` 空串表示"All tasks"。
  - "Reset filters":所有过滤项恢复默认(机构也清空),布局恢复 List。
  - 记忆偏好:按"用户 × 页面"存在浏览器本地(v1 的 key 是 `omniboard.last-filters.<userId>.work`),只存上面 6 个键,每个值不超过 1000 字符,不是字符串的值丢弃。从别的页面进入 `/w/internal/work` 且 URL 没有任何查询参数时,自动套用上次的过滤。带参数的链接优先,这时不恢复,并把链接里的值记为新的偏好。`task`、`sourceRecord`、`record`、`page` 属于导航状态,从不保存。本地存储不可用时静默忽略。
  - `?task=<id>`:打开该任务的详情面板(10.4)。任务不在当前机构范围内时,显示 "Task" 弹窗,内容 "This task is not available in the current scope."。
  - `?organizationId=<org>&sourceRecord=<recordId>`(仅非 reader):自动打开"从新信息创建任务"对话框,并以该记录为来源预填(10.6)。同一个 sourceRecord 只自动打开一次。
  - 关闭任意任务弹窗:从 URL 删除 `task` 和 `sourceRecord`,其他参数保留。
- 状态:
  - 首次加载时显示 "Loading work…"。
  - 加载失败:显示错误文案和 "Retry" 按钮。
  - 空态分两种:
    - 范围内有任务但过滤后为空:"No tasks to move forward in this scope" / "Waiting and completed tasks remain available under All tasks.",附 "All tasks" 按钮,点击把状态设为"全部"。
    - 范围内没有任务:"No active plan yet" / "Choose an organization to start its standard onboarding plan."。
- 刷新规则:
  - 页面可见、且没有打开任何弹窗(任务详情、计划编辑、启动、依赖图)时,每 30 秒自动刷新一次。窗口重新获得焦点时也刷新。
  - 打开编辑窗口时暂停后台刷新,避免覆盖正在填写的内容。
  - 较慢返回的旧请求结果一律丢弃(用请求序号判定)。
- 来源:`src/web/components/WorkBoard.vue`、`src/web/composables/useWorkFeed.ts`、`src/web/composables/useRememberedFilters.ts`、`src/modules/filter-preferences.ts`、`tests/filter-preferences.test.ts`、`src/web/main.ts`、`docs/work-navigation.md`

### 10.2 任务集合:列表与看板
- 列表和看板用同一组任务、同一个顺序,只是呈现不同。
- 分组与排序:
  - 分组顺序固定:`Follow up now` → `In progress` → `Ready to start` → `Waiting for a response` → `Waiting for prerequisites` → `Planned` → `Completed / Not needed`。
  - 任何未完成的任务只要带提醒(10.3),就归入 `Follow up now`,不管它的实际状态。
  - 组内排序键依次为:`dueOn || followUpOn` 升序(都为空的排最后)→ 标准模板中的顺序(非模板任务排在模板任务之后)→ id。
  - 只显示有任务的组,组头带计数。
  - `Planned` 组实际上永远为空:未被阻塞的 planned 任务显示为 ready。
- 列表行(整行可点,点击打开详情):
  - 标题;
  - 次行:机构 · Track。在机构页内嵌时只显示 Track;
  - 状态徽标 + 提醒标签(可多个);
  - 负责人,没有时显示 "Unassigned";
  - 日期:有 followUpOn 时显示 "Follow up <date>",否则显示 dueOn,都没有时显示 "—"。
- 看板:
  - 每组一列,组头显示组名和计数。
  - 卡片内容:机构 · Track、标题、状态徽标、提醒标签;有未完成前置时显示 "After N prerequisites";底部显示负责人和 `followUpOn || dueOn`。点击卡片打开详情。
  - 没有拖拽。改状态只能在详情面板里做。
- 来源:`src/web/components/WorkTaskCollection.vue`、`src/modules/work-queue.ts`、`tests/work-queue.test.ts`

### 10.3 任务状态模型与提醒
- 存储状态有 5 个:`planned` "Planned"、`active` "In progress"、`waiting` "Waiting for a response"、`done` "Completed"、`skipped` "Not needed"。
- 显示状态(displayState)按以下顺序实时计算:
  1. done 或 skipped:显示为原状态;
  2. 有未完成的前置:`blocked` "Waiting for prerequisites";
  3. planned:`ready` "Ready to start";
  4. 其余显示为原状态。
- 某个前置对当前用户不可见时,仍然算作阻塞项,标题显示 "Restricted prerequisite"。
- 被阻塞的任务不会显示成"可开始"。
- 提醒(只针对未完成任务):
  - `Overdue`:dueOn < 今天;
  - `Follow up now`:显示状态是 waiting,且 followUpOn ≤ 今天。
  - 两条可以同时出现在同一个任务上,但任务本身只出现一次。
  - 正常的等待(跟进日在未来)和正常的可开始都不产生提醒。
- "待推进"(actionable)的定义:未完成,并且显示状态是 ready 或 active,或者带任意提醒。所以已逾期的 blocked 任务也算待推进。
- Track(lane)取值:`business` Business、`engineering` Engineering、`compliance` Compliance、`research` Research。
- 来源:`src/modules/operations.ts`、`src/modules/work-queue.ts`、`src/server/operations/queries.ts` taskRows、`tests/work-queue.test.ts`

### 10.4 任务详情面板
- 入口:点击列表行或卡片、依赖图节点、`?task=` 链接、路线图或机构概览里的任务链接。以右侧模态面板打开。
- 内容(自上而下):
  1. 标题(显示标题)+ 关闭按钮。
  2. "View dependencies" 链接。
  3. 上下文导航:"← Previous" / "i of N" / "Next →"。在当前列表中的位置;任务不在当前列表里时显示 "Linked task",前后按钮禁用。保存中也禁用。
  4. 保存反馈区(仅在操作成功后显示,见"交互")。
  5. 状态行:状态徽标、Track · 负责人、"Edit plan"(非 reader 且任务未完成)。
  6. 未完成任务显示 "NEXT STEP" 区块,内容按以下顺序回落:nextStep → 描述 → "Agree a concrete next action with the task owner."。其下 "Done when" 显示 completionCriteria,缺省时显示 "Record the agreed result and its supporting evidence. Add a specific completion condition in Edit plan."。
  7. 元信息行:机构名 · "Standard onboarding" 或 "Added from new information",有截止日时加 "· Due <date>"。
  8. 可折叠的 "Task context",显示描述全文。
  9. "What this enables"(仅未完成、且有下游时显示):
     - 本任务是某下游唯一剩余前置时,列该下游,标注 "Ready after this task";
     - 下游还有别的前置时,列出并标注 "Also needs X, Y"。
  10. "Prerequisites":每个前置显示状态徽标和标题,点击跳到该前置的详情。
  11. "Verification evidence from quant"(仅对标准 validation 任务显示,且任务未完成、用户非 reader):每条已通过的 run 显示为 `suite · environment · account · build 前 12 位 (dirty) · 完成时间 · "N passed, M skipped"`,附 "Complete with this run" 和 "Reference" 按钮。有未完成前置时一键完成按钮禁用,并提示 "Complete or waive the prerequisites first."。
  12. "Latest result / follow-up":显示最近一次 outcome,保留换行。
  13. 链接行:
      - "Open source information":有来源记录时显示,跳 `/w/internal/intelligence?organizationId=&record=`;
      - "View reference":打开任务的当前证据;
      - "Activity history":点击后在下方加载该任务的历史,每条显示标题、作者 · 时间、outcome,有证据的带 "Reference";
      - "Linked objects & evidence":跳 `/w/internal/organizations/<org>/relationships`。
  14. 操作表单(非 reader;操作刚把任务变成完成状态时隐藏):标题为 "Move this forward",已完成的任务标题为 "Reopen task"。
  15. 底部固定条(与表单显示条件相同):左侧当前状态,右侧 "Move this forward" 按钮,点击平滑滚动到表单。
- 操作表单:
  - Action 下拉(aria "Task action")选项如下。与当前状态相同的选项禁用;有未完成前置时,active、waiting、done 禁用。
    - `progress` "Record progress · keep current status"(仅未完成任务)
    - `planned` "Return to plan / reopen"
    - `active` "Start or resume work"
    - `waiting` "Wait for a response"
    - `done` "Complete with evidence"
    - `skipped` "Mark not needed"
  - 默认选中:任务已完成 → planned;planned 且无阻塞 → active;其他 → progress。
  - 字段:
    - 结果文本:选 skipped 时标签为 "Why is this task not needed?",其他为 "Result or follow-up"。done、skipped、progress、waiting 时必填。
    - "Next concrete step":动作不是 done、skipped、planned 时显示,最长 1500 字,预填当前 nextStep。
    - "Follow up on"(日期):动作为 waiting,或动作为 progress 且任务当前是 waiting 时显示。提示 "Appears in Focus when the date arrives."。预填当前值。
    - "Assign this task to me" 复选框:动作为 active 且任务无负责人时显示,默认勾选。
    - 动作为 done 或 skipped 时:"Original evidence or decision note"(必填),"Source / test artifact URL"(可选)。
    - validation 任务选 done 时,另外必填 "Tested environment" 和 "Code revision"。
  - 常驻说明:"This records work and results. It does not run an API test or change a live trading account."
  - 提交按钮文案随动作变化:progress → "Save progress",done → "Complete task",waiting → "Save follow-up",active → "Start work",planned 和 skipped → "Save decision"。保存中显示 "Saving…"。
- 交互:
  - 提交成功后刷新任务数据,并在面板顶部显示反馈:
    - done:"Task completed. Your result and evidence are saved.";
    - skipped:"Marked not needed. Your decision is saved.";
    - progress:"Progress saved. Task status is unchanged.";
    - 其他:"Task updated."。
  - 完成或跳过时,反馈里还有两部分:
    - "Ready now":列出这次操作真正解除阻塞的直接下游(操作前是 blocked、操作后是 ready),每项注 "This prerequisite is now resolved.",点击跳转;
    - "Other work still has prerequisites":列出仍有前置的下游,格式为 "X · Still needs Y, Z"。
  - 反馈区的主按钮是 "Continue to next task"。目标依次取:第一个新解锁的任务 → 当前列表中第一个(不是本任务)显示状态为 active 或 ready、且无负责人或负责人是我的任务。两者都没有时显示 "Back to focus",点击关闭面板。
  - 成功后清空结果、证据和 URL 字段。动作重置:新状态已完成 → planned,否则 → progress。面板滚回顶部。
  - 切换到另一个任务时,清空反馈、错误、历史、所有输入,nextStep 和 followUp 预填为新任务的值,滚回顶部。
  - 依赖图关闭后回到面板,未提交的输入保留(面板在打开依赖图期间只是隐藏,没有销毁)。
  - "Complete with this run":以 done 状态完成任务。结果自动生成为 `Verification passed: <venue> <suite> (run <id>, N passed, M skipped, observed <time>).`,并附 `Environment: <env> · <account> (<kind>)` 和 `Code revision: <build>( (dirty))`。证据是这次 run 的 JSON。来源记录指向产生该请求的接入记录。没有负责人时自动认领给我。反馈同 done。
- 状态:保存或加载失败时,在表单内显示服务端错误原文(role=alert)。
- 规则(服务端):
  - 所有写操作都带 revision。revision 不一致时返回 409,文案为 "This task changed. Reload before …"。
  - 状态变更:
    - 必须变到不同的状态,否则 422 "Choose a different task state.";
    - 有未完成前置时,变到 active、waiting、done 返回 409 "Complete or explicitly waive the prerequisites first.";
    - 变到 done 或 skipped 时必须有 outcome(422 "Record the result or the reason this task is not needed."),且必须附原始证据文本或选择来源记录(422 "Add the original information or select an existing source record.");
    - validation 任务变到 done 时必须有 environment 和 codeRevision(422 "Record the tested environment and code revision.")。
  - 重开(从完成变为未完成):只要有任何下游不是 planned,就返回 409 "Reopen or reset dependent tasks first: <title>"。如果该下游对当前用户不可见,文案改为 "An administrator must reset a dependent task before this task can be reopened.",不泄露标题。
  - 离开 waiting 时 followUpOn 清空。认领只在任务原本没有负责人时生效,不覆盖已有负责人。
  - 记录进度:保持状态不变,outcome 必填。原文作为新证据保存。已完成的任务返回 422 "Reopen this task before recording more progress."。
  - 每次操作写一条历史,标题格式:
    - "Replanned · …"、"Started · …"、"Waiting for a response · …"、"Completed · …"、"Marked not needed · …";
    - 记录进度为 "Progress recorded · …";改计划为 "Plan updated · …"。
- 来源:`src/web/components/TaskInspector.vue`、`src/modules/focus.ts` taskImpact、`src/server/operations/task-service.ts`、`src/server/operations/work.ts`、`tests/operations.test.ts`(completion feedback / progress preserves state / standard onboarding 三个用例)、`tests/browser/workflow.json`

### 10.5 启动标准接入计划
- 入口:工作台或机构页 "Next actions" 区的 "Start standard onboarding" 按钮。显示条件:
  - 用户非 reader;
  - 已选定机构;
  - 该机构的标签带有 Onboarding 模块(见 4.2);
  - 该机构还没有标准任务。
- 内容:
  - 说明 "These 9 tasks are planned together. Business, research and engineering can progress independently wherever no prerequisite is listed."。
  - 逐项列出模板任务:标题、Track,以及 "After: <前置标题>; …" 或 "Can start independently"。
  - Access 下拉:"Internal team";admin 用户另有 "Administrators only"。
  - 说明 "All tasks start as planned. Existing notes do not automatically prove approval or completed testing."。
  - 按钮 "Create onboarding plan"。
- 模板 v1 共 9 项(key · 标题 · lane · 前置):
  1. scope · Define account and product scope · business · 无
  2. contacts · Find the right business and technical contacts · business · 无
  3. terms · Research fees, funding and special resources · research · 无
  4. eligibility · Confirm product and regional eligibility · compliance · scope
  5. account · Obtain the required account access · business · eligibility
  6. resources · Confirm API permissions and requested resources · business · account
  7. docs · Review the API and connector requirements · engineering · scope
  8. implementation · Prepare the connector and configuration · engineering · docs
  9. validation · Validate the connection for our account · engineering · resources + implementation
- 每项都带固定的描述、建议下一步和完成条件(文案见 `src/modules/operations.ts`、`src/modules/focus.ts` taskGuidance)。任务没被编辑时显示这些默认文本;默认文本随界面语言翻译,用户改过的保留原文。
- 交互:创建成功后关闭弹窗并刷新列表。创建后只有 scope、contacts、terms 三项是 ready,其余 6 项 blocked。
- 规则:
  - 幂等:已有标准任务时再次启动返回 `created: 0`,不会重复创建。
  - 机构类型不支持时返回 422 "Standard onboarding is not configured for this organization type."。
  - 非 admin 选 admin 可见返回 403。
  - 全部任务的初始状态都是 planned,不从旧记录推断已获授权或已测试。
  - 启动时保存一份模板快照作为这些任务的共同证据。
- 来源:`src/web/components/WorkBoard.vue`、`src/modules/operations.ts`、`src/server/operations/task-service.ts` startOnboarding、`tests/operations.test.ts`、`docs/internal-operations.md`

### 10.6 新建任务 / 编辑任务计划
- 入口:
  - "Add from new information":新建,标题 "New information → New task";
  - 详情面板 "Edit plan":编辑,标题 "Edit task plan";
  - 带 `sourceRecord` 的链接:新建并预填来源;
  - 路线图 "Create follow-up task" 和情报详情 "Create evidence-backed follow-up",实际都走带 `sourceRecord` 的链接。
- 字段:
  - Task title:必填,最长 160。
  - Track。
  - Owner:"Unassigned" 或任一成员。
  - Due date。
  - Access:Internal team / Administrators only(仅 admin)。编辑时禁用。
  - Context:描述。
  - Next concrete step:≤1500。
  - Done when:≤2000,占位 "A result that can be checked against evidence"。
  - Follow up on:仅当被编辑的任务当前是 waiting 时显示。
  - "Must finish first":前置任务复选列表。候选为同机构的其他任务;任务是 team 可见时只列 team 任务。提示 "Leave empty to allow independent progress. A person can own several concurrent tasks.",没有候选时显示 "No existing prerequisites."。
  - "Related objects":该机构的知识对象复选列表(名称 · 类型),按可见性过滤。机构没有对象时整组不显示。
  - "Source record" 下拉:"Use an original note below" 或该机构的任一记录(按可见性过滤)。
  - 原始说明文本:新建时标签为 "New information that triggered this task",未选来源记录时必填;编辑时标签为 "Additional source note (optional)"。
  - Source URL。
  - 按钮 "Cancel" / "Save task"。
- 交互:
  - 从 sourceRecord 预填时:标题为 "Follow up: <记录标题>"(截到 160 字),可见性继承该记录。记录找不到时显示错误 "The requested source is not available. Choose a reference before saving."。
  - 加载机构知识数据期间整个表单禁用。
  - 保存成功后关闭弹窗、刷新列表。
- 规则(服务端):
  - 负责人必须是当前成员("Choose a current team member.")。
  - 前置必须是同机构内可访问的任务。team 任务不能依赖 admin 任务。禁止自依赖和间接循环("A task cannot depend on itself, directly or through other tasks.")。
  - 关联对象必须属于本机构,且可见性兼容。
  - 来源记录必须属于本机构,否则 404 "The source record is not available in this organization."。admin 可见的来源只能用于 admin 任务("Restricted evidence requires an administrator-only item.")。
  - 编辑时的限制:
    - 可见性不可改("Task access cannot change after creation.");
    - 已完成的任务不能改计划("Reopen this task before editing its plan.");
    - 非 planned 的任务不能新增未完成的前置(409 "Move the task back to planned before adding an unfinished prerequisite.");
    - 改了来源记录或补了原文时,生成新的证据引用,历史保留旧引用。
  - 新建的任务 origin 为 discovery,初始状态 planned。历史标题为 "New information → <title>"。
- 来源:`src/web/components/TaskPlanDialog.vue`、`src/server/operations/task-service.ts`、`src/server/operations/shared.ts`、`tests/operations.test.ts`(editing a task source / private evidence 用例)、`tests/browser/workflow.json`

### 10.7 依赖图
- 入口:
  - 工作台工具栏 "View dependencies":整个机构,不聚焦;
  - 详情面板 "View dependencies":聚焦当前任务;
  - 机构页 "Next actions" 区的 "View dependencies"。
  以弹窗打开,标题 "Task dependencies"。
- 内容:
  - 说明 "Dependencies include prerequisites outside your task filters.":依赖图包含该机构的全部任务,不受负责人、状态、搜索过滤的影响。
  - 工具栏:
    - "Focus task path" 下拉:"All tasks" 或某个任务。选中后只显示该任务、它的直接前置和直接下游;
    - 缩放 "−" / 百分比 / "+":范围 25%–150%,每步 15%,点百分比复位到 100%;
    - "Fit graph":按容器宽度适配,结果限制在 25%–100%。
  - 画布:
    - 横轴是拓扑层,不表示时间长度。第一列标 "Can start independently",其余列标 "After prerequisites";
    - 同层内按模板顺序、再按标题排;
    - 节点显示 Track · 负责人、标题、状态徽标;
    - 前置已完成的连线显示为"已完成"色,其余为弱色;跨多层的连线从下方绕行;
    - 最近一次操作新解锁的任务节点加描边。
  - 画布区域可聚焦、可横向滚动。
- 交互:
  - 点节点:关闭依赖图,打开该任务的详情。
  - 关闭依赖图(按钮、Esc、点背景):回到之前的详情面板,输入保留。
  - 聚焦的任务从数据中消失时,自动回到 "All tasks"。
- 来源:`src/web/components/TaskMap.vue`、`src/web/components/WorkBoard.vue`、`src/modules/operations.ts` dependencyLayers、`tests/operations.test.ts`(dependency graph 用例)、`docs/work-navigation.md`

### 10.8 Onboarding 标签页整体布局
- 入口:`/w/internal/organizations/<id>/onboarding`。只在机构标签带 Onboarding 模块时出现:exchange、broker、bank、custodian、data_provider、infrastructure_provider、connectivity_provider。market_maker、hedge_fund、trading_company、think_tank、company、government 没有这个标签页。
- 内容顺序:
  1. 模块标题 "Onboarding" 和说明,非 reader 显示 "Add record" 按钮;
  2. 资源进度卡片(10.9,仅在有记录时显示);
  3. "Next actions"(10.10);
  4. "Engineering requests"(11.2)。
- `?record=<id>`:自动展开并滚动到对应卡片。
- 来源:`src/web/components/ModuleView.vue`、`src/modules/registry.ts`、`docs/work-navigation.md`

### 10.9 资源进度卡片(每条 Onboarding 记录一张)
- 顶部说明:"Each card covers one recorded resource and scope. Only the recorded stage is highlighted; earlier stages are not assumed complete."。
- 折叠头(只有一张卡片时默认展开,多张时默认全部折叠):
  - 资源类型标签;
  - 范围:取 product。导入的样板文本 "Product, account, entity and environment to confirm" 显示为 "Account and product scope not confirmed";没有 product 时用记录标题;
  - "Account · <accountRef>",没有时显示 "Account not recorded";
  - 一行汇总 "<商务状态> · <技术状态>";
  - 非 reader 显示 "Update progress" 按钮,打开通用记录编辑器编辑这条记录。点击不会展开或折叠卡片。
- 展开后:
  - 两条轨道,每条包含:当前状态文案(悬停显示解释)、阶段列表(只高亮记录的那一个阶段)、负责人(缺省 "Not assigned")。
    - "Business access":阶段为 Requested / In discussion / Access granted,负责人取 businessOwner。
    - "Technical connection":阶段为 Docs reviewed / Code available / Code tested / Test account / Live account,负责人取 technicalOwner。
  - 商务状态(resourceStage):
    - unknown "Access not confirmed"
    - requested "Access requested"
    - negotiating "Terms in discussion"
    - granted "Access recorded as granted"
    - expired "Access expired"
    - rejected "Request declined"
    - 派生状态 expiry_review "Expiry needs review":granted 且 expiresOn 早于今天。此时额外显示到期提示段落。
    - 未知值按 unknown 处理。
  - 技术状态(integrationStage):
    - unknown "Progress not recorded"
    - docs_only "Documentation reviewed"
    - implemented "Code available · tests not recorded"
    - unit_tested "Automated code tests passed"
    - sandbox_verified "Test account verified"
    - production_verified "Live account verified"
  - 商务和技术两条轨道互相独立:代码进度不代表已获授权。
  - "Next step" 区:显示 nextStep。没有 nextStep 时标题改为 "Checks & follow-up",内容用 verification 备注。两者都没有时显示 "No next step recorded. Update this record to assign one."。下方显示 "Record owner · X"。
  - 待办折叠区(有请求阻塞项或 blockers 字段时显示):
    - 标题:有请求阻塞项时为 "N checks before engineering can proceed",只有 blockers 字段时为 "Outstanding items recorded by the team";
    - 请求阻塞项取本记录当前请求的阻塞项,去重后逐条显示为可读文案(11.3);
    - blockers 字段文本显示在列表下方。
  - 请求加载中显示 "Checking engineering requests…"。加载失败显示 "Engineering requests could not be loaded: X" 和 "Try again"。
  - 底部:证据等级徽标、"Updated <time>"、"View source"。
  - 可折叠的 "Record details & history":
    - 可读标题;
    - 复核状态 · 范围 · v<revision>;
    - 其余已填字段;
    - Reviewed on、Review / access expiry;
    - 同时有 nextStep 和 verification 时显示 verification 全文;
    - 正文;
    - "Record history"、"Attachment"(有附件时)。
- 数据刷新:记录的 id 或 revision 一变,就重新拉取工作摘要。
- 来源:`src/web/components/OnboardingProgress.vue`、`src/web/components/ProgressTrack.vue`、`src/modules/work-progress.ts`、`tests/work-summary.test.ts`

### 10.10 "Next actions"(内嵌工作区)
- 数据与工作台共用同一组任务和同一个详情面板。
- 内容:
  - 标题 "Next actions" 和说明 "Move this organization forward. Open a task to update its progress."。
  - 右侧:"Start standard onboarding"(条件同 10.5)、"Add from new information"、"Open in workbench"(跳 `/w/internal/work?organizationId=<id>`)。
  - 不显示过滤工具栏。始终用列表布局,行内不显示机构名。
- 默认只显示本机构的待推进任务,排序同 10.2,最多 5 项。
- 交互:
  - "Show full plan (N tasks)":显示本机构全部任务(不截断)。展开后按钮变为 "Show next actions"。
  - 未展开时附注 "N more tasks in the plan"(N = 总数 − 显示数)。
  - "View dependencies":打开依赖图。
  - 切换机构时,关闭弹窗、收起、清空选中。
- 这里的过滤不写 URL,也不记偏好。
- 来源:`src/web/components/WorkBoard.vue`(embedded)、`docs/work-navigation.md`

### 10.11 路线图标签页
- 入口:`/w/internal/organizations/<id>/roadmap`。所有机构类型都有(包括公司、政府)。标签顺序在 Onboarding 之后、Comments 之前。机构对比页 `/w/internal/compare/<a>/<b>/roadmap` 两侧都有(紧凑版)。
- 内容:
  - 标题 "Roadmap" 和说明 "Milestones, target dates and progress for the organization and our collaboration.",非 reader 显示 "Add milestone"。
  - 有里程碑时依次显示:
    - 汇总:"Open milestones"(未 delivered/cancelled 的数量)、"Delivered milestones"、"Awaiting a date"(未完成且没有目标时间);
    - 工具栏:分段按钮 "All plans" / "Organization plans" / "Our collaboration",状态下拉(默认 "All milestone statuses");
    - 说明 "Dates keep their original precision. A target date is a plan, not a confirmed delivery.";
    - 时间线。
- 排序:按目标窗口起点升序,没有日期的排最后,然后按标题、id。
- 时间线每行:
  - 左侧日期:季度显示为 "2027 · Q2",其他原样显示;为空时显示 "Date not scheduled"。
  - 可折叠卡片头:计划类型、标题、预期成果、负责人(缺省 "Owner not recorded")、状态徽标、"Target window passed"(窗口已过时)、"N linked tasks"。
  - 展开后:
    - 正文(保留换行);
    - "Why this matters"、"Next step"、"Scope"、"Evidence review"(复核状态 · reviewedOn);
    - "Execution tasks":以 sourceRecordId 关联到本里程碑的任务,每条显示标题和实时状态,点击跳 `/w/internal/work?organizationId=&task=`;
    - 底部:作者 · 更新时间、"Original source"、"Attachment"、"Edit history";非 reader 另有 "Create follow-up task"(跳 `/w/internal/work?organizationId=&sourceRecord=<id>`,即 1.6 的预填)和 "Edit milestone"。
- 空态(没有任何里程碑):两个并列栏。
  - "Organization plans":"Product launches, market expansion and publicly announced plans."
  - "Our collaboration":"Our relationship goals, agreed milestones and next commitments."
  - 每栏有 "Add milestone",打开编辑器时预选对应的计划类型。reader 看到的是 "The team has not recorded a roadmap yet."。
- 其他状态:
  - 过滤后为空:"No milestones match these filters."。
  - 关联任务加载失败:"Linked tasks could not be loaded." + "Retry"。
  - 过滤只存在当前页面,不写 URL。`?record=<id>` 展开并滚动到对应里程碑。
- 来源:`src/web/components/RoadmapPanel.vue`、`src/modules/roadmap.ts`、`src/modules/registry.ts`、`tests/roadmap.test.ts`、`docs/roadmap.md`

### 10.12 里程碑字段与规则
- 使用通用记录编辑器,标题为 "Add milestone" / "Edit milestone"。复核状态字段的标签改为 "Evidence review"。
- 结构化字段:
  - planType:`organization` "Organization plans" / `collaboration` "Our collaboration"。
  - roadmapStatus:`planned` Planned / `in_progress` In progress / `on_hold` On hold / `delivered` Delivered / `cancelled` Cancelled。
  - targetPeriod:可选。
  - owner。
  - successCriteria "Expected outcome":必填。
  - impact "Why this matters"。
  - nextStep。
  - reviewedOn:必填。
- 目标时间格式:`YYYY`、`YYYY-Q1..Q4`、`YYYY-MM`、`YYYY-MM-DD`,必须是真实日期(`2027-02-29` 被拒,`2028-02-29` 可以)。拒绝的例子:`soon`、`2027-Q5`、`2027-13`、`2027-1`、`0000`。报错文案 "Enter a valid year, quarter, month or date for the target window."。
- 存储和显示都保留原始精度。内部换算成区间只用于排序和判断是否过期,例如 `2027-Q2` → 2027-04-01~06-30,`2028-02` → 02-01~02-29。
- "Target window passed" 的条件:整个窗口已过(区间终点 < 今天),并且状态不是 delivered/cancelled。不据此推断失败或延期。
- 里程碑进度与证据复核互相独立:更新 roadmapStatus 不改复核状态。完成关联任务也不会改里程碑状态。
- 通用记录规则同样适用:新建必须附原文(否则 422);revision 冲突返回 409;admin 可见的记录和证据对 reader 隐藏(403);历史保留每个版本。
- 来源:`src/modules/knowledge.ts`、`src/modules/roadmap.ts`、`tests/roadmap.test.ts`

## 11 接入请求与 Connector 看板

> 机制说明:v1 在保存 Onboarding 记录时把请求导出成目录里的 `request.json`,再定时把 quant 结果投影进本地库,并有拒收规则。这些**v2 由 proposal §6 取代**:请求改为 `omniboard.v_connector_request` 的不可变快照,验证结果直接读 `verification.v_*`。下面只写用户能看到的内容和规则。

### 11.1 请求的产生(Onboarding 记录上的 "Request engineering help")
- 入口:在 Onboarding 记录编辑器里,把 `nextAction` 字段("Request engineering help")设为非 `none` 后保存。取值:
  - `none` "No engineering request"
  - `validate_readonly` "Request a connection check"
  - `prepare_config` "Request connection setup"
  - `propose_adapter_change` "Request a connector change"
- 与请求相关的 Onboarding 字段:
  - venueKey "Provider connection ID":必填,格式 `前缀.名称`,例如 `cex.binance`。去掉前缀后就是请求里的 venue_key。
  - capabilities "Features to connect":必填,逗号分隔,取值 market / wallet / trading / wallet_actions / transfer / asset_network,未知值返回 422。
  - resourceType,取值:
    - api_credentials "API account access"
    - whitelist "Special access approval"
    - low_latency_stream "Faster market data"
    - vip_tier "VIP tier"
    - credit_line "Credit line"
    - colocation "Nearby server hosting"
    - market_data_rights "Market data usage rights"
    - general_access "General account access"
  - resourceStage。
  - accountRef。
  - credentialRef:只接受 `secret://…`。
  - resourceRef。
  - environment "Verification environment":`dev-us` / `dev-cred` / `colo-live`,默认 `dev-cred`。
  - evidenceLevel、expiresOn、businessOwner / technicalOwner。
- 规则:
  - 每个"记录 × 版本"最多一个请求,重放同一版本不会再建。
  - 记录出新版本后只显示新版本的请求:旧版本的请求不再显示,也不再算作阻塞项。
  - 新版本的 nextAction 为 none 时,这条记录就没有当前请求。
- 请求内容(即契约 §4 形状,v2 视图同形):
  - request_id;
  - venue_key;
  - crate_path:缺声明时为 `connector/crates/conn-<venue>`;
  - environment;
  - account:`{name: accountRef 或 "unassigned", kind: "test"}`。只允许 test,production 不合法;
  - requested 叶子列表,每片叶子带 `prerequisites` 和 `awaiting`(资源类型数组);
  - constraints。
- 叶子展开:
  - 能力码对应的通配符:market → `market.*`,wallet → `wallet.*`,trading → `trading.*`,wallet_actions → `wallet_action.*`,transfer → `transfer.*`,asset_network → `asset_network.catalog`。
  - 该 venue 声明了匹配的叶子时,展开为具体叶子;否则保留通配符。
- 前置资源:
  - 非 market 面的叶子都需要 `api_credentials`。
  - 约束也会带来前置资源,只要它的 affects 命中该叶子:
    - entitlement 约束:默认 `vip_tier`,value 里指定了 resource_type 时用指定值;
    - network_route 约束:route=colocation → colocation,private_link → low_latency_stream,其他 → whitelist,value.resource_type 优先。
- 待资源(awaiting):
  - 前置资源在同 venue 的资源台账(该机构的 Onboarding 记录)里没有 granted,就算待资源。api_credentials 还要求填了 accountRef。
  - 同一资源类型有多条记录时,先选环境相同的,再优先选 granted 的。
  - 待资源的叶子照样出现在请求里,标为"待资源"。
- 约束载荷:来自带 sourceId 的 API Optimization / Tech Stack 记录。
  - 完整约束包含 id、kind、scope、value、evidence、sensitivity、collected_at、origin{record_id, revision}、affects、enforcement、exportable。
  - `constraintExportable=no` 或 NDA 敏感级别的约束只包含 id、kind、origin,值不出工作区。
  - 同一机构内 sourceId 唯一,重复返回 409。
- 来源:`src/modules/knowledge.ts`、`src/server/integration/request.ts`、`src/server/integration/ledger.ts`、`src/shared/verification-contract.ts`、`tests/integration-requests.test.ts`、`tests/verification-contract.test.ts`、`tests/work-summary.test.ts`

### 11.2 "Engineering requests" 面板(Onboarding 标签页底部)
- 可折叠,默认收起。
- 标题行:"Engineering requests" + "N request(s)"。有需要处理的请求时加红色徽标 "N need action"(请求 failed 或有阻塞项即算)。
- 说明(v1 原文提到 request.json 和 quant skill;v2 需改写,措辞待核)。
- 空态:"Edit an onboarding record and choose “Request engineering help” to create a request."。加载失败时显示错误原文。
- 请求卡片按创建时间倒序,最多 50 条,每张显示:
  - venueKey + 状态徽标(11.4);
  - "<动作标签> · Record version N";
  - "Request ID" 和 "Build"(创建时 venue 的声明版本,前 12 位);
  - (v1 另有 "Exported to <path> · time",v2 由 proposal §6 取代);
  - 阻塞项:有时显示 "Before engineering can proceed" + 可读列表,没有时显示 "Required information is present. Engineering can review it and run the connection checks; the connection has not been activated.";
  - "Requested leaves":每片叶子显示 feature_key、状态标签、观察时间。状态标签取值:
    - "passed"、"failed"、"skipped"、"No result yet";
    - 通过但过期时显示 "Stale";
    - 待资源时显示 "Awaiting resource: <资源标签, …> · <第一个待资源的负责人 或 'owner not recorded'>";
  - "Verification runs":每个 run 显示 suite · environment · 状态(没有完成时间时显示 running)· build 前 12 位 (dirty) · 各阻塞项 next_step 用 " · " 连接;
  - 可折叠的 "Technical request details":请求 JSON 原文,供人工核对;
  - 创建时间。
- 请求内叶子状态的取值规则:
  - 只看本请求环境、test 账户、非 dirty 的验证结果。本请求自己的结果优先,没有时用同叶子的任何结果。
  - 有 failed 就取 failed。通配符叶子取最差结果(failed > skipped > passed),具体叶子取最新结果。
  - 没有任何结果时,有待资源显示 `awaiting_resource`,否则显示 `no_result`。
- 来源:`src/web/components/IntegrationPlans.vue`、`src/server/integration/state.ts` integrationPlans/leafViews、`tests/integration-requests.test.ts`

### 11.3 阻塞项(读取时计算)与可读文案
| 条件 | 可读文案 |
|---|---|
| venue 没有 connector 声明 | Engineering: add this provider’s connector to the inventory. |
| 所需能力的面未声明(`Missing declared capabilities: …`) | Engineering: add support for <能力名小写, …>. |
| evidenceLevel 不是 CONTRACTED、VERIFIED 或 ENFORCED | Business team: attach written approval or evidence that access works. |
| resourceStage ≠ granted | Business team: confirm that the provider has granted access. |
| 缺 resourceRef | Business team: add the provider’s approval or agreement reference. |
| expiresOn 已过(读取时也会重新检查) | Business team: renew the access approval or review the expired information. |
| 动作不是 propose_adapter_change 且缺 accountRef | Business team: identify the provider account to connect. |
| 请求含 market 以外的能力且缺 credentialRef | Engineering: link the API credentials from the secret store. |
| venue 当前声明版本 ≠ 请求创建时的版本 | Engineering: the connector changed. Save a new request to use the latest version. |

- 来源:`src/server/integration/request.ts` buildRequestPlan、`src/server/integration/state.ts`、`src/web/presentation.ts` readableBlocker

### 11.4 请求状态(派生,不可手改)
- 取值:
  - `queued` "Queued for verification":没有非 dirty 的 run。
  - `running` "Verification running":有非 dirty 的 run 还没有完成时间。
  - `passed` "Verification passed":每个 suite 取开始时间最新的非 dirty run,全部是 passed 且 failed_count=0。
  - `failed` "Verification failed":上述任一不满足,aborted 也算。
- dirty 构建的 run 只进开发视图,不会把请求推出 queued。
- 一个 suite 以最新 run 为准:旧的失败可以被新的通过覆盖。
- 来源:`src/server/integration/state.ts` deriveRequestState、`src/web/presentation.ts` handoffs、`tests/integration-requests.test.ts`(request state derives 用例)

### 11.5 验证结果回流到工作台(用户可见效果)
- 自动生成任务。以下任务都在 engineering track,来源记录指向触发的那条记录。同标题的任务还没完成时不会重复创建。
  - 资源解锁任务:某条 Onboarding 记录这一版首次变为 granted,并且填了 accountRef 或 resourceRef,而本机构当前有请求在等这个资源类型。这时请求按新台账重算待资源,并生成 ready 状态的任务。
    - 标题:"<venue> <资源类型空格化> granted · N leaves can be verified",N 是因此清空待资源的叶子数。
    - 描述列出受影响的请求。下一步为 "Run the re-exported request(s) in quant and wait for the verification results."(v2 措辞待核)。
  - 约束漂移任务:带 sourceId 的 API Optimization / Tech Stack 记录出了新版本(≥2),且该约束曾经进过某个请求。
    - 标题:"Constraint <SRC-id> changed · rev <旧> → <新>"。
    - 描述列出受影响的叶子和请求。下一步为 "Update the SRC: <id> references in quant to rev <新> and re-test the affected leaves."。
- validation 任务附证据:采集到某请求的 passed run(非 dirty、failed=0、已完成)后,本机构未完成的标准 validation 任务的证据换成这个 run,nextStep 改为 "Verification passed: <venue> <suite> on <env> with <account> (run <id>, build <rev>, <time>). Complete this task with the attached evidence."。详情面板随之出现 1.4 第 11 项的一键完成。
- "Needs attention" 告警:工作台数据里的 alerts,在 Connectors 页显示。
  - 请求 failed:标题 "<venue> · Verification failed",详情是去重后的 run 阻塞项 next_step,没有时显示 "Open the request for the failed run."。
  - 已通过但过期的叶子:标题 "<venue> · N verified leaves are stale",详情 "Re-test: evidence is older than D days."。
  - 任务提醒(Overdue / Follow up now)和知识结论冲突/有效期提醒也在同一个 alerts 里,后两类见 8.1。
- 来源:`src/server/integration/hooks.ts`、`src/server/integration/attempts.ts`、`src/server/operations/work.ts`、`tests/integration-requests.test.ts`

### 11.6 Connector 看板:总览矩阵
- 入口:侧栏 "Connectors",路由 `/w/internal/connectors`,所有登录用户可见。
- 内容:
  - 眉标 "QUANT VERIFICATION",标题 "Connectors"。
  - 颜色说明:red = 有叶子失败;amber = 未验证、过期或待资源;green = 全部通过且新鲜;grey = 未声明。
  - 数据时效行(v1 为 "Last projection <time> · <status> · N venues",失败时附错误,"No projection collected yet.","QUANT_PG_URL is not configured on the server.";v2 由 proposal §6 取代,但应保留"数据截至何时"的提示)+ "Stale after D days"(默认 30 天,可配置)。
  - 矩阵:行是 venue(按 venue_key 排序),列依次为 Market data、Wallet events、Wallet actions、Trading、Transfers、Assets and networks,最后一列 "Declared as of"。
    - venue 单元格:venue 名(可点)+ "N leaves"。
    - 面单元格:颜色点 + "P passed · F failed · A awaiting · U unverified"(unverified 包括 no_result、skipped、stale),未声明时显示 "Not declared"。
    - Declared as of:build 前 12 位、"dirty" 标记、声明时间。
  - 面颜色:未声明为 grey;声明了但没有叶子为 amber;否则取叶子里最差的颜色(red > amber > green > grey)。
  - 空态:"No connector declarations projected yet. Run the quant collector first."(v2 措辞待核)。
  - 表格可横向滚动(手机宽度)。
  - "Needs attention" 卡片:只取工作台全局数据里 kind 为 request 或 connector 的告警(11.5),每条显示标题和详情。全局范围只检查有任务的机构。
- 交互:
  - 点 venue 进入 `?venue=<key>`,用 push,可以后退。
  - (v1 另有 admin 专用的 "Refresh from quant" 按钮,触发采集后 3 秒重载;非 admin 调用返回 403。v2 由 proposal §6 取代。)
- 状态:加载错误显示错误原文。
- 来源:`src/web/components/ConnectorsView.vue`、`src/server/connectors.ts`、`src/server/integration/board.ts`、`src/shared/verification-contract.ts`、`tests/integration-requests.test.ts`

### 11.7 Venue 详情
- 入口:`/w/internal/connectors?venue=<key>`。"← All connectors" 返回总览。
- 内容:
  - 标题卡:
    - venue、sourceId · cratePath;
    - "Declared":完整 build、dirty 标记、时间;
    - "Verified":所有非 dirty 结果中最新的观察时间,没有时显示 "No verification result yet";
    - "Runtime":"see Grafana",配置了 Grafana 地址时是外链,在新窗口打开;
    - "Organizations":引用该 venue 的 Onboarding 记录所属的机构,链接到各自的 onboarding 标签页。没有时显示 "No onboarding record refers to this venue yet."。
  - 叶子矩阵:
    - 列为环境 × 账户类型(dev-us、dev-cred、colo-live × test、production)。
    - 列头下注显示该列的 api_credentials 台账情况:"<资源阶段标签> · <负责人 或 'owner not recorded'> · account ref recorded / no account ref";没有记录时显示 "No test account record";production 列固定显示 "Production accounts are not tracked here"。
    - 按面分组。组头显示颜色、面名、汇总和默认代码归属目录:market → `src/market/`,wallet → `src/wallet/`,wallet_action → `src/wallet/actions`,trading → `src/actions/`,transfer → `src/transfer/`,asset_network → `src/asset_network/`。
    - 组内每行一片声明的叶子,feature_key 可点,下面是状态文字(着色):
      - passed / failed / skipped / Stale / No result yet / Awaiting resource;
      - 待资源时显示 "Awaiting resource: <第一个资源> · <负责人>"。
    - 单元格:
      - 没有结果时显示 "—",叶子待资源时为 amber,否则 grey;
      - failed 为 red;
      - passed 且新鲜为 green;
      - 其他(skipped、过期)为 amber,过期的通过显示 "Stale";
      - 悬停显示观察时间。
    - 没有叶子的面显示 "Declared without leaves" 或 "Not declared"。
- 叶子总状态的取值(取该叶子最新的非 dirty 结果):
  - 没有结果:有待资源为 awaiting_resource,否则 no_result;
  - failed → failed;
  - passed:过期为 stale,否则 passed;
  - 其他:有待资源为 awaiting_resource,否则 skipped。
  - 颜色:failed 为 red;passed 且新鲜为 green;其余为 amber。
- 状态:venue 不存在时返回 404 "Connector not found.",页面显示错误。加载中显示 "Loading connector…"。
- 来源:`src/web/components/ConnectorsView.vue`、`src/server/integration/board.ts`、`src/server/integration/ledger.ts` credentialColumns、`tests/integration-requests.test.ts`

### 11.8 叶子详情
- 入口:`?venue=<key>&leaf=<featureKey>`(push)。显示在 venue 详情下方,关闭按钮回到 `?venue=`。
- 内容:
  - 面名、feature_key、状态文字;
  - "Prerequisites":资源标签列表,没有时显示 "none";
  - "Default owner by scaffold-layout":归属目录;
  - "Latest verification rows" 表:Environment / Account kind / Status(附 skip 原因和错误文本)/ Observed / Run / Build(12 位 + dirty)。为空时显示 "No verification result yet"。
  - "Attempts for requests covering this leaf" 表:
    - 列:Request(id + 请求中的写法,例如通配符)/ Suite / Environment · account / Status(没有完成时间时显示 running,附 "passed / failed / skipped" 计数)/ Started / Build / Next step(阻塞项 next_step 连接)。
    - 同一 run id 只显示一次。
    - 为空时显示 "No request has covered this leaf yet."。
- 规则:参数格式不合法或不存在时返回 404 "Leaf not found."。
- 来源:`src/web/components/ConnectorsView.vue`、`src/server/integration/board.ts` leafDetail、`src/server/connectors.ts`、`tests/integration-requests.test.ts`

## 12 v2 新增界面

> 依据 proposal §4–§5 与 [data-model.md](data-model.md)。本节没有 v1 来源;验收以本节和对应的浏览器用例为准。
> 相关裁决(D1–D7,2026-09-29 已定)见 data-model.md 文末。

### 12.1 角色
- 四级,依次包含:`reader` ⊂ `editor` ⊂ `trader` ⊂ `admin`。`reader` / `editor` / `admin` 的 v1 行为不变(2.2)。
- `trader`:editor 的全部权限,加上交易账户(12.7)与 HFT 配置(12.8、12.9)。admin 同样拥有这些权限。
- **影响实盘的操作**:新建账户、改账户标签或白名单、轮换 key、停用账户、保存 HFT 配置、发起 HFT 重启或停止。
  每次都要当场重新输入 TOTP(12.4),写审计(12.10),并给 owner 发通知(12.11)。
- 服务端对这类操作的权限不足返回 403「This action requires the trader role.」;通过 agent 令牌调用返回 403
  「This action requires an interactive session.」。

### 12.2 激活账号(邀请链接)
- 入口:admin 新建成员或重置 TOTP 时生成的一次性链接 `/activate?token=…`,72 小时有效。链接失效、已用或不存在时显示
  「This link has expired or was already used. Ask an administrator for a new one.」。
- 步骤(同一页面,按顺序出现,不能跳过):
  1. 设密码:密码与确认,12–200 字符。重置 TOTP 的链接(`purpose=reset`)跳过这一步。
  2. 绑定验证器:显示二维码和可复制的密钥文本(issuer `Omniboard`,账号为邮箱),输入 6 位验证码确认。错误时
     「The code is incorrect. Check the time on your phone and try again.」。
  3. 恢复码:显示 10 个一次性恢复码,提供复制与下载 `.txt`。勾选「I have saved these codes」后才能继续。
- 完成后直接登录进入机构目录;链接作废。离开页面未完成时,链接仍有效到过期。

### 12.3 登录
- 取代 2.1 的 v1 登录表单。字段:邮箱、密码、验证码(6 位,`inputmode=numeric`,`autocomplete=one-time-code`)。
  验证码框旁有「Use a recovery code」,切换为恢复码输入。
- 任何一项不对都只显示「Email, password or code is incorrect.」,不说明是哪一项。
- 同一账号连续失败 5 次锁定 15 分钟,期间显示「Too many attempts. Try again after {time}.」,并通知 owner;
  同一 IP 每分钟最多 20 次登录请求,超过返回 429。
- 成功后:该成员原有的会话立即失效(另一台设备下次请求得到 401,回到登录页);会话 8 小时后过期,不续期。
- 用恢复码登录成功后,顶部提示「You used a recovery code. N codes left.」;少于 3 个时提示去设置页重新生成。
- `status=disabled` 的成员登录同样只显示通用错误。
- 其余行为(停在原深链、401 回登录页、切换账号清缓存)沿用 2.1。

### 12.4 当场确认(step-up)
- 影响实盘的操作在最后一步弹出对话框「Confirm with your authenticator code」:显示操作摘要(一句话,例如
  「Rotate the key of Binance_hft-01」)和 6 位验证码输入框。
- 验证码与业务请求一起提交,服务端在同一请求里校验;不发放「确认后几分钟内免输」的凭据。
- 同一个验证码(同一时间片)只能用一次,登录用过的也不能再用于确认。错误时对话框保留,显示
  「The code is incorrect.」;连续错 5 次按 12.3 锁定账号并结束会话。
- 恢复码不能用于 step-up。

### 12.5 团队成员页(取代 2.7)
- 入口与权限同 2.7(仅 admin)。
- 列表列:Member、Email、Role、Status(Invited / Active / Disabled)、Last login。按创建时间升序。
- 「Add member」:Name(必填,≤80)、Email(必填,唯一)、Role(四级,各附一句说明)。提交后显示一次性邀请链接和
  复制按钮,说明「Send this link to the member. It expires in 72 hours and is shown only once.」。不再有初始密码。
- 每行的操作菜单:
  - Change role:选择新角色后确认。
  - Disable / Enable:停用时立即结束其会话并吊销其全部 agent 令牌。
  - Reset authenticator:成员状态变为需重新绑定,结束其会话,生成 `purpose=reset` 的邀请链接(显示方式同上)。
    原密码保留。
  - Sign out everywhere:结束其会话。
  - Resend invite:仅 Invited 状态;旧链接作废。
- 规则:
  - 不能改自己的角色、不能停用自己。
  - 至少保留一个 Active 的 admin;违反时返回 409「At least one active administrator is required.」。
  - 所有操作写审计;涉及 trader / admin 角色的变更通知 owner。
  - 邮箱已存在返回 409「This email is already registered.」(同 v1)。

### 12.6 设置页新增:安全与 API 令牌
在 2.9 的 Language 卡片下方增加两张卡片。

**Security**
- Change password:当前密码、新密码、确认;成功后结束其他会话(本会话保留)。
- Regenerate recovery codes:需输入验证码;旧码全部作废,新码显示方式同 12.2 第 3 步。
- 显示剩余恢复码数量。

**API tokens**(agent 用,proposal §5)
- 列表:Name、Role、Created、Expires、Last used、状态(Active / Expired / Revoked)。
- 「Create token」:Name(必填,≤80)、Role(不高于自己的角色;`trader` 不可选,token 最高为 `editor`,admin 可选 `admin`)、
  Expires(7 / 30 / 90 天,默认 30)。创建后只显示一次明文令牌和复制按钮。
- Revoke:确认后立即失效。
- admin 在成员页每个成员的详情里能看到并吊销其令牌。
- 令牌用法:`Authorization: Bearer <token>`;不带 Cookie;不受 Origin 校验(2.1)约束;受同样的角色与可见性规则约束;
  写审计时 `via=agent_token`。

### 12.7 交易账户(`/w/internal/accounts`)
- 入口:侧栏新分组「Trading」下的「Accounts」,trader 与 admin 可见;其他角色访问返回 404,侧栏不显示。
- **列表**:
  - 列:Account(`account_name`,下方小字 `auth_id`)、Exchange、Status、Trading system、Other tags、IP whitelist(条数)、
    Owner、Key(指纹前 8 位,或「Entered before v2」)、Last change(来自审计,「—」表示 v2 之前)。
  - Status 由标签派生,按优先级取第一个:Terminated → Read-only → Test → Initializing → Live。
  - 筛选:Exchange、Status、Trading system、文本搜索(账户名、Owner)。默认隐藏 Terminated,开关「Show terminated」。
  - 没有任何密钥明文或部分明文出现在列表、详情、审计、日志中。
- **详情抽屉**(点行打开,`?account=<auth_id>`):
  - 全部字段、标签原样 JSON(折叠,供核对)、`verified_auth_tags` 与更新时间(只读,Omnitra 写入;为空时不显示)。
  - 本账户的审计记录,时间倒序。
  - 关联的 Onboarding 记录(`accountRef = account_name` 的记录),链接到机构的 onboarding 标签页。
  - 操作按钮:Edit、Rotate key、Terminate。Terminated 的账户只保留查看。
- **新建账户**(「Add account」,对话框):
  - Exchange:下拉,取值见 data-model 5.1。
  - Account name:必填,去掉首尾空白后非空;下方实时预览 `auth_id`。
  - Trading system:Quant / HFT / None。
  - Account type:Live / Test / Read-only(单选,对应不加标签 / `Test` / `ReadOnly`)。
  - Other tags:Unified、Low-latency account、Arbitrage account、Additional leverage risk limits、Initializing(复选);
    VIP level、Market maker level(0–255 整数,可空);Portfolio group、Client name(文本,可空)。
  - IP whitelist:每行一个 IPv4 / IPv6 地址;「Add known egress IP」按钮从 `known_egress_ips` 选择。Test 以外必填。
  - API key、API secret(必填)、Passphrase(可空):密码型输入框,`autocomplete=off`,不进草稿(2.12),提交后立即清空。
  - Link onboarding record(可选):列出 `resourceType=api_credentials`、venue 与所选 Exchange 匹配、尚未 granted 的
    Onboarding 记录。选中后,保存时同一事务给该记录写新版本:`resourceStage=granted`、`accountRef=account_name`
    (proposal §5)。
  - Owner:文本,可空。
  - 保存 → 12.4 确认 → 成功后关闭并打开新账户的详情。
- **Edit**:可改 Trading system、Account type、Other tags、IP whitelist、Owner;Exchange 与 Account name 只读。
  保存前显示改前 / 改后对照(只列有变化的字段),再进入 12.4。
- **Rotate key**:输入新的 API key、secret、passphrase(三项一起替换);说明「The old key stops working for our
  systems immediately. Revoke it on the exchange after the new key is confirmed.」。成功后指纹更新。
- **Terminate**:输入账户名确认;加 `Terminated` 标签。说明「Trading systems stop using this account on their next
  reload. This does not revoke the key on the exchange.」。
- **校验**(前端与服务端相同,见 data-model 5.1):
  - 可交易账户(不是 Test / Read-only / Terminated)必须选 Trading system。
  - 重复 `auth_id` → 409「This account already exists.」。
  - 白名单某行不是 IP → 行内提示「Not a valid IP address.」。
  - DB 约束拒绝时显示「The database rejected this change: {约束名}」,并保持对话框内容不丢。

### 12.8 HFT 配置(`/w/internal/hft`)
- 入口:侧栏「Trading」下的「HFT config」,trader 与 admin 可见,其他角色 404。
- **列表**:每个 channel 一张卡片,显示 portfolio group、max active groups、三个组合级上限、组覆盖条数、`update_at`。
- **Channel 页**(`?channel=<name>`):
  - 顶部提示:「Changes take effect after HFT restarts. The running process keeps the limits it started with.」
    第二批有 launcher 后,若 `update_at` 晚于当前进程启动时间,显示醒目的「Changed · restart required」(D4)。
  - 组合级字段:Portfolio group、Max active groups、Max portfolio gross exposure (USD)、Max portfolio |net| exposure (USD)、
    Max wallet gross / assets ratio。每个字段旁有约束说明(data-model 5.2)。
  - 组覆盖表:Prediction group、Max gross exposure (USD)、Max |net| exposure (USD);可增、改、删行;Prediction group 输入框
    提示已有组名,也可以新填。没有覆盖的组使用 channel 默认值,表下注明这一点。
  - 保存:显示改前 / 改后对照(含组覆盖的新增、删除、修改),→ 12.4 → 一个事务写入(data-model 5.2)。
  - 数值按完整精度显示与输入,不做紧凑缩写。
- 「Add channel」:填写全部组合级字段,新建一行。不提供删除 channel。
- 409:保存时发现 `update_at` 与打开时不同,提示「This channel changed since you opened it. Reload to see the latest
  values.」,不覆盖。

### 12.9 HFT 重启(第二批,依赖 `hft-launcher`)
- 位置:Channel 页顶部的「Process」卡片。
- 内容:当前进程(来自最新一条 `done` 的 restart 请求):PID、Run mode、Build(12 位 + dirty 标记)、Started;
  没有时显示「Process state unknown」。下方列出最近 10 条请求及其状态和原因。
- 「Restart」:必须显式选择 Run mode(Read-only / Live / De-risk only,无默认值);显示提示「Check that the previous
  de-risk run has finished.」(proposal §10,不作硬门槛)→ 12.4 → 写一条 pending 请求。
- 「Stop」:确认后 → 12.4 → 写一条 pending 请求。
- 同一 channel 已有 pending / running 请求时两个按钮禁用,显示该请求的进度。
- 请求状态:pending「Waiting for launcher」→ running「Restarting」→ done / rejected(显示 launcher 写回的原因)/ failed。
  页面在有未完成请求时每 5 秒刷新一次。

### 12.10 审计日志(`/w/internal/audit`)
- 入口:侧栏 Administration 下的「Audit log」,仅 admin。
- 列表:Time、Actor(令牌调用时加「via token <name>」)、Action(可读标签)、Target、Step-up(✓)、Notification
  (Sent / Failed / —)。时间倒序,每页 50 条。
- 筛选:Actor、Action 类别(Accounts / HFT / Members / Tokens / Login)、Target 文本、时间范围。筛选写在 URL query。
- 展开一行显示改前 / 改后字段对照;密钥列只显示「changed」。
- 只读,没有删除或编辑入口。

### 12.11 通知邮件
- 收件人:owner(`OMNIBOARD_NOTIFY_TO`,可多个)。触发:12.1 列出的影响实盘的操作、成员角色涉及 trader / admin 的变更、
  停用成员、重置验证器、登录锁定。
- 内容:操作人、时间(UTC)、动作、目标、改前 / 改后摘要(不含密钥)、审计链接。标题前缀 `[Omniboard]`。
- 发送在事务提交之后;失败不回滚业务操作,在审计里记为 Failed(D5)。

### 12.12 导航与路由增补
- 侧栏在 Connectors 之后新增分组「Trading」:Accounts、HFT config(trader / admin 可见)。Administration 分组增加
  Audit log(admin)。
- 路由增补:`/activate`(未登录可访问)、`/w/internal/accounts`(`?account=`)、`/w/internal/hft`(`?channel=`)、
  `/w/internal/audit`。
- 面包屑页名增补:Accounts、HFT config、Audit log。

## 附录 A 批量导入规则(v1 为 CLI;v2 由 agent API 承接)

- 入口：`scripts/import-public-research.ts`、`import-organization-profiles.ts`、`import-business-research.ts`、`import-enrichment.ts`，以及 bitget 团队报告导入。均为 CLI。
- 规则：
  - **目标必须精确**：用 来源 + slug（`targets` 数组或单个 `target`，二者不能同时出现），或 `name:<精确机构名>`。不做模糊匹配；没匹配上的记录在报告中列为 unmatched。
  - **幂等**：以 dataset + 机构 + tab + 稳定 key 作为导入标识。重复导入新增 0 条，**不会覆盖**商务后来手工修改的记录，已有简介也保留，只在报告中提示。
  - 来源原文按字节保存；每个来源必须提供 text 或 path 之一；URL 必须是 HTTPS。来源类型：the_org / x / official_website / public_profile。联系人来源自动映射：The Org → public_directory；X 或公开个人资料 → public_social；官网 → official_website。
  - 人员汇报线的类型：The Org 上标 Unverified 的写为 `unconfirmed`（图中显示虚线）；只有明确证实的写为 confirmed。人物本身被 confirmed 不会让其汇报关系自动变成实线。
  - 同名人员只在同一机构内做唯一匹配（Unicode 规范化、空白归一、不区分大小写）。出现多个匹配或与受限记录冲突时整批停止。
  - 写入前对整批做预检：目标、来源、重复、日期、邮箱、URL、缺失的关系依据、跨机构或不可见的上级、循环汇报。任何一项失败都整批不写。
  - 人员流动：日期为 `YYYY-MM-DD` / `YYYY-MM` / 空；datePrecision 必须与日期一致；dateLabel 保存来源里的原始时间措辞；公告日不当作生效日。
- 来源：`docs/public-research.md`，`docs/business-roles.md`，`docs/connectivity-providers.md`，`tests/public-research.test.ts`，`tests/enrichment.test.ts`，`tests/bitget-team-report.test.ts`，`tests/business-roles.test.ts`，`tests/connectivity.test.ts`

## 待核

- 非 admin 直接访问 admin 资源:v1 有的返回 403、有的返回 404(0.2),v2 统一口径。
- 非 admin 从别的页面切换进 `/members`:v1 只出空表,首次直接打开才报错(2.7)。v2 由 proposal §4 重做成员页时一并定。
- 旧参数 `rankedOnly`:服务端仍接受,前端只做清理(3.2)。v2 可以不接受。
- 情报收件箱的 `preview` 模式("FOLLOW THE SIGNAL"、每批 4 条、"View all")在 v1 找不到挂载点;列出全部列
  (含无值列)的指标视图也没有调用方。v2 默认不做。
- 由履历生成的变动在条件取消后,记录保留、类型清空,界面上怎么显示(6.14)。
- v1 措辞引用了导出目录或 quant 采集的几处,v2 需改写:Engineering requests 面板说明(11.2)、资源解锁任务的
  下一步(11.5)、Connector 看板的空态与数据时效行(11.6)。

## 已排除

已被推翻、被 proposal 取代或 v1 自己已废弃的内容,不进入 v2:

- **存储与运维**:SQLite 备份/恢复与 rehearse 流程;服务 PID 锁(改用 PG advisory lock);运行时数据目录
  `data/enrichment/…` 下的样本与回放。
- **quant 交接**:请求导出目录(`CONNECTOR_EXPORT_DIR`、`request.json` 落盘、`request.superseded-*`);
  quant 只读视图的定时投影、手动 "Refresh from quant"、`quant_pg` 来源与 `collect:quant`、投影拒收规则
  (schema_version、venue 数下降 80%);正则读 quant Rust 源码的能力导入;venue dossier 导入(`connector_profiles`)。
- **一次性脚本**:交易所合并修复(consolidate-exchanges)。
- **v1 文档已写明移除的设计**:
  - 工作台、机构目录、人才目录的「命名保存视图」(`/work/views`),活动历史的已读与计数(`/work/seen`),
    由 2.11 的自动记忆取代;
  - 旧 "Focus" 分区(本人/团队范围切换、Needs attention/Recent changes 分栏),由 "Work to move forward" 取代;
  - 机构内六视图导航和独立的「重点任务 / 需关注」入口;
  - 目录行多选、独立 Stats tab、目录的排序方向按钮与「只看有排名」复选框;
  - 旧 handoff 状态 `blocked` / `ready_for_validation`(被派生请求状态取代);
  - 人才目录「未关联记录标为待关联 / 按身份状态筛选」(被 docs/personnel-profiles.md 取代);
  - 关系图「按名字排队 + 固定曲线」旧布局;
  - 「应用文案只有英文」的早期约束(被三语言取代)。
- **数据**:CMC/CoinGecko 采集历史不迁移;采集**功能保留**,v2 重新采集(9.7)。
