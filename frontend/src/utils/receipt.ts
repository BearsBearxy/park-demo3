// 结果回执(十件 ⑧;LAYOUT-STABILITY §4.1、UI-OVERLAY §7):刚做完的动作成没成。替代 alert()。
// 模块级队列,FPReceiptHost(挂在 AppShell)照它画:底部居中,旧的在上、新的在下,最多 3 条,第 4 条挤掉最旧。
// 成功 4 秒自收;警告、失败不自收,带 ×。动作钮(「重试」「刷新」「撤销」)点了就收。计时在 FPToast 里。
import { reactive } from 'vue'

export interface ReceiptAction { label: string; run: () => void }
/** n:同一句被推过几次。去重时 +1,FPToast 拿它当「重新计时」的信号 */
export interface Receipt { id: number; tone: 'ok' | 'warn' | 'fail'; text: string; action?: ReceiptAction; n: number }

/** 屏上的回执,旧的在前。测试里 receipts.splice(0) 复位 */
export const receipts = reactive<Receipt[]>([])
const MAX = 3
let seq = 0

function push(tone: Receipt['tone'], text: string, action?: ReceiptAction) {
  // 同一句再来(断网时每个失败请求都报一遍)不叠第二条:挪到最下面、换上新的动作;id 不变,不重播进场。
  // n +1:成功那 4 秒从这一次算起,不接着上一次剩下的(3.5 秒内再收藏一次,不能只亮半秒)
  const i = receipts.findIndex((r) => r.tone === tone && r.text === text)
  const r: Receipt = i >= 0 ? receipts.splice(i, 1)[0] : { id: ++seq, tone, text, n: 0 }
  r.n++
  r.action = action
  receipts.push(r)
  if (receipts.length > MAX) receipts.splice(0, receipts.length - MAX)
}

export const receipt = {
  ok: (text: string, action?: ReceiptAction) => push('ok', text, action),
  warn: (text: string, action?: ReceiptAction) => push('warn', text, action),
  fail: (text: string, action?: ReceiptAction) => push('fail', text, action),
  dismiss(id: number) {
    const i = receipts.findIndex((r) => r.id === id)
    if (i >= 0) receipts.splice(i, 1)
  },
}
