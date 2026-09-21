// src/composables/useFormSheet.ts — 带输入控件的居中弹卡是否该变全屏 sheet(RESPONSIVE-LAYOUT-SPEC §4.4)。
// 壳与判据见 styles/form-sheet.css 顶部注释。
//
// 只回一个布尔:哪一层挂 .fp-fsheet、什么条件下挂,由调用方决定 —— 同一个遮罩下可能同时有
// 「带输入」和「只有一句话 + 两个钮」两种卡(fin/FinDialogs 的 delco、SystemUsersView 的停用确认),
// 后者按判据仍是居中小卡。
import { computed, type ComputedRef } from 'vue'
import { useViewport } from './useViewport'

export function useFormSheet(): ComputedRef<boolean> {
  const vp = useViewport()
  return computed(() => vp.tier.value === 's')
}
