import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PasswordSettingsSheet from '../PasswordSettingsSheet.vue'
import { useKeysStore } from '../../stores/keys'
import { useUiStore } from '../../stores/ui'
import { ykman } from '../../lib/ykman-client'
import { PresenceCancelledError } from '../../lib/presence'

vi.mock('../../lib/ykman-client', () => ({
  ykman: {
    oathSetPassword: vi.fn().mockResolvedValue(undefined),
    oathClearPassword: vi.fn().mockResolvedValue(undefined),
    oathRememberPassword: vi.fn().mockResolvedValue(undefined),
    oathForgetPassword: vi.fn().mockResolvedValue(undefined),
  },
  describeYkmanError: (e: unknown) => {
    const err = e as { kind?: string; message?: string }
    if (err?.kind === 'WrongPassword') return 'Wrong password.'
    if (err?.kind === 'Other' && err.message) return err.message
    return 'Something went wrong talking to the YubiKey.'
  },
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  useKeysStore().activeSerial = '36705123'
})

describe('PasswordSettingsSheet', () => {
  it('sets a new password (no prior password) with remember checked, clearing the session password', async () => {
    const wrapper = mount(PasswordSettingsSheet, { props: { visible: true, passwordProtected: false } })
    await wrapper.find('[data-test="new-password"]').setValue('hunter2')
    await wrapper.find('[data-test="confirm-password"]').setValue('hunter2')
    await wrapper.find('[data-test="remember"]').trigger('click')
    await wrapper.find('[data-test="save"]').trigger('click')
    await Promise.resolve()

    expect(ykman.oathSetPassword).toHaveBeenCalledWith('36705123', null, 'hunter2', true)
    expect(wrapper.emitted('changed')).toBeTruthy()
    expect(wrapper.emitted('success')).toEqual([['Password set.']])
    expect(wrapper.emitted('close')).toBeTruthy()
    // ykman itself now remembers it (-r was passed); don't also hold it ourselves.
    expect(useUiStore().sessionPasswordFor('36705123')).toBeNull()
  })

  it('changes an existing password using the current password', async () => {
    const wrapper = mount(PasswordSettingsSheet, { props: { visible: true, passwordProtected: true } })
    await wrapper.find('[data-test="current-password"]').setValue('old-pw')
    await wrapper.find('[data-test="new-password"]').setValue('new-pw')
    await wrapper.find('[data-test="confirm-password"]').setValue('new-pw')
    await wrapper.find('[data-test="save"]').trigger('click')
    await Promise.resolve()

    expect(ykman.oathSetPassword).toHaveBeenCalledWith('36705123', 'old-pw', 'new-pw', false)
    expect(wrapper.emitted('success')).toEqual([['Password changed.']])
    expect(wrapper.emitted('close')).toBeTruthy()
    expect(useUiStore().sessionPasswordFor('36705123')).toBe('new-pw')
  })

  it('changes an existing password with remember checked, clearing the session password', async () => {
    useUiStore().setSessionPassword('36705123', 'old-pw')
    const wrapper = mount(PasswordSettingsSheet, { props: { visible: true, passwordProtected: true } })
    await wrapper.find('[data-test="current-password"]').setValue('old-pw')
    await wrapper.find('[data-test="new-password"]').setValue('new-pw')
    await wrapper.find('[data-test="confirm-password"]').setValue('new-pw')
    await wrapper.find('[data-test="remember"]').trigger('click')
    await wrapper.find('[data-test="save"]').trigger('click')
    await Promise.resolve()

    expect(ykman.oathSetPassword).toHaveBeenCalledWith('36705123', 'old-pw', 'new-pw', true)
    expect(useUiStore().sessionPasswordFor('36705123')).toBeNull()
  })

  it('toggles remember-on-this-device without changing the password, clearing the session password', async () => {
    useUiStore().setSessionPassword('36705123', 'old-pw')
    const wrapper = mount(PasswordSettingsSheet, { props: { visible: true, passwordProtected: true } })
    await wrapper.find('[data-test="current-password"]').setValue('old-pw')
    await wrapper.find('[data-test="remember"]').trigger('click')
    await wrapper.find('[data-test="save"]').trigger('click')
    await Promise.resolve()

    expect(ykman.oathRememberPassword).toHaveBeenCalledWith('36705123', 'old-pw')
    expect(ykman.oathSetPassword).not.toHaveBeenCalled()
    expect(wrapper.emitted('success')).toEqual([['Remembered on this device.']])
    expect(wrapper.emitted('close')).toBeTruthy()
    expect(useUiStore().sessionPasswordFor('36705123')).toBeNull()
  })

  it('forgetting the remembered password sets the session password so future calls keep working', async () => {
    const wrapper = mount(PasswordSettingsSheet, { props: { visible: true, passwordProtected: true } })
    await wrapper.find('[data-test="current-password"]').setValue('old-pw')
    await wrapper.find('[data-test="remember"]').trigger('click')
    await wrapper.find('[data-test="remember"]').trigger('click')
    await wrapper.find('[data-test="save"]').trigger('click')
    await Promise.resolve()

    expect(ykman.oathForgetPassword).toHaveBeenCalledWith('36705123')
    expect(wrapper.emitted('success')).toEqual([['Forgot the remembered password on this device.']])
    expect(useUiStore().sessionPasswordFor('36705123')).toBe('old-pw')
  })

  it('removes the password when new password is left blank on Save', async () => {
    useUiStore().setSessionPassword('36705123', 'old-pw')
    const wrapper = mount(PasswordSettingsSheet, { props: { visible: true, passwordProtected: true } })
    await wrapper.find('[data-test="current-password"]').setValue('old-pw')
    await wrapper.find('[data-test="save"]').trigger('click')
    await Promise.resolve()

    expect(ykman.oathClearPassword).toHaveBeenCalledWith('36705123', 'old-pw')
    expect(wrapper.emitted('changed')).toBeTruthy()
    expect(wrapper.emitted('success')).toEqual([['Password removed.']])
    expect(wrapper.emitted('close')).toBeTruthy()
    expect(useUiStore().sessionPasswordFor('36705123')).toBeNull()
  })

  it('does not render a separate remove-password button', () => {
    const wrapper = mount(PasswordSettingsSheet, { props: { visible: true, passwordProtected: true } })
    expect(wrapper.find('[data-test="remove-password"]').exists()).toBe(false)
  })

  it('labels the new-password field as leave-blank-to-remove when password protected', () => {
    const wrapper = mount(PasswordSettingsSheet, { props: { visible: true, passwordProtected: true } })
    expect(wrapper.text()).toContain('leave blank to remove')
  })

  it('does nothing when Save is clicked on an already-protected key with no fields touched', async () => {
    const wrapper = mount(PasswordSettingsSheet, { props: { visible: true, passwordProtected: true } })
    await wrapper.find('[data-test="save"]').trigger('click')
    await Promise.resolve()

    expect(ykman.oathSetPassword).not.toHaveBeenCalled()
    expect(ykman.oathRememberPassword).not.toHaveBeenCalled()
    expect(ykman.oathForgetPassword).not.toHaveBeenCalled()
    expect(ykman.oathClearPassword).not.toHaveBeenCalled()
    expect(wrapper.emitted('changed')).toBeUndefined()
    expect(wrapper.emitted('success')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('shows an inline error message on a wrong-password failure, without closing', async () => {
    vi.mocked(ykman.oathSetPassword).mockRejectedValueOnce({ kind: 'WrongPassword' })
    const wrapper = mount(PasswordSettingsSheet, { props: { visible: true, passwordProtected: true } })
    await wrapper.find('[data-test="current-password"]').setValue('wrong')
    await wrapper.find('[data-test="new-password"]').setValue('new-pw')
    await wrapper.find('[data-test="confirm-password"]').setValue('new-pw')
    await wrapper.find('[data-test="save"]').trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(wrapper.text()).toContain('Wrong password.')
    expect(wrapper.emitted('changed')).toBeUndefined()
    expect(wrapper.emitted('success')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('shows an inline error and does not call ykman when the confirmation does not match', async () => {
    const wrapper = mount(PasswordSettingsSheet, { props: { visible: true, passwordProtected: false } })
    await wrapper.find('[data-test="new-password"]').setValue('hunter2')
    await wrapper.find('[data-test="confirm-password"]').setValue('hunter3')
    await wrapper.find('[data-test="save"]').trigger('click')
    await Promise.resolve()

    expect(wrapper.text()).toContain('Passwords do not match.')
    expect(ykman.oathSetPassword).not.toHaveBeenCalled()
    expect(wrapper.emitted('success')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('stays open with no error text when the presence check is cancelled', async () => {
    vi.mocked(ykman.oathSetPassword).mockRejectedValueOnce(new PresenceCancelledError())
    const wrapper = mount(PasswordSettingsSheet, { props: { visible: true, passwordProtected: false } })
    await wrapper.find('[data-test="new-password"]').setValue('hunter2')
    await wrapper.find('[data-test="confirm-password"]').setValue('hunter2')
    await wrapper.find('[data-test="save"]').trigger('click')
    await Promise.resolve()
    await Promise.resolve()

    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.find('.field-error').exists()).toBe(false)
  })

  it('emits close when the back button is clicked', async () => {
    const wrapper = mount(PasswordSettingsSheet, { props: { visible: true, passwordProtected: false } })
    await wrapper.find('[data-test="back"]').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
