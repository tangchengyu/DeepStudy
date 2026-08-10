import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import BottomNavigation from './BottomNavigation.vue'
import bottomNavigationSource from './BottomNavigation.vue?raw'

const EmptyView = defineComponent({ template: '<main />' })

describe('bottom navigation', () => {
  it('renders five phone-sized destinations and highlights a nested Long route', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/today', component: EmptyView },
        { path: '/long/:pathMatch(.*)*', component: EmptyView },
        { path: '/focus', component: EmptyView },
        { path: '/habit', component: EmptyView },
        { path: '/mine', component: EmptyView },
      ],
    })
    await router.push('/long/important-urgent/task-1')
    await router.isReady()

    const wrapper = mount(BottomNavigation, { global: { plugins: [router] } })
    const items = wrapper.findAll('[data-testid="bottom-nav-item"]')

    expect(items).toHaveLength(5)
    expect(items.map((item) => item.text())).toEqual(['今日', '长期', '专注', '习惯', '我的'])
    expect(items[1].attributes('aria-current')).toBe('page')
    expect(items[2].classes()).toContain('bottom-nav__item--focus')
    expect(wrapper.findAll('svg')).toHaveLength(5)
  })

  it('anchors the navigation surface to the physical screen bottom', () => {
    expect(bottomNavigationSource).not.toContain('padding: 0 0 max(0.5rem, env(safe-area-inset-bottom));')
    expect(bottomNavigationSource).toContain('bottom: 0;')
    expect(bottomNavigationSource).toContain('padding-bottom: calc(0.3rem + env(safe-area-inset-bottom));')
  })
})
