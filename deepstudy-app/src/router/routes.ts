import type { RouteRecordRaw } from 'vue-router'

export interface PrimaryTab {
  label: string
  path: string
  icon: 'today' | 'long' | 'focus' | 'habit' | 'mine'
  matches: (path: string) => boolean
}

export const primaryTabs: PrimaryTab[] = [
  { label: '今日', path: '/today', icon: 'today', matches: (path) => path.startsWith('/today') },
  { label: '长期', path: '/long', icon: 'long', matches: (path) => path.startsWith('/long') },
  { label: '专注', path: '/focus', icon: 'focus', matches: (path) => path.startsWith('/focus') },
  { label: '习惯', path: '/habit', icon: 'habit', matches: (path) => path.startsWith('/habit') },
  { label: '我的', path: '/mine', icon: 'mine', matches: (path) => path.startsWith('/mine') },
]

export const appRoutes: RouteRecordRaw[] = [
  { path: '/', redirect: '/today' },
  { path: '/today', name: 'today', component: () => import('../views/TodayView.vue') },
  { path: '/long', name: 'long', component: () => import('../views/LongBoardView.vue') },
  {
    path: '/long/:quadrantId',
    name: 'long-quadrant',
    component: () => import('../views/LongQuadrantView.vue'),
    props: true,
  },
  {
    path: '/long/:quadrantId/:taskId',
    name: 'long-task',
    component: () => import('../views/LongTaskDetailView.vue'),
    props: true,
  },
  { path: '/focus', name: 'focus', component: () => import('../views/FocusView.vue') },
  { path: '/habit', name: 'habit', component: () => import('../views/HabitView.vue') },
  { path: '/mine', name: 'mine', component: () => import('../views/MineView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/today' },
]
