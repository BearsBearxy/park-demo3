// 分析层收字面量(T10 A 片)后的取色:浅色逐字等于改前写死的值,暗色换成暗色值(DARK-MODE-SPEC §4 §6)。
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { resolvedTheme } from '@/stores/appearance'
import { hues, inkA } from '../anaFmt'
import { PV_COLORS } from '@/views/analysis/pvAnaColors'
import { comboSeries } from '@/views/analysis/parkEnergy.logic'

afterEach(() => { resolvedTheme.value = 'light' })

type Bar = { itemStyle: { color: string } }

describe('图表 option 取色跟外观', () => {
  it('浅色:与改前的字面量逐字相同', () => {
    expect(hues()).toEqual({
      blue: '#378ADD', amber: '#EF9F27', teal: '#5DCAA5', red: '#E24B4A',
      coral: '#F0997B', deep: '#185FA5', mid: '#85B7EB', pale: '#B5D4F4',
    })
    expect(inkA(0.45)).toBe('rgba(28,28,28,.45)')
    expect(inkA(1)).toBe('rgba(28,28,28,1)')
    expect([PV_COLORS.REF, PV_COLORS.GRID, PV_COLORS.AXIS_TEXT, PV_COLORS.AMBER_TEXT])
      .toEqual(['rgba(28,28,28,.45)', 'rgba(28,28,28,.1)', 'rgba(28,28,28,.62)', '#854F0B'])
    expect((comboSeries([1], [2], 'none', null)[1] as Bar).itemStyle.color).toBe('#185FA5')
  })

  it('暗色:深蓝换灰蓝、墨色反过来;PV 墨阶 / 网格 / 轴字 / 琥珀字换暗色值,分类色不变', () => {
    resolvedTheme.value = 'dark'
    expect(hues().deep).toBe('#6E86AE')
    expect(hues().blue).toBe('#378ADD')
    expect(inkA(0.45)).toBe('rgba(236,236,238,.45)')
    expect([PV_COLORS.REF, PV_COLORS.GRID, PV_COLORS.AXIS_TEXT, PV_COLORS.AMBER_TEXT])
      .toEqual(['rgba(236,236,238,.45)', 'rgba(255,255,255,.08)', 'rgba(236,236,238,.62)', 'var(--warn-text)'])
    expect(PV_COLORS.FOCUS).toBe('#378ADD')
    // 视图的 option computed 调这些函数 → 切外观后重算出来的就是暗色值
    expect((comboSeries([1], [2], 'none', null)[1] as Bar).itemStyle.color).toBe('#6E86AE')
  })

  it('模板里读 PV_COLORS:切外观不用重挂载就重画', async () => {
    const w = mount(defineComponent({ render: () => h('i', { style: { color: PV_COLORS.AXIS_TEXT } }) }))
    expect(w.find('i').attributes('style')).toContain('rgba(28, 28, 28, 0.62)')
    resolvedTheme.value = 'dark'
    await nextTick()
    expect(w.find('i').attributes('style')).toContain('rgba(236, 236, 238, 0.62)')
  })
})
