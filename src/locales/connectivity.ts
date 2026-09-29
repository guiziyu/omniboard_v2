import type { Message } from './index';
export default [
  ['routes', '条线路', '개 경로'],
  ['PoPs', '个接入点', '개 접속 지점'],
  [
    'Use the latest saved observation with the selected unit and reporting period. Inspect its original source and scope.',
    '使用所选单位和期间的最新已保存数据；请查看其原始来源与适用范围。',
    '선택한 단위와 보고 기간에 해당하는 가장 최근 저장 값을 사용합니다. 원본 출처와 적용 범위를 확인하세요.',
  ],
  ['Connectivity Provider', '低延迟网络供应商', '저지연 네트워크 공급자'],
  ['Connectivity Providers', '低延迟网络供应商', '저지연 네트워크 공급자'],
  ['Coverage regions', '覆盖地区数', '지원 지역 수'],
  ['Network routes', '网络线路数', '네트워크 경로 수'],
  ['Network PoPs', '网络接入点数', '네트워크 접속 지점 수'],
  ['Network markets', '覆盖市场数', '지원 시장 수'],
  [
    'Documented coverage across six geographic groups: North America, Latin America, Europe, Middle East, Africa and Asia-Pacific. Partial coverage lists are lower bounds. These are not cloud regions, countries or PoPs.',
    '按北美、拉美、欧洲、中东、非洲、亚太六个地理区域统计。公开列表不完整时标为至少覆盖的数量，不等同于云区域、国家或网络接入点数。',
    '북미, 중남미, 유럽, 중동, 아프리카, 아시아 태평양의 6개 지역을 기준으로 집계합니다. 일부만 공개된 목록은 최솟값으로 표시합니다. 클라우드 리전, 국가 또는 PoP 수와 다릅니다.',
  ],
  [
    'Documented point-to-point transport routes, counting a bidirectional corridor once. This is not the number of customer circuits, PoPs or possible endpoint pairs. Partial published lists retain a lower-bound qualifier.',
    '公开的点对点传输线路，双向线路计为一条。不等同于客户专线合同数、接入点数或端点的所有可能组合。仅公开部分线路时保留“至少”标记。',
    '공개된 지점 간 전송 경로이며 양방향 경로는 하나로 집계합니다. 고객 회선 계약, PoP 또는 가능한 모든 지점 조합의 수가 아닙니다. 일부만 공개된 경우 최솟값으로 표시합니다.',
  ],
  [
    'Provider-reported network points of presence. A PoP is a network access site, not a route, a geographic region or necessarily an owned data center.',
    '供应商公布的网络接入点（PoP）数量。接入点不等同于线路、地理区域，也不一定是自有数据中心。',
    '공급자가 공개한 네트워크 접속 지점(PoP) 수입니다. PoP는 경로나 지역이 아니며 자체 소유 데이터 센터를 뜻하지도 않습니다.',
  ],
  [
    'Provider-reported markets reached by the connectivity service. Open the source definition; countries, cities and trading venues are not interchangeable.',
    '供应商公布的网络服务覆盖市场数。请点击数值查看来源口径；国家、城市和交易场所不能混为同一指标。',
    '공급자가 공개한 연결 서비스 지원 시장 수입니다. 출처의 정의를 확인하세요. 국가, 도시, 거래 시장은 서로 다른 기준입니다.',
  ],
] satisfies readonly Message[];
