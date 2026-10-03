// 导入弹窗的「点下去之后」(UI-OVERLAY-SPEC §8、IMPORT-GUIDE §二·导入进度):接线协议 + 进度卡的状态。
//
// 接线协议(FpImportModal 的可选 prop):
//   runner(payload, fileName, p)  给了才走进度卡 —— 点导入后弹窗不关,内容区换成进度卡,跑完原地变结果卡 / 失败卡。
//                                 不给 = 旧行为(emit import / importSections,各屏自己关窗、发请求、出结果)。
//                                 runner = 写入 + 记导入记录(runImport)+ 刷新本页,收尾用 settle(res, p, refresh):
//                                 走到「刷新本页」再刷新,成败放进 refreshed(刷新失败不算导入失败,结果卡照实写「本页没刷新上」)。
//                                 抛错 → 失败卡(按 failKind 分);返回 null = 屏自己没跑(如已退出编辑),弹窗回到预览。
//   segmented                     逐段(附表10):每段一次请求,runner 每写完一段调 p.segDone,从 p.from 段开始发
//                                 (registry 的 s10 run 认 ctx._run = p,屏只要把 p 塞进 ctx)。
//                                 非逐段也建议把 p 塞进 ctx._run:runImport 写完会调 p.recording()(步骤走到「记下这次导入」),
//                                 三大报表的 run 核完公司调 p.note('核对公司', '新建 n 家') + p.stage('写入')(步骤表里没有这两步就不动),
//                                 整单被拒时调 p.kept(「新建的 N 家公司已留下」)。
//                                 一次导入发多次请求的(工资逐月 / 水电逐年 / 台账逐公司)每写完一次调 p.wrote(累计写入数)。
//   confirm(payload, fileName)    点导入后、开跑前的确认(台账覆盖预检等);返回 false 不跑。
//   describe(payload, fileName)   进度卡标题的数与单位、副标题、步骤表(科目余额表「6,907 格 · 6 家公司」用);不给按条数。
//   go / doneNote                 结果卡多一颗按钮(导入中心「去查看」)/ 结果卡右上那句(缺省跟步骤表最后一步走:「刷新本期」→「本期已刷新」)。
import { ref } from 'vue'
import type { ImportResultDTO } from '@/types/import'

/** 正在跑的导入弹窗数(D14 导入中关不掉)。屏在「编辑态转假 / 页签停用」时收写浮层,导入窗要先看它:
 *  在跑就留着 —— runner 不会因为弹窗卸了就停,卸了只是让人看不到写进去多少、断在哪。跑完由人点「知道了 / 关闭」;
 *  失锁后再点导入 / 接着导,由 runner 的写口自守挡(返回 null)。 */
export const importBusy = ref(0)

export interface ImportRunProgress {
  /** 逐段:从第几段开始发(0 基;「从第 k 段接着导」时 > 0,前面的段不重发) */
  from: number
  /** 逐段:from 之前那些段已经写入的结果之和(registry 并进总数再记导入记录) */
  base: ImportResultDTO
  /** 逐段:第 k 段写完了 */
  segDone: (k: number, res: ImportResultDTO) => void
  /** 走到第 i 步(0 基,之前的都算完成);给字符串 = 名字以它开头的那步,步骤表里没有就不动 */
  stage: (i: number | string) => void
  /** 走到倒数第二步「记下这次导入」(写入完了;runImport 记导入记录前调) */
  recording: () => void
  /** 走到最后一步「刷新本页」(写入与导入记录都完了) */
  refreshing: () => void
  /** 第 i 步右侧的注(如「6 张余额表」「新建 0 家」) */
  note: (i: number | string, text: string) => void
  /** 整单被拒时仍然留下的东西,失败卡上多写一句(如「新建的 2 家公司已留下」) */
  kept: (text: string) => void
  /** 非逐段但要发多次请求的(逐月 / 逐年 / 逐公司):到目前已经写进库的条数,每次请求写完报一次。
   *  后面一次失败时前面的不回滚 —— 失败卡据此不写「一条都没写进去」 */
  wrote: (n: number) => void
}

/** runner 的返回:结果 + 可选的分项明细(结果卡两列,如「创显 · 830 科目 · 2,542 格」「2025 年 10 月 · 二期 · 78 条」) */
export type ImportOutcome = ImportResultDTO & { detail?: [string, string][]; refreshed?: boolean }

export interface ImportDescribe { count?: number; unit?: string; meta?: string; steps?: string[] }

export interface RunState {
  seg: boolean
  count: number
  unit: string
  meta: string
  steps: { label: string; note: string }[]
  stage: number
  /** 秒 */
  elapsed: number
  /** 逐段:每段的标签、发出的条数 n、后端回的写入数 ok(写完才有;跳过的行不算写入) */
  segs: { label: string; n: number; ok: number }[]
  /** 逐段:已写完的段数(含「接着导」之前写完的) */
  done: number
  fail: { kind: FailKind; reason: string } | null
  kept: string
  /** 非逐段的多次请求:失败前已经写进库的条数(见 ImportRunProgress.wrote) */
  wrote: number
}

/** lost = 请求发出后没有回应(写没写进去不知道);server = 5xx(事务回滚);reject = 4xx、业务码、前端自己抛的。
 *  逐段导入里 lost / server 可以从断的那段接着导;reject 整单拒,回去改。 */
export type FailKind = 'lost' | 'server' | 'reject'

/** 拦截器把带信封的错误换成了信封本身(code 是数),没信封的保留 AxiosError(看 response)。 */
export function failKind(e: unknown): FailKind {
  const x = e as { code?: unknown; isAxiosError?: boolean; response?: { status?: number } } | null
  if (typeof x?.code === 'number') return x.code >= 500 ? 'server' : 'reject'
  if (x?.isAxiosError) return !x.response ? 'lost' : (x.response.status ?? 0) >= 500 ? 'server' : 'reject'
  return 'reject'
}

export function failReason(e: unknown): string {
  const x = e as { message?: unknown; isAxiosError?: boolean; response?: { status?: number } } | null
  if (x?.isAxiosError) return x.response ? `服务器返回 ${x.response.status}` : '请求发出后没有回应'
  return typeof x?.message === 'string' && x.message ? x.message : '没有给出原因'
}

/** 秒 → m:ss */
export const mss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** 千分位整数(屏上计数不截断,mono 字体) */
export const n0 = (n: number) => n.toLocaleString('en-US')

/** runner 的收尾:写完走到「刷新本页」,刷新的成败照实带回(刷新失败不算导入失败,结果卡写「本页没刷新上」) */
export async function settle(res: ImportResultDTO, p: ImportRunProgress | undefined, refresh: () => Promise<unknown>): Promise<ImportOutcome> {
  p?.refreshing()
  return { ...res, refreshed: await refresh().then(() => true, () => false) }
}

/** 结果求和(逐段累计用) */
export function addResult(a: ImportResultDTO, b: ImportResultDTO): ImportResultDTO {
  return {
    imported: a.imported + b.imported,
    skipped: a.skipped + b.skipped,
    errors: [...a.errors, ...b.errors],
    notices: [...(a.notices ?? []), ...(b.notices ?? [])],
  }
}
