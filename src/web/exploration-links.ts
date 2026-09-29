// 图谱名称链接(frontend-spec 7.7)。目标规则在 shared/exploration-navigation.ts;人才库(6.9)移植之前,
// 指向 /w/internal/talent 的人员链接不显示,名称只作纯文本,卡片仍可点来探索连接。
import type { ExplorationNode } from '../shared/exploration';
import { explorationDestination } from '../shared/exploration-navigation';
export function profileLink(node: ExplorationNode): string | undefined {
  const target = explorationDestination(node);
  return target?.startsWith('/w/internal/talent') ? undefined : target;
}
