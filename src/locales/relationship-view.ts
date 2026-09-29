import type { Message } from './index';
const messages: Message[] = [
  ['Open profile: {0}', '打开档案：{0}', '프로필 열기: {0}'],
  ['Explore connections for {0}', '探索 {0} 的关系', '{0}의 연결 탐색'],
  ['Related organizations', '关联机构', '관련 기관'],
  ['People and roles', '人员与岗位', '인물 및 역할'],
  ['Show record associations', '显示资料关联线', '자료 연결선 표시'],
  [
    'No business relationships are recorded in this view. Explore the associated objects below.',
    '当前视图暂无业务关系记录，可从下方关联对象继续探索。',
    '현재 보기에 기록된 업무 관계가 없습니다. 아래 연결된 객체를 탐색하세요.',
  ],
  [
    '{0} objects with source associations only',
    '{0} 个仅通过资料关联的对象',
    '자료로만 연결된 객체 {0}개',
  ],
  [
    'These objects have records linked to this organization. This does not establish a reporting, employment or business relationship.',
    '这些对象的资料涉及该机构，并不代表已确认汇报、任职或合作关系。',
    '이 객체의 자료는 해당 기관과 연결되어 있지만 보고, 고용 또는 업무 관계가 확인되었다는 의미는 아닙니다.',
  ],
  ['Expand by object type', '按类型展开', '유형별 펼치기'],
  ['Accounts', '账户', '계정'],
  ['Provider capabilities', '服务商能力', '제공업체 기능'],
  ['Resources and approvals', '资源与权限', '리소스 및 권한'],
  ['Show source nodes', '展开来源节点', '출처 노드 표시'],
  ['Fit graph', '适应画布', '화면에 맞추기'],
  ['Expand canvas', '扩大画布', '캔버스 확대'],
  ['Compact canvas', '收起画布', '캔버스 축소'],
  [
    'Open a name to view its profile. Select the card to explore connections, or a line to read its evidence.',
    '点击姓名或机构名打开档案，点击卡片探索关系，点击连线查看证据。',
    '이름을 클릭하면 프로필이 열립니다. 카드를 선택하면 연결을 탐색하고, 선을 선택하면 근거를 볼 수 있습니다.',
  ],
  ['Arranging relationships…', '正在排列关系…', '관계를 배치하는 중…'],
  [
    'The graph could not be arranged. Your data is unchanged.',
    '关系图加载失败，数据未受影响。',
    '관계 그래프를 배치하지 못했습니다. 데이터는 변경되지 않았습니다.',
  ],
  ['Connections on the canvas', '画布中的连线', '캔버스 연결'],
  ['View {0} source records for {1}', '查看 {1} 的 {0} 条来源资料', '{1}의 출처 자료 {0}개 보기'],
  ['{0} sources', '{0} 条来源', '출처 {0}개'],
  [
    'No connections match these filters. Expand another type or include history.',
    '当前筛选下没有关联对象。可展开其他类型或包含历史关系。',
    '현재 필터에 맞는 연결이 없습니다. 다른 유형을 펼치거나 과거 관계를 포함하세요.',
  ],
  ['{0} relationships on the canvas', '画布中的 {0} 条业务关系', '캔버스의 업무 관계 {0}개'],
  ['Hide object browser', '收起对象列表', '객체 목록 숨기기'],
  ['Find an object', '查找对象', '객체 찾기'],
];
export default messages;
