// src/stores/__tests__/tabs.spec.ts
// TDD for the browser-style tab model (ported from app.jsx go/pinTab/closeTab logic)
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTabsStore } from '../tabs'

// Stub localStorage for jsdom
beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('tabs store', () => {
  it('always has at least one pinned tab (base home)', () => {
    const store = useTabsStore()
    expect(store.tabs.length).toBeGreaterThanOrEqual(1)
  })

  it('open(value) non-pin → sets preview, does not add to tabs', () => {
    const store = useTabsStore()
    store.open('buildings')
    expect(store.preview?.value).toBe('buildings')
    expect(store.tabs.some(t => t.value === 'buildings')).toBe(false)
  })

  it('second open replaces preview (single preview slot)', () => {
    const store = useTabsStore()
    store.open('buildings')
    store.open('tenants')
    expect(store.preview?.value).toBe('tenants')
    expect(store.tabs.some(t => t.value === 'buildings')).toBe(false)
  })

  it('open(value) when already a pinned tab clears preview if it was that value', () => {
    const store = useTabsStore()
    // data-home is the default pinned tab
    store.preview = { value: 'data-home' }
    store.open('data-home')
    // navigating to a pinned tab clears preview if it matched
    expect(store.preview).toBeNull()
  })

  it('pin(value) promotes preview → pinned tab, clears preview', () => {
    const store = useTabsStore()
    store.open('tenants')
    expect(store.preview?.value).toBe('tenants')
    store.pin('tenants')
    expect(store.tabs.some(t => t.value === 'tenants')).toBe(true)
    expect(store.preview).toBeNull()
  })

  it('open with pin:true adds directly to tabs (new-tab command palette mode)', () => {
    const store = useTabsStore()
    store.open('contracts', { pin: true })
    expect(store.tabs.some(t => t.value === 'contracts')).toBe(true)
    expect(store.preview?.value).not.toBe('contracts')
  })

  it('close removes from pinned tabs when >1 view exists', () => {
    const store = useTabsStore()
    store.open('buildings', { pin: true })
    const before = store.tabs.length
    expect(before).toBeGreaterThan(1)
    store.close('buildings')
    expect(store.tabs.some(t => t.value === 'buildings')).toBe(false)
  })

  it('close does not remove last remaining view (≥1 always)', () => {
    const store = useTabsStore()
    // Only one view (base home), no preview
    const onlyTab = store.tabs[0].value
    store.close(onlyTab)
    // Still has at least 1 view total
    const total = store.tabs.length + (store.preview ? 1 : 0)
    expect(total).toBeGreaterThanOrEqual(1)
  })

  it('close(base-home) with preview present does NOT remove base pinned tab (invariant)', () => {
    const store = useTabsStore()
    // default state: tabs=[{value:'data-home'}], preview=null
    expect(store.tabs.map(t => t.value)).toContain('data-home')
    store.open('tenants') // sets preview → total views = 2
    expect(store.preview?.value).toBe('tenants')
    store.close('data-home') // must be refused — data-home is the sole pinned tab
    expect(store.tabs.some(t => t.value === 'data-home')).toBe(true)
    expect(store.tabs.length).toBeGreaterThanOrEqual(1)
  })

  it('recent deduplicates and caps at 8', () => {
    const store = useTabsStore()
    const values = ['buildings', 'tenants', 'contracts', 'ledger', 'meters',
                    'bank-flow', 'pv-income', 'car-charging', 'ebike-charging']
    for (const v of values) store.open(v)
    expect(store.recent.length).toBeLessThanOrEqual(8)
    // last opened should be first in recent
    expect(store.recent[0]).toBe('ebike-charging')
    // no duplicates
    expect(new Set(store.recent).size).toBe(store.recent.length)
  })

  it('recent deduplicates on re-open', () => {
    const store = useTabsStore()
    store.open('buildings')
    store.open('tenants')
    store.open('buildings') // re-open
    expect(store.recent.filter(v => v === 'buildings').length).toBe(1)
    expect(store.recent[0]).toBe('buildings')
  })
})

// ── v4:epoch(KeepAlive 新鲜度纪元,spec 2026-07-07 §二)──
describe('tabs store epoch / openFresh', () => {
  it('epochOf 缺省 0', () => {
    const store = useTabsStore()
    expect(store.epochOf('ledger')).toBe(0)
  })

  it('openFresh 递增 epoch 并照常 open(preview / pin 两态)', () => {
    const store = useTabsStore()
    store.openFresh('ledger')
    expect(store.epochOf('ledger')).toBe(1)
    expect(store.preview?.value).toBe('ledger')
    store.openFresh('ledger', { pin: true })
    expect(store.epochOf('ledger')).toBe(2)
    expect(store.tabs.some(t => t.value === 'ledger')).toBe(true)
  })

  it('open / pin 不动 epoch(TabStrip 点击=恢复缓存语义)', () => {
    const store = useTabsStore()
    store.open('ledger')
    store.pin('ledger')
    store.open('ledger', { pin: true })
    expect(store.epochOf('ledger')).toBe(0)
  })

  it('close 本身不动 epoch(弃状态由调用方导航后 dropState,防瞬时重挂载竞态)', () => {
    const store = useTabsStore()
    store.open('ledger', { pin: true })
    store.close('ledger')
    expect(store.epochOf('ledger')).toBe(0)
  })

  it('dropState 递增 epoch(关闭 tab 导航完成后调用 → 再开=全新)', () => {
    const store = useTabsStore()
    store.dropState('ledger')
    expect(store.epochOf('ledger')).toBe(1)
    store.dropState('ledger')
    expect(store.epochOf('ledger')).toBe(2)
  })

  it('close 被拒(最后一个视图)不动 epoch', () => {
    const store = useTabsStore()
    const only = store.tabs[0].value
    store.close(only)
    expect(store.epochOf(only)).toBe(0)
  })

  it('未知 value openFresh 不计 epoch', () => {
    const store = useTabsStore()
    store.openFresh('not-a-route')
    expect(store.epochOf('not-a-route')).toBe(0)
  })
})
