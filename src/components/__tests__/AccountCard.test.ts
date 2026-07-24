import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import AccountCard from '../AccountCard.vue'

const account = {
  query: 'Service:user',
  issuer: 'Service',
  name: 'user',
  period: 30,
  touchRequired: false,
  code: '415507',
  codeExpiresAt: null,
}

describe('AccountCard', () => {
  it('renders issuer, name, and formatted code', () => {
    const wrapper = mount(AccountCard, { props: { account } })
    expect(wrapper.text()).toContain('Service')
    expect(wrapper.text()).toContain('user')
    expect(wrapper.text()).toContain('415 507')
  })

  it('emits copy when clicked with a visible code', async () => {
    const wrapper = mount(AccountCard, { props: { account } })
    await wrapper.trigger('click')
    expect(wrapper.emitted('copy')).toEqual([['415507']])
  })

  it('shows "Tap to reveal" and emits reveal for touch-required accounts with no code yet', async () => {
    const touchAccount = { ...account, touchRequired: true, code: null }
    const wrapper = mount(AccountCard, { props: { account: touchAccount } })
    expect(wrapper.text()).toContain('Tap to reveal')
    await wrapper.trigger('click')
    expect(wrapper.emitted('reveal')).toEqual([['Service:user']])
    expect(wrapper.emitted('copy')).toBeUndefined()
  })

  it('renders the brand icon svg for a recognized issuer', () => {
    const discordAccount = { ...account, issuer: 'Discord' }
    const wrapper = mount(AccountCard, { props: { account: discordAccount } })
    const path = wrapper.find('.yb-card-icon svg path')
    expect(path.exists()).toBe(true)
    expect(path.attributes('d')).toBeTruthy()
    expect(wrapper.find('.yb-card-icon span').exists()).toBe(false)
  })

  describe('code/bar sync across a period boundary', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-22T10:00:25.000Z')) // 5s left of a 30s period starting :00
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('hides the code once the bar wraps, even before the store provides a fresh one', async () => {
      const wrapper = mount(AccountCard, { props: { account } })
      expect(wrapper.text()).toContain('415 507')

      vi.setSystemTime(new Date('2026-07-22T10:00:31.000Z')) // just past the boundary
      await vi.advanceTimersByTimeAsync(250)

      expect(wrapper.text()).not.toContain('415 507')
      await wrapper.trigger('click')
      expect(wrapper.emitted('copy')).toBeUndefined()
    })

    it('shows the new code again once the store updates it', async () => {
      const wrapper = mount(AccountCard, { props: { account } })
      vi.setSystemTime(new Date('2026-07-22T10:00:31.000Z'))
      await vi.advanceTimersByTimeAsync(250)
      expect(wrapper.text()).not.toContain('415 507')

      await wrapper.setProps({ account: { ...account, code: '998877' } })
      expect(wrapper.text()).toContain('998 877')
    })

    it('keeps "Tap to reveal" clickable across a boundary tick, since a touch account never has a code to go stale', async () => {
      // Regression: touch-required accounts always have `code: null`, so the
      // watcher that resets suppressCode when a fresh code lands never fires
      // for them - the boundary tick below used to leave suppressCode stuck
      // true forever, silently swallowing every future reveal click.
      const touchAccount = { ...account, touchRequired: true, code: null }
      const wrapper = mount(AccountCard, { props: { account: touchAccount } })

      vi.setSystemTime(new Date('2026-07-22T10:00:31.000Z')) // just past the boundary
      await vi.advanceTimersByTimeAsync(250)

      await wrapper.trigger('click')
      expect(wrapper.emitted('reveal')).toEqual([['Service:user']])
    })
  })
})
