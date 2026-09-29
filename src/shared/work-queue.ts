// 工作台的提醒、分组与排序(frontend-spec 10.2、10.3),从 v1 src/modules/work-queue.ts 迁移。
import type { WorkTask } from './operations';
import { isFinished, onboardingTemplate } from './operations';

export function taskAttention(task: WorkTask, today = new Date().toISOString().slice(0, 10)) {
  if (isFinished(task.state)) return [];
  const reasons: string[] = [];
  if (task.dueOn && task.dueOn < today) reasons.push('Overdue');
  if (task.displayState === 'waiting' && task.followUpOn && task.followUpOn <= today)
    reasons.push('Follow up now');
  return reasons;
}

export function actionableTask(task: WorkTask, today?: string) {
  return (
    !isFinished(task.state) &&
    (['ready', 'active'].includes(task.displayState) || taskAttention(task, today).length > 0)
  );
}

export function taskGroup(task: WorkTask, today?: string) {
  if (taskAttention(task, today).length) return 'Follow up now';
  if (isFinished(task.state)) return 'Completed / Not needed';
  return {
    active: 'In progress',
    ready: 'Ready to start',
    waiting: 'Waiting for a response',
    blocked: 'Waiting for prerequisites',
    planned: 'Planned',
  }[task.displayState as 'active' | 'ready' | 'waiting' | 'blocked' | 'planned'];
}

export function orderWorkTasks(tasks: WorkTask[], today?: string) {
  const groups = [
    'Follow up now',
    'In progress',
    'Ready to start',
    'Waiting for a response',
    'Waiting for prerequisites',
    'Planned',
    'Completed / Not needed',
  ];
  const order = (task: WorkTask) => {
    const index = onboardingTemplate.findIndex((t) => t.key === task.templateKey);
    return index < 0 ? onboardingTemplate.length : index;
  };
  return [...tasks].sort(
    (a, b) =>
      groups.indexOf(taskGroup(a, today)) - groups.indexOf(taskGroup(b, today)) ||
      (a.dueOn || a.followUpOn || '9999').localeCompare(b.dueOn || b.followUpOn || '9999') ||
      order(a) - order(b) ||
      a.id.localeCompare(b.id),
  );
}

export function matchesWorkState(task: WorkTask, state: string, today?: string) {
  if (state === 'actionable') return actionableTask(task, today);
  if (state === 'open') return !isFinished(task.state);
  return !state || task.displayState === state;
}
