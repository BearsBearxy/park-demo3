// 确认弹窗(十件 ⑨;UI-OVERLAY §7、LAYOUT-STABILITY §4.1):不回答就不能往下走。替代 confirm()。
// FPConfirmHost(挂在 AppShell)只画队头一条,答完 resolve 再出下一条。
// 不并进来的:SaveConfirmDialog(保存 / 放弃 / × 三钮);必须处理的弹窗(编辑权被接管等,点外面、Esc 都不关)。
import { reactive } from 'vue'

export interface AskOpts {
  /** 问句或后果:「删除 2023-08 全部读数？」 */
  title: string
  /** 给数:「共 76 条已录读数，删除后不能撤销。」(数字自动加粗) */
  body?: string
  /** 主按钮写动作本身:「删除 76 条」,不写「确定」 */
  action: string
  cancel?: string
  /** 删除类:主按钮红、默认焦点在「取消」 */
  danger?: boolean
  /** 要对方写一句(如原因):正文下出一个输入框,写了字主按钮才能点;用 askText 发 */
  input?: { label: string; placeholder?: string }
}
export interface Asking extends AskOpts { resolve: (ok: boolean) => void; text?: string }

/** 排队的确认,队头正在显示 */
export const askQueue = reactive<Asking[]>([])

export function ask(o: AskOpts): Promise<boolean> {
  return new Promise((resolve) => { askQueue.push({ ...o, resolve }) })
}

/** 带输入框的确认:主按钮回填写的字(去掉首尾空白),取消回 null */
export function askText(o: AskOpts & { input: NonNullable<AskOpts['input']> }): Promise<string | null> {
  return new Promise((resolve) => {
    const item: Asking = { ...o, text: '', resolve: (ok) => resolve(ok ? (item.text ?? '').trim() : null) }
    askQueue.push(item)
  })
}

/** 答复队头(FPConfirmHost 调):主按钮 true;取消 / Esc / 点外面 false */
export function answer(ok: boolean) {
  askQueue.shift()?.resolve(ok)
}

/** 离开确认(02-A):0 处改动不弹,直接放行。approx = 改动数是「开着就算 1」那种(auth approxDirty),不报处数 */
export function askLeave({ page, count, verb = '关闭', approx = false }: { page: string; count: number; verb?: string; approx?: boolean }): Promise<boolean> {
  if (count <= 0) return Promise.resolve(true)
  return ask({
    title: `${verb}「${page}」？`,
    body: approx ? `这页正在编辑，${verb}后没保存的内容会丢。` : `这页有 ${count} 处改动还没保存。`,
    action: `放弃改动并${verb}`,
    cancel: '继续编辑',
    danger: true,
  })
}
