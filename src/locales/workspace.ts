import type { Message } from './index';
// v2 移植时新增或改写的通用页面文案。
export default [
  ['Open', '打开', '열기'],
  [
    'Only matching units and reporting periods are eligible. Values are never averaged or converted.',
    '只有单位和报告期一致的值才参与排名。不会求平均，也不会换算。',
    '단위와 보고 기간이 맞는 값만 순위에 포함됩니다. 평균을 내거나 환산하지 않습니다.',
  ],
  ['Compliance rules', '合规规则', '컴플라이언스 규칙'],
  [
    'Each request is saved for the quant skill, which reads it by its request ID. Its state comes from the live-test runs quant records for that ID; this app never runs a check itself.',
    '每个请求都会保存下来，供 quant 的 skill 按请求 ID 读取。请求状态来自 quant 为该 ID 记录的实盘测试结果；本应用自己不会运行检查。',
    '각 요청은 quant 스킬이 요청 ID로 읽을 수 있도록 저장됩니다. 상태는 quant가 그 ID로 기록한 실거래 테스트 결과에서 가져오며, 이 앱은 직접 검사를 실행하지 않습니다.',
  ],
  [
    'Reissued after a resource was granted; replaces {0}',
    '资源获批后重新签发；替代 {0}',
    '리소스가 승인된 뒤 다시 발급됨. {0}을(를) 대체',
  ],
  ['Intelligence queue', '情报队列', '정보 대기열'],
  [
    'Move {0} to {1}. Release to review.',
    '把 {0} 移到 {1} 下。松开后核对。',
    '{0}을(를) {1} 아래로 옮깁니다. 놓으면 검토 화면이 열립니다.',
  ],
  ['{0} access approvals recorded', '已记录 {0} 项权限批准', '접근 승인 {0}건 기록됨'],
  [
    '{0} live account checks recorded',
    '已记录 {0} 次实盘账户检查',
    '실거래 계정 확인 {0}건 기록됨',
  ],
  [
    'Declared features and live-test results read from the quant verification views. Colours follow the contract: red = a leaf failed, amber = unverified, stale or awaiting a resource, green = all passed and fresh, grey = not declared.',
    '已声明的功能和实盘测试结果，读自 quant 的验证视图。颜色按契约：红 = 有叶子失败；琥珀 = 未验证、已过期或在等资源；绿 = 全部通过且未过期；灰 = 未声明。',
    '선언된 기능과 실거래 테스트 결과를 quant 검증 뷰에서 읽어 옵니다. 색상은 계약을 따릅니다: 빨강 = 실패한 항목 있음, 주황 = 미검증·오래됨·리소스 대기, 초록 = 모두 통과했고 최신, 회색 = 선언되지 않음.',
  ],
  [
    'Data as of: latest declaration {0} · latest verification {1}',
    '数据截至：最新声明 {0} · 最新验证 {1}',
    '데이터 기준: 최신 선언 {0} · 최신 검증 {1}',
  ],
  ['none yet', '暂无', '아직 없음'],
  [
    'No connector declaration has been recorded by quant yet.',
    'quant 还没有记录任何 connector 声明。',
    'quant가 아직 커넥터 선언을 기록하지 않았습니다.',
  ],
  ['{0} leaves', '{0} 个叶子', '항목 {0}개'],
  [
    'No connector declarations yet. quant records them when a connector build runs its catalog snapshot.',
    '还没有 connector 声明。connector 构建运行目录快照时，quant 会记录它们。',
    '아직 커넥터 선언이 없습니다. 커넥터 빌드가 카탈로그 스냅샷을 실행하면 quant가 기록합니다.',
  ],
  ['Breadcrumb', '面包屑导航', '이동 경로'],
  ['Actions', '操作', '작업'],
  [
    'No source profiles match this filter.',
    '没有符合这个筛选条件的来源档案。',
    '이 필터에 맞는 출처 프로필이 없습니다.',
  ],
] satisfies Message[];
