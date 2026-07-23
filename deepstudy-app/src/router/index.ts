import { createRouter, createWebHashHistory } from 'vue-router'
import { appRoutes } from './routes'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: appRoutes,
  scrollBehavior: () => ({ top: 0 }),
})
