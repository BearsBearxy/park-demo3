// GradientWave.vue 的生命周期:jsdom 没有 WebGL,引擎整体打桩,只测组件怎么用它。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const h = vi.hoisted(() => {
  const calls: string[] = []
  const state = { throwOnInit: false, opts: null as unknown, canvas: null as unknown }
  class GradientWaveEngine {
    constructor(canvas: unknown, opts: unknown) {
      if (state.throwOnInit) throw new Error('WebGL not supported')
      state.canvas = canvas
      state.opts = opts
      calls.push('new')
    }
    start() { calls.push('start') }
    stop() { calls.push('stop') }
    renderStill() { calls.push('still') }
    dispose() { calls.push('dispose') }
  }
  return { calls, state, GradientWaveEngine }
})
vi.mock('./gradientWave', () => ({ GradientWaveEngine: h.GradientWaveEngine }))

import GradientWave from './GradientWave.vue'

const setReduced = (on: boolean) => {
  window.matchMedia = vi.fn((q: string) => ({ matches: on && q.includes('reduced-motion') }) as MediaQueryList)
}

beforeEach(() => {
  h.calls.length = 0
  h.state.throwOnInit = false
  h.state.opts = null
  setReduced(false)
})

describe('GradientWave', () => {
  it('挂载:用组件自己的 canvas 和传入的颜色建引擎并开播;isPlaying 切换停/播;卸载释放', async () => {
    const w = mount(GradientWave, { props: { colors: ['#060a13', '#0c2748'] } })
    await flushPromises()
    expect(h.state.canvas).toBe(w.find('canvas').element)
    expect((h.state.opts as { colors: string[] }).colors).toEqual(['#060a13', '#0c2748'])
    expect(h.calls).toEqual(['new', 'start'])
    await w.setProps({ isPlaying: false })
    await w.setProps({ isPlaying: true })
    expect(h.calls).toEqual(['new', 'start', 'stop', 'start'])
    w.unmount()
    expect(h.calls.at(-1)).toBe('dispose')
  })

  it('减动效:只画一帧,不开播', async () => {
    setReduced(true)
    const w = mount(GradientWave)
    await flushPromises()
    expect(h.calls).toEqual(['new', 'still'])
    w.unmount()
  })

  it('WebGL 不可用:不抛错、不开播,卸载也不报错(底色由调用方兜)', async () => {
    h.state.throwOnInit = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const w = mount(GradientWave)
    await flushPromises()
    expect(h.calls).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('WebGL 不可用'), expect.any(Error))
    w.unmount()
    warn.mockRestore()
  })

  it('引擎还没加载完就卸载:不再建引擎(否则动画在没人看的页面上一直跑)', async () => {
    const w = mount(GradientWave)
    w.unmount()
    await flushPromises()
    expect(h.calls).toEqual([])
  })
})
