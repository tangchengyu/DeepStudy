import { describe, expect, it } from 'vitest'
import { appRoutes, primaryTabs } from './routes'

describe('mobile route contract', () => {
  it('exposes the five primary tabs in the approved order', () => {
    expect(primaryTabs.map((tab) => tab.label)).toEqual([
      '今日',
      '长期',
      '专注',
      '习惯',
      '我的',
    ])
  })

  it('keeps long-task drill-down pages under the Long tab', () => {
    expect(appRoutes.map((route) => route.path)).toEqual(
      expect.arrayContaining([
        '/long',
        '/long/:quadrantId',
        '/long/:quadrantId/:taskId',
      ]),
    )
    expect(primaryTabs.find((tab) => tab.path === '/long')?.matches('/long/important-urgent/task-1')).toBe(true)
  })
})
