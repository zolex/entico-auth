import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AddSpeedDial from '../AddSpeedDial.vue'

// AddSpeedDial is a controlled component (`open` is owned by the parent, as
// in App.vue) - simulate the v-model wiring by syncing the prop back from
// the emitted update:open event.
function mountSpeedDial() {
  const wrapper = mount(AddSpeedDial, {
    props: {
      open: false,
      'onUpdate:open': (value: boolean) => wrapper.setProps({ open: value }),
    },
  })
  return wrapper
}

describe('AddSpeedDial', () => {
  it('hides the flying menu until the fab is toggled open', async () => {
    const wrapper = mountSpeedDial()
    expect(wrapper.find('[data-test="speed-dial-qr"]').exists()).toBe(false)

    await wrapper.get('[data-test="speed-dial-toggle"]').trigger('click')

    expect(wrapper.find('[data-test="speed-dial-qr"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="speed-dial-uri"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="speed-dial-manual"]').exists()).toBe(true)
  })

  it('emits pick with the chosen mode and closes the menu', async () => {
    const wrapper = mountSpeedDial()
    await wrapper.get('[data-test="speed-dial-toggle"]').trigger('click')

    await wrapper.get('[data-test="speed-dial-manual"]').trigger('click')

    expect(wrapper.emitted('pick')?.[0]).toEqual(['manual'])
    expect(wrapper.find('[data-test="speed-dial-qr"]').exists()).toBe(false)
  })
})
