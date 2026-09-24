// 每一版重点卡的配图,按版本号登记(RELEASE-NOTES-SPEC §5)。
// 有重点卡的版本就新加一个 Art<版本>.vue 登记在这里 —— 不覆盖旧的:更新记录里翻到那一版还看得到它的图。
// changelog.spec 会查「0.13.0 起有重点卡的版本都登记了配图」。
import type { Component } from 'vue'
import Art0130 from './Art0130.vue'
import Art0140 from './Art0140.vue'
import Art0150 from './Art0150.vue'
import Art0160 from './Art0160.vue'
import Art0190 from './Art0190.vue'
import Art0200 from './Art0200.vue'

export const RELEASE_ART: Record<string, Component> = {
  '0.20.0': Art0200,
  '0.19.0': Art0190,
  '0.16.0': Art0160,
  '0.15.0': Art0150,
  '0.14.0': Art0140,
  '0.13.0': Art0130,
}
