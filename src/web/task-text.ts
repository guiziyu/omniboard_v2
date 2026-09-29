// 任务文本的显示(frontend-spec 10.5):没改过的标准模板文本随界面语言翻译,用户改过的保留原文。
// 从 v1 src/web/task-text.ts 迁移。
import { onboardingTemplate, type WorkTask } from '../shared/operations';
import { taskGuidance } from '../shared/focus';
import { tr } from './i18n';

type TaskTextField = 'title' | 'description' | 'nextStep' | 'completionCriteria';
/** Translate unchanged system defaults for display only. User edits and stored evidence stay intact. */
export function taskText(task: WorkTask, field: TaskTextField = 'title'): string {
  const value = task[field];
  if (task.origin !== 'standard') return value;
  const template = onboardingTemplate.find((item) => item.key === task.templateKey);
  const guidance = taskGuidance[task.templateKey];
  const standard =
    field === 'title' || field === 'description' ? template?.[field] : guidance?.[field];
  return standard === value ? tr(value) : value;
}
export function taskReference(task: { id: string; title: string }, tasks: WorkTask[]): string {
  const full = tasks.find((item) => item.id === task.id);
  return full ? taskText(full) : task.title;
}
export const taskOwner = (task: WorkTask) => (task.ownerId ? task.ownerName : tr('Unassigned'));
