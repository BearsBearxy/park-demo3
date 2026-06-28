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

  it('recent deduplicates and caps at 8', () => {
    const store = useTabsStore()
    const values = ['buildings', 'tenants', 'contracts', 'ledger', 'bills',
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
