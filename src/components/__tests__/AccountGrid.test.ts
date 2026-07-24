import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AccountGrid from '../AccountGrid.vue'

const accounts = [
  { query: 'Service:user', issuer: 'Service', name: 'user', period: 30, touchRequired: false, code: '111111', codeExpiresAt: null },
  { query: 'Other:user', issuer: 'Other', name: 'user', period: 30, touchRequired: false, code: '222222', codeExpiresAt: null },
]

describe('AccountGrid', () => {
  it('renders a card per account', () => {
    const wrapper = mount(AccountGrid, { props: { accounts, searchQuery: '' } })
    expect(wrapper.findAll('.yb-card').length).toBe(2)
  })

  it('filters by issuer name case-insensitively', () => {
    const wrapper = mount(AccountGrid, { props: { accounts, searchQuery: 'OTH' } })
    expect(wrapper.findAll('.yb-card').length).toBe(1)
    expect(wrapper.text()).toContain('Other')
  })

  it('forwards a card contextmenu event with its query and coordinates', async () => {
    const wrapper = mount(AccountGrid, { props: { accounts, searchQuery: '' } })
    await wrapper.findAll('.yb-card')[1].trigger('contextmenu', { clientX: 12, clientY: 34 })
    expect(wrapper.emitted('contextmenu')).toEqual([['Other:user', 12, 34]])
  })
})
