import type { Message } from './index';
export default [
  ['Reset filters', '重置筛选', '필터 초기화'],
  ['Open source information', '打开关联情报', '관련 정보 열기'],
  [
    'Move tasks forward, follow up on responses and resolve blockers.',
    '推进任务、跟进回复、处理阻碍。',
    '작업을 진행하고 답변을 확인하며 장애 요인을 해결하세요.',
  ],
  [
    'Read updates, review evidence and decide what needs action.',
    '阅读更新、核实证据，判断下一步行动。',
    '업데이트와 근거를 검토하고 다음 행동을 결정하세요.',
  ],
  [
    'Shows the latest 100 changes you can access in the selected scope.',
    '显示当前范围内你有权限查看的最近 100 条变更。',
    '선택한 범위에서 접근 가능한 최근 변경 100건을 표시합니다.',
  ],
  ['No activity in this scope.', '当前范围暂无活动记录。', '현재 범위에 활동 기록이 없습니다.'],
  ['Tasks', '任务', '작업'],
  ['Next actions', '下一步行动', '다음 실행 항목'],
  [
    'Move this organization forward. Open a task to update its progress.',
    '推进与这个机构的合作，打开任务即可更新进展。',
    '이 기관과의 협업을 진행하세요. 작업을 열어 진행 상황을 업데이트할 수 있습니다.',
  ],
  [
    'Move tasks forward and review the information behind them.',
    '推进任务，核实支持决策的信息。',
    '작업을 진행하고 의사결정을 뒷받침하는 정보를 검토하세요.',
  ],
  ['Open in workbench', '在工作台查看', '워크벤치에서 보기'],
  ['Work sections', '工作内容', '업무 영역'],
  ['Work to move forward', '待推进任务', '진행할 작업'],
  ['All open tasks', '全部未完成任务', '모든 미완료 작업'],
  ['View dependencies', '查看依赖', '의존 관계 보기'],
  ['Task layout', '任务布局', '작업 레이아웃'],
  [
    'No tasks to move forward in this scope',
    '当前范围没有待推进任务',
    '현재 범위에 진행할 작업이 없습니다',
  ],
  [
    'Waiting and completed tasks remain available under All tasks.',
    '等待中和已完成的任务可在完整任务列表中查看。',
    '대기 중이거나 완료된 작업은 전체 작업 목록에서 볼 수 있습니다.',
  ],
  ['Show next actions', '收起完整计划', '전체 계획 접기'],
  ['Show full plan ({0} tasks)', '展开完整计划（{0} 项任务）', '전체 계획 보기 (작업 {0}개)'],
  ['{0} more tasks in the plan', '计划中还有 {0} 项任务', '계획에 작업 {0}개 더 있음'],
  [
    'Task, object and evidence changes',
    '任务、对象与证据的修改记录',
    '작업, 객체 및 근거 변경 기록',
  ],
  [
    'History is separate from work that needs action.',
    '这里保留修改记录，待办事项请在任务和情报中处理。',
    '변경 기록입니다. 실행이 필요한 항목은 작업과 정보에서 처리하세요.',
  ],
  ['Task dependencies', '任务依赖关系', '작업 의존 관계'],
  [
    'Dependencies include prerequisites outside your task filters.',
    '为完整呈现前置条件，依赖图包含被当前任务筛选隐藏的步骤。',
    '선행 조건을 모두 보여주기 위해 현재 필터에서 제외된 작업도 표시합니다.',
  ],
  ['Evidence to review', '待复核证据', '검토할 근거'],
  [
    'Conflicts and validity checks remain here until the evidence is resolved. Reading does not resolve them.',
    '信息冲突和有效期问题会持续保留，直到证据得到处理；已读不代表已解决。',
    '정보 충돌과 유효 기간 문제는 근거를 검토할 때까지 유지됩니다. 읽음 처리는 해결을 의미하지 않습니다.',
  ],
] satisfies Message[];
