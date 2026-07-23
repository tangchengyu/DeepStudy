import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AuthPanel from './AuthPanel.vue'

const TurnstileStub = {
  template: '<button data-testid="challenge" @click="$emit(\'token\', \'challenge-token\')">verify</button>',
}

describe('AuthPanel', () => {
  it('uses mobile-friendly username login and includes a completed Turnstile token', async () => {
    const wrapper = mount(AuthPanel, {
      props: { siteKey: 'site-key', minimumPasswordLength: 10, busy: false, error: null },
      global: { stubs: { TurnstileChallenge: TurnstileStub } },
    })

    await wrapper.get('input[autocomplete="username"]').setValue('alice')
    await wrapper.get('input[autocomplete="current-password"]').setValue('long-enough-password')
    await wrapper.get('[data-testid="challenge"]').trigger('click')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('sign-in')?.[0]).toEqual([{
      username: 'alice',
      password: 'long-enough-password',
      turnstileToken: 'challenge-token',
    }])
  })

  it('supports registration and recovery as distinct phone form modes', async () => {
    const wrapper = mount(AuthPanel, {
      props: { siteKey: 'site-key', minimumPasswordLength: 10, busy: false, error: null },
      global: { stubs: { TurnstileChallenge: TurnstileStub } },
    })

    await wrapper.get('[data-testid="mode-register"]').trigger('click')
    expect(wrapper.text()).toContain('创建账号')
    expect(wrapper.find('input[autocomplete="new-password"]').exists()).toBe(true)

    await wrapper.get('[data-testid="mode-recover"]').trigger('click')
    expect(wrapper.text()).toContain('恢复密码')
    expect(wrapper.find('input[autocomplete="one-time-code"]').exists()).toBe(true)
  })
})
