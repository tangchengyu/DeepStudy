import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'main',
    component: () => import('@/components/MainShell.vue')
  },
  {
    path: '/timer',
    name: 'timer',
    component: () => import('@/components/TimerWindow.vue')
  },
  {
    path: '/long-tasks',
    name: 'long-tasks',
    component: () => import('@/components/LongTaskWindow.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
