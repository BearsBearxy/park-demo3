// src/components/shell/paletteFilter.ts — pure filter for CommandPalette.
// Ported from app/shell.jsx CommandPalette grouping logic.
import { fpAllPages, FP_NAV } from '@/nav/fpNav'
import { isLayerVisible } from '@/nav/navAccess'

export interface PageEntry {
  value: string
  label: string
  icon: string
  layer: string
  layerLabel: string
  layerIcon: string
}

export interface PaletteGroup {
  title: string
  items: PageEntry[]
}

/** filterPages — pure function, no side-effects.
 *  Empty/blank query → 最近访问 group (max 5, deduplicated) + one group per layer.
 *  Non-empty query → single "搜索结果" group, case-insensitive substring on label or layerLabel. */
export function filterPages(query: string, allPages: PageEntry[], recent: string[]): PaletteGroup[] {
  const q = query.trim()
  if (q) {
    const lo = q.toLowerCase()
    const hits = allPages.filter(p =>
      p.label.toLowerCase().includes(lo) || p.layerLabel.toLowerCase().includes(lo)
    )
    return [{ title: hits.length ? '搜索结果' : '无匹配', items: hits }]
  }

  // empty query: recent (max 5) + per-layer groups
  const recentItems = recent
    .map(v => allPages.find(p => p.value === v))
    .filter((p): p is PageEntry => p != null)
    .slice(0, 5)
  const recentVals = new Set(recentItems.map(p => p.value))

  const groups: PaletteGroup[] = []
  if (recentItems.length) groups.push({ title: '最近访问', items: recentItems })

  for (const layer of FP_NAV) {
    const items = allPages.filter(p => p.layer === layer.id && !recentVals.has(p.value))
    if (items.length) groups.push({ title: layer.label, items })
  }
  return groups
}

/** Convenience: build allPages from fpNav for use in CommandPalette.
 *  navLayers = 角色可见的导航层:不可见层的屏不进面板(空层在 filterPages 里自然不出组)。 */
export function buildAllPages(navLayers: string[], canSystemView = false): PageEntry[] {
  return fpAllPages().filter(p => isLayerVisible(p.layer, navLayers, canSystemView)).map(p => ({
    value: p.value,
    label: p.label,
    icon: p.icon,
    layer: p.layer,
    layerLabel: p.layerLabel,
    layerIcon: p.layerIcon,
  }))
}
