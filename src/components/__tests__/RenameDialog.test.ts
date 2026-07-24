import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import RenameDialog from '../RenameDialog.vue'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('RenameDialog', () => {
  it('pre-fills the form from props and emits submit with edited values', async () => {
    const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user' } })
    expect((wrapper.find('[data-test="rename-issuer"]').element as HTMLInputElement).value).toBe('Service')
    expect((wrapper.find('[data-test="rename-name"]').element as HTMLInputElement).value).toBe('user')

    await wrapper.find('[data-test="rename-issuer"]').setValue('Service Full Name')
    await wrapper.find('[data-test="rename-name"]').setValue('user@domain.tld')
    await wrapper.find('[data-test="rename-submit"]').trigger('click')

    expect(wrapper.emitted('submit')).toEqual([['Service Full Name', 'user@domain.tld']])
  })

  it('emits null issuer when the issuer field is cleared', async () => {
    const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user' } })
    await wrapper.find('[data-test="rename-issuer"]').setValue('')
    await wrapper.find('[data-test="rename-submit"]').trigger('click')
    expect(wrapper.emitted('submit')).toEqual([[null, 'user']])
  })

  it('does not submit when the name is blank', async () => {
    const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user' } })
    await wrapper.find('[data-test="rename-name"]').setValue('   ')
    await wrapper.find('[data-test="rename-submit"]').trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('emits cancel', async () => {
    const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user' } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('resets fields to the new props when reopened for a different account', async () => {
    const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user' } })
    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ issuer: 'Other', name: 'other-user', visible: true })
    expect((wrapper.find('[data-test="rename-issuer"]').element as HTMLInputElement).value).toBe('Other')
    expect((wrapper.find('[data-test="rename-name"]').element as HTMLInputElement).value).toBe('other-user')
  })

  it('shows a spinner and disables Save/Cancel while busy, and does not emit submit', async () => {
    const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user', busy: true } })
    expect(wrapper.find('[data-test="rename-submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button')[0].attributes('disabled')).toBeDefined()
    expect(wrapper.find('.spinner').exists()).toBe(true)

    await wrapper.find('[data-test="rename-submit"]').trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('renders an error message when the error prop is set', () => {
    const wrapper = mount(RenameDialog, {
      props: { visible: true, issuer: 'Service', name: 'user', error: 'Wrong password.' },
    })
    expect(wrapper.text()).toContain('Wrong password.')
  })
})
