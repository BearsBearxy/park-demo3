// 横条盘点 2026-10-03(第一类):导入中心顶部的假拖放区、附表10 手机档编辑横条 —— 并进已有位置,不再单独占一行。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8')

describe('横条并进已有位置', () => {
  // 破坏验证:把 .im-drop 块加回 → 红;副句去掉并进来的那半句 → 红
  it('❗导入中心:长得像拖放区却不收拖放的虚线块删掉,说明并进「按数据类型导入」的副句', () => {
    const s = read('import-center/ImportCenterView.vue')
    expect(s).not.toMatch(/class="im-drop/)
    expect(s).toContain('点卡片「上传」就地上传或粘贴,系统按模板列校验后入库</p>')
  })

  // 破坏验证:.s10-s-hint 那行加回 → 红;编辑签里去掉 s10-editflag-s → 红
  it('❗附表10:≤600 的「建议在桌面端操作」并进编辑签,不再是表格上方单独一行', () => {
    const s = read('sales-income/S10View.vue')
    expect(s).not.toContain('s10-s-hint')
    expect(s).toMatch(/class="s10-editflag">[\s\S]*?<span class="s10-editflag-s"> · 建议在桌面端操作<\/span>/)
    expect(s).toMatch(/@media \(max-width: 600px\) \{\s*\.s10-editflag-s \{ display:inline; \}/)
  })
})
