// 标准任务的默认下一步与完成条件、完成后的下游影响(frontend-spec 10.4、10.5),
// 从 v1 src/modules/focus.ts 迁移。v1 的 focusTasks(旧 Focus 分区)已由 "Work to move forward" 取代,不迁移。
import type { WorkTask, TaskActionResult } from './operations';
import { isFinished } from './operations';

// Planning guidance only. It does not assert that a provider has granted access.
export const taskGuidance: Record<string, { nextStep: string; completionCriteria: string }> = {
  scope: {
    nextStep: 'Write down our legal entity, operating region and required products.',
    completionCriteria:
      'A scoped account request with the entity, region, account type and products recorded.',
  },
  contacts: {
    nextStep: 'Find one relevant contact and record their role and source.',
    completionCriteria:
      'Business and technical contact routes recorded, or missing routes explicitly handed over.',
  },
  terms: {
    nextStep: 'Capture the fee tier, borrowing terms or special resource relevant to our scope.',
    completionCriteria:
      'Applicable commercial terms and remaining unknowns documented with their sources.',
  },
  eligibility: {
    nextStep: 'Check the selected products against our entity and region.',
    completionCriteria:
      'An eligibility decision with its scope, restrictions and original supporting evidence.',
  },
  account: {
    nextStep: 'Submit the scoped account request through the confirmed contact route.',
    completionCriteria:
      'Account access approved or demonstrated, with applicable conditions and expiry recorded.',
  },
  resources: {
    nextStep: 'Ask which API permissions and special resources are enabled for our account.',
    completionCriteria:
      'Granted permissions and restrictions recorded from evidence; unnecessary requests explicitly waived.',
  },
  docs: {
    nextStep: 'Map required market data and trading operations to documented interfaces.',
    completionCriteria:
      'Interface choices, limits, configuration needs and unresolved gaps recorded.',
  },
  implementation: {
    nextStep: 'Link the connector change and record the checks performed.',
    completionCriteria:
      'A code revision or pull request, required configuration and check results recorded.',
  },
  validation: {
    nextStep: 'Run the agreed connection checks in the intended account and environment.',
    completionCriteria:
      'Test results, environment, account scope and code revision saved with original evidence.',
  },
};
/** "What this enables"(10.4 第 9 项):本任务是唯一剩余前置的下游,以及还有别的前置的下游。 */
export function taskImpact(task: WorkTask, tasks: WorkTask[]): TaskActionResult {
  const pending = tasks.filter((t) => t.dependencies.includes(task.id) && !isFinished(t.state));
  return {
    taskId: task.id,
    state: task.state,
    unlocked: pending
      .filter((t) => t.blockers.length === 1 && t.blockers[0]?.id === task.id)
      .map((t) => ({ id: t.id, title: t.title })),
    remaining: pending
      .filter((t) => t.blockers.some((b) => b.id !== task.id))
      .map((t) => ({
        id: t.id,
        title: t.title,
        blockers: t.blockers.filter((b) => b.id !== task.id),
      })),
  };
}
