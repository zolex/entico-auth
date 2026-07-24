import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import EmptyState from '../EmptyState.vue'

describe('EmptyState', () => {
  it('shows a download link when ykman is missing', () => {
    const wrapper = mount(EmptyState, { props: { kind: 'ykman-missing' } })
    const link = wrapper.find('a')
    expect(link.attributes('href')).toBe('https://developers.yubico.com/yubikey-manager/Releases/')
  })

  it('emits open-settings when its button is clicked', async () => {
    const wrapper = mount(EmptyState, { props: { kind: 'ykman-missing' } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('open-settings')).toHaveLength(1)
  })

  it('shows a plug-in message when no key is connected', () => {
    const wrapper = mount(EmptyState, { props: { kind: 'no-key' } })
    expect(wrapper.text()).toContain('Plug in a YubiKey')
  })

  it('shows a select-key message when multiple keys are connected', () => {
    const wrapper = mount(EmptyState, { props: { kind: 'select-key' } })
    expect(wrapper.text()).toContain('Select a YubiKey')
  })

  it('shows an OATH-disabled message', () => {
    const wrapper = mount(EmptyState, { props: { kind: 'oath-disabled' } })
    expect(wrapper.text()).toContain('OATH')
  })
})
