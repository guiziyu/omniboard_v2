import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import './style.css';
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/w/internal/organizations' },
    { path: '/activate', component: () => import('./ActivateView.vue') },
    {
      path: '/w/internal/organizations',
      component: () => import('./views/PlaceholderView.vue'),
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
