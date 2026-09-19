// 一处一个、没有同值令牌的浅色值(对抗复查 2026-09-20):浅色照原值写(浅色外观逐位不变,DARK-MODE-SPEC §4),
// 紧跟一条 :root[data-theme="dark"] 的规则换成令牌 —— 否则暗色下就是一块白底 / 一行深字。
// 另有几处「换令牌改了浅色值」的,改回了原值(遮罩 28% / 32%、提示条 80% 墨、改进胶囊的绿、身份漂移横幅)。
//
// 做法同 kpiCards.spec:把组件自己的 <style> 原样塞进 document,读 getComputedStyle;令牌 jsdom 不求值,判据是令牌名本身。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')
const FILES = [
  'views/bills/BillNoticesView.vue', 'views/meters/MeterView.vue', 'views/meters/MeterLedgerGrid.vue', 'views/meters/meter-shared.css',
  'views/params/ParamCenterView.vue', 'App.vue', 'components/ana/AnaPeriodBanner.vue', 'components/fp/FPToast.vue',
  'components/fp/FPSideDrawer.vue', 'components/shell/CommandPalette.vue', 'components/shell/WhatsNewDialog.vue',
  'views/buildings/BuildingCard.vue', 'views/bills/CompanyBookWindow.vue',
]
const styles: HTMLStyleElement[] = []
beforeAll(() => {
  for (const f of FILES) {
    const src = readFileSync(join(SRC, f), 'utf8')
    const css = f.endsWith('.css') ? src : [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    const el = document.createElement('style')
    el.textContent = css.replace(/:deep\(([^)]*)\)/g, '$1')
    document.head.appendChild(el)
    styles.push(el)
  }
})
afterAll(() => { styles.forEach((s) => s.remove()); delete document.documentElement.dataset.theme })

/** 把一段 HTML 放进 body,取 pick 选中的元素在浅色 / 暗色下的某条样式 */
function look(html: string, pick: string, prop: string): [string, string] {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  const el = host.querySelector(pick)!
  delete document.documentElement.dataset.theme
  const light = getComputedStyle(el).getPropertyValue(prop)
  document.documentElement.dataset.theme = 'dark'
  const dark = getComputedStyle(el).getPropertyValue(prop)
  delete document.documentElement.dataset.theme
  host.remove()
  return [light.replace(/\s+/g, ''), dark.replace(/\s+/g, '')]
}

describe('一处一个的浅色值:浅色照旧,暗色换令牌', () => {
  it('❗账单通知选中行:浅色 rgb(238,244,255),暗色 --row-selected(原来暗色下 1.07:1 整行字看不见)', () => {
    expect(look('<table class="bn-table"><tbody><tr class="sel"><td>x</td></tr></tbody></table>', 'td', 'background'))
      .toEqual(['rgb(238,244,255)', 'var(--row-selected)'])
  })
  it('❗表视图选中的表卡 / 隐藏条', () => {
    expect(look('<div class="mt5-card on"></div>', 'div', 'background')).toEqual(['rgb(240,246,255)', 'var(--row-selected)'])
    expect(look('<div class="mt-hidbar"></div>', 'div', 'color')).toEqual(['rgb(28,84,168)', 'var(--hue-blue)'])
  })
  it('❗抄表台账 / 表格共用:琥珀 / 珊瑚状态胶囊的底', () => {
    expect(look('<i class="mlg-st amber"></i>', 'i', 'background')).toEqual(['rgb(255,244,214)', 'var(--caution-soft)'])
    expect(look('<i class="mlg-st coral"></i>', 'i', 'background')).toEqual(['rgb(255,235,228)', 'var(--danger-bg)'])
    expect(look('<i class="mt-flag warn"></i>', 'i', 'background')).toEqual(['rgb(255,244,214)', 'var(--caution-soft)'])
  })
  it('❗参数中心高亮行', () => {
    expect(look('<table class="pm-table"><tbody><tr class="hl"><td>x</td></tr></tbody></table>', 'td', 'background'))
      .toEqual(['rgb(255,250,225)', 'var(--caution-soft)'])
  })
  it('❗对账簿收款方式胶囊:半透明底不用换,深色字暗色下换亮字', () => {
    expect(look('<i class="cw-kind bank"></i>', 'i', 'color')).toEqual(['rgb(10,90,170)', 'var(--hue-blue)'])
    expect(look('<i class="cw-kind wechat"></i>', 'i', 'color')).toEqual(['rgb(21,108,60)', 'var(--delta-up-text)'])
  })
  it('❗楼栋卡「快到期」胶囊(行内样式挪进样式表才挂得上暗色)', () => {
    expect(look('<span class="bc-exp"></span>', 'span', 'color')).toEqual(['rgb(168,98,0)', 'var(--hue-orange)'])
  })
  it('❗期间回退提示条:字 = --warn-text(同值),底浅色照旧、暗色 --warn-bg', () => {
    expect(look('<div class="ana-pbanner"></div>', 'div', 'background')).toEqual(['rgb(250,238,218)', 'var(--warn-bg)'])   // #faeeda
    expect(look('<div class="ana-pbanner"></div>', 'div', 'color')).toEqual(['var(--warn-text)', 'var(--warn-text)'])
  })
})

describe('「换令牌」改了浅色值的,改回原值', () => {
  it('❗身份漂移横幅:浅色 = master 上实际画出来的 #FAEDE7(那时 --warn-bg 没定义),暗色 --danger-bg', () => {
    expect(look('<div class="app-drift"></div>', 'div', 'background')).toEqual(['rgb(250,237,231)', 'var(--danger-bg)'])   // #FAEDE7
  })
  it('❗遮罩:抽屉原 28%、命令面板原 32%,不跟着 --scrim 变成 34%', () => {
    expect(look('<div class="fp-sdw-mask"></div>', 'div', 'background')[0]).toBe('color-mix(insrgb,var(--scrim)82.353%,transparent)')
    expect(look('<div class="fp-pal-backdrop"></div>', 'div', 'background')[0]).toBe('color-mix(insrgb,var(--scrim)94.118%,transparent)')
    expect((0.34 * 82.353 / 100).toFixed(4)).toBe('0.2800')
    expect((0.34 * 94.118 / 100).toFixed(4)).toBe('0.3200')
  })
  it('❗底部提示条 FPToast:原 80% 墨(--ink-700),不是实黑', () => {
    expect(look('<div class="fpt"></div>', 'div', 'background')[0]).toBe('color-mix(insrgb,var(--toast-bg)80%,transparent)')
  })
  it('❗版本更新「改进」胶囊的绿:浅色原值 oklch(0.47 0.1 150),暗色 --delta-up-text', () => {
    expect(look('<i class="wn-chip imp"></i>', 'i', 'color')).toEqual(['oklch(0.470.1150)', 'var(--delta-up-text)'])
  })
})

describe('登录页不跟外观(DARK-MODE-SPEC §4 白名单:整页是固定的暗色流动背景 + 白表单卡)', () => {
  it('❗样式里不引颜色令牌:引了的话选过深色的人登出后,错误提示拿到暗色的浅红压在白卡上(2.36:1)', () => {
    const css = readFileSync(join(SRC, 'views/LoginView.vue'), 'utf8').split('<style')[1].replace(/\/\*[\s\S]*?\*\//g, '')
    const refs = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])
    expect(refs.length, '判据没失效').toBeGreaterThan(0)
    expect(refs.filter((n) => !/^--(fw|fs|font|lg|dur|ease|radius|z)-/.test(n))).toEqual([])
  })
})
