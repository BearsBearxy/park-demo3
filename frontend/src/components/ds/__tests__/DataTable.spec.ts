import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { describe, it, expect } from 'vitest'
import DataTable from '../DataTable.vue'

describe('DataTable', () => {
  it('renders render() VNode cells and plain string cells', () => {
    const wrapper = mount(DataTable, {
      props: {
        rows: [{ id: 1, name: 'A' }],
        columns: [
          { key: 'name', header: 'Name' },
          {
            key: 'id',
            header: 'Badge',
            render: () => h('span', { class: 'badge' }, 'BADGE'),
          },
        ],
      },
    })
    expect(wrapper.html()).toContain('BADGE')
    expect(wrapper.html()).toContain('A')
  })
})
