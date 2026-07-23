import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RecoveryCodePanel from './RecoveryCodePanel.vue'

describe('RecoveryCodePanel', () => {
  it('shows the one-time code and requires explicit saved confirmation', async () => {
    const wrapper = mount(RecoveryCodePanel, {
      props: { code: 'ABCD-EFGH-JKLM-NPQR', reason: 'new-account' },
    })

    expect(wrapper.text()).toContain('ABCD-EFGH-JKLM-NPQR')
    const confirm = wrapper.get('[data-testid="confirm-recovery-code"]')
    expect(confirm.attributes('disabled')).toBeDefined()

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await confirm.trigger('click')

    expect(wrapper.emitted('confirmed')).toHaveLength(1)
  })
})
