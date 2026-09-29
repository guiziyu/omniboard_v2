import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import './style.css';
const router = createRouter({
  history: createWebHistory(),
  // 滚动(frontend-spec 2.13):前进后退用浏览器保存的位置;同一路径只翻页时滚到目录表顶部,
  // 其他 query 变化不滚动;换路径回到顶部。返回目录时由目录页自己恢复离开前的位置。
  scrollBehavior(to, from, saved) {
    if (saved) return saved;
    if (to.path === from.path) {
      const { page: nextPage, ...rest } = to.query;
      const { page: previousPage, ...before } = from.query;
      return nextPage !== previousPage && JSON.stringify(rest) === JSON.stringify(before)
        ? { el: '.catalog-card', top: 8 }
        : false;
    }
    if (to.path === '/w/internal/organizations') return false;
    return { top: 0 };
  },
  routes: [
    { path: '/', redirect: '/w/internal/organizations' },
    { path: '/activate', component: () => import('./ActivateView.vue') },
    {
      path: '/w/internal/organizations',
      component: () => import('./views/DirectoryView.vue'),
      meta: { title: 'Organizations' },
    },
    {
      path: '/w/internal/organizations/:id/:tab?',
      component: () => import('./views/OrganizationView.vue'),
      meta: { title: 'Organizations' },
    },
    {
      path: '/w/internal/members',
      component: () => import('./views/MembersView.vue'),
      meta: { title: 'Team' },
    },
    {
      path: '/w/internal/audit',
      component: () => import('./views/AuditView.vue'),
      meta: { title: 'Audit log' },
    },
    {
      path: '/w/internal/settings',
      component: () => import('./views/SettingsView.vue'),
      meta: { title: 'Settings' },
    },
    { path: '/:rest(.*)*', redirect: '/w/internal/organizations' },
  ],
});
createApp(App).use(router).mount('#app');
