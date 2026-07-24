import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import ConfirmDialog from '../ConfirmDialog.vue'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('ConfirmDialog', () => {
  it('renders the message and emits confirm/cancel', async () => {
    const wrapper = mount(ConfirmDialog, { props: { visible: true, message: 'Delete this account?' } })
    expect(wrapper.text()).toContain('Delete this account?')

    await wrapper.find('[data-test="confirm-danger"]').trigger('click')
    expect(wrapper.emitted('confirm')).toBeTruthy()

    await wrapper.find('[data-test="cancel"]').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('shows a spinner and disables both buttons while busy', () => {
    const wrapper = mount(ConfirmDialog, { props: { visible: true, message: 'Delete this account?', busy: true } })
    expect(wrapper.find('[data-test="confirm-danger"]').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button')[0].attributes('disabled')).toBeDefined()
    expect(wrapper.find('.spinner').exists()).toBe(true)
  })

  it('renders an error message when the error prop is set', () => {
    const wrapper = mount(ConfirmDialog, {
      props: { visible: true, message: 'Delete this account?', error: 'Something went wrong.' },
    })
    expect(wrapper.text()).toContain('Something went wrong.')
  })
})
