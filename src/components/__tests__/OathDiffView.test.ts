import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import OathDiffView from '../OathDiffView.vue'
import RenameDialog from '../RenameDialog.vue'
import { useKeysStore } from '../../stores/keys'
import { ykman } from '../../lib/ykman-client'

vi.mock('../../lib/ykman-client', () => ({
  ykman: {
    oathStatus: vi.fn().mockResolvedValue({ passwordProtected: false, remembered: false }),
    oathListAccounts: vi.fn().mockResolvedValue([]),
  },
  describeYkmanError: () => 'Something went wrong talking to the YubiKey.',
}))

async function flush() {
  await new Promise((r) => setTimeout(r))
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.mocked(ykman.oathStatus).mockResolvedValue({ passwordProtected: false, remembered: false })
})

describe('OathDiffView', () => {
  it('opens RenameDialog scoped to the keys that have the account, from the card context menu', async () => {
    useKeysStore().keys = [
      { serial: 'AAA', name: 'Key A' },
      { serial: 'BBB', name: 'Key B' },
    ]
    vi.mocked(ykman.oathListAccounts).mockImplementation(async (serial: string) =>
      serial === 'AAA'
        ? [{ query: 'Service:user', issuer: 'Service', name: 'user', period: 30, touchRequired: false }]
        : [],
    )

    // visible starts false and flips to true - the component's own watcher
    // (not `immediate`) only runs the scan on that transition.
    const wrapper = mount(OathDiffView, { props: { visible: false } })
    await wrapper.setProps({ visible: true })
    await flush()

    await wrapper.find('.yb-card').trigger('contextmenu')
    expect(wrapper.find('.context-menu').text()).toContain('Rename')

    const buttons = wrapper.findAll('.context-menu button')
    await buttons[1].trigger('click')

    const dialog = wrapper.findComponent(RenameDialog)
    expect(dialog.exists()).toBe(true)
    expect(dialog.props('query')).toBe('Service:user')
    expect(dialog.props('issuer')).toBe('Service')
    expect(dialog.props('name')).toBe('user')
    expect(dialog.props('selectedKeys')).toEqual([{ serial: 'AAA', name: 'Key A' }])
  })
})
