// 关系页视图状态的记忆与返回(frontend-spec 7.8),从 v1 src/web/composables/useExplorationView.ts 迁移。
import { onBeforeUnmount, reactive, toRaw, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { relationshipKinds, type RelationshipKind } from '../shared/relationship-view';
import { session } from './api';

export interface GraphViewState {
  focusId: string;
  depth: number;
  limit: number;
  zoom: number;
  kinds: RelationshipKind[];
  showSources: boolean;
  showAssociations: boolean;
  expanded: boolean;
  associationsOpen: boolean;
  relationshipsOpen: boolean;
  positioned: boolean;
  left: number;
  top: number;
}
interface ExplorationViewState {
  search: string;
  kind: string;
  browserOpen: boolean;
  historical: boolean;
  sourceLimit: number;
  selectedId: string;
  selectedEdgeId: string;
  pageY: number;
  graph: GraphViewState;
}
// Session-only UI state, bounded and cleared on sign-out. No evidence or profile data is cached.
const views = new Map<string, ExplorationViewState>();
watch(
  () => session.user?.id,
  () => views.clear(),
);

export function useExplorationView(organizationId: string, selectedId: string) {
  const router = useRouter(),
    route = useRoute();
  const path = route.path;
  const key = `${session.user?.id}:${path}:${organizationId}`;
  const saved = views.get(`${key}:${selectedId}`);
  const matching = saved?.selectedId === selectedId;
  const view = reactive<ExplorationViewState>(
    matching
      ? structuredClone(saved)
      : {
          search: '',
          kind: '',
          browserOpen: false,
          historical: false,
          sourceLimit: 8,
          selectedId,
          selectedEdgeId: '',
          pageY: 0,
          graph: {
            focusId: '',
            depth: 1,
            limit: 24,
            zoom: 1,
            kinds: [...relationshipKinds],
            showSources: false,
            showAssociations: false,
            expanded: false,
            associationsOpen: false,
            relationshipsOpen: false,
            positioned: false,
            left: 0,
            top: 0,
          },
        },
  );
  let departing = false,
    restorePending = matching;
  function save() {
    if (departing || !session.user) return;
    view.pageY = window.scrollY;
    const selectionKey = `${key}:${view.selectedId}`;
    views.delete(selectionKey);
    views.set(selectionKey, structuredClone(toRaw(view)));
    if (views.size > 40) views.delete(views.keys().next().value!);
  }
  const removeGuard = router.beforeEach((to, from) => {
    if (from.path === path && to.path !== path) {
      save();
      departing = true;
    }
  });
  // Called after asynchronous graph layout; router scroll restoration alone runs too early.
  function restorePage() {
    if (!restorePending || departing || route.path !== path) return;
    restorePending = false;
    window.scrollTo({ top: view.pageY });
  }
  onBeforeUnmount(() => {
    save();
    removeGuard();
  });
  return { view, restorePage };
}
