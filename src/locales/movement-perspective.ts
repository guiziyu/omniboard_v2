import type { Message } from './index';
const messages: Message[] = [
  ['Moved organizations', '转任', '이직'],
  [
    'Moved from one organization to another',
    '从一家机构转任另一家机构',
    '한 기관에서 다른 기관으로 이직',
  ],
  ['{0} sources · one movement', '{0} 份来源 · 同一次变动', '출처 {0}개 · 동일 인사 이동'],
  ['Other sources for this movement', '这次变动的其他来源', '이 인사 이동의 다른 출처'],
  [
    'Linked from adjacent roles in the same profile. Matching months or years do not establish an exact transition day or exclude an employment gap.',
    '根据同一履历中前后衔接的任职关联；月份或年份相同不代表已知准确交接日，也不能排除任职空档。',
    '동일 프로필의 인접 경력을 연결했습니다. 같은 월이나 연도라도 정확한 전환일이나 공백 없는 근무를 의미하지 않습니다.',
  ],
  ['Other updates', '其他动态', '기타 소식'],
  [
    'Not classified as a join, departure or role change for this organization',
    '不计入该机构的入职、离职或岗位变动',
    '이 기관의 입사, 퇴사 또는 직무 변경으로 분류되지 않습니다',
  ],
  ['Movements relative to {0}', '以 {0} 为视角展示人员流动', '{0} 기준 인사 이동'],
  ['Search people, organizations or roles', '搜索人员、机构或岗位', '인물, 기관 또는 직무 검색'],
  ['Announcement date', '公告日期', '발표일'],
  ['Effective date', '生效日期', '시행일'],
  ['Source date', '来源日期', '출처 날짜'],
  ['Date meaning not specified', '日期含义未注明', '날짜 의미 미지정'],
  ['Source headline', '来源标题', '출처 제목'],
  [
    'This is the announcement date, not an established joining or departure date.',
    '这是公告日期，不能据此认定准确入职或离职日期。',
    '발표일이며 정확한 입사일이나 퇴사일을 의미하지 않습니다.',
  ],
  ['Event described by source', '来源描述的事件', '출처에 기술된 사건'],
  ['Date meaning', '日期含义', '날짜 의미'],
  [
    'In {0}, this will appear as: {1}',
    '在 {0} 中将显示为：{1}',
    '{0}에서 다음과 같이 표시됩니다: {1}',
  ],
];
export default messages;
