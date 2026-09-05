<script setup lang="ts">
// 操作日志(RBAC-SPEC §7 P2)。三张来源表 —— param_change_log / import_log / auth_audit_log ——
// 在**后端** union 后按时间倒序返回,这一屏只负责把它们摆成一条能读的时间线。
//
// ⚠ 三张表不合并成一张通用表:param 有 old/new/cfg_key、import 有 rows/ok/warn,合并就得塞 JSON,
//   那两屏的历史查询反而难写。**归一只发生在展示层**,也就是本文件。
//
// ⚠ 服务端分页(不是前端切片):param_change_log 随每次改参数只涨不跌,全捞进内存再切迟早撑爆。
//   换页、改筛选、窗口高度变导致每页行数变 —— 三条路径都必须重新发请求。
//
// 全屏只读,只需 system:view(整层无权时导航不显示、路由守卫也会兜),所以屏内不做任何权限判断。
import { ref, computed, onMounted, watch } from 'vue'
import { onReactivated } from '@/composables/onReactivated'
import { systemApi } from '@/api/system'
import type { AuditRowDTO } from '@/types/system'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Select from '@/components/ds/Select.vue'
import Badge from '@/components/ds/Badge.vue'
import FPPager from '@/components/fp/FPPager.vue'
import { useFitRows } from '@/components/fp/useFitRows'
import { iconFor } from '@/components/ds/icon'

// ─── 三路来源的语义色(左侧徽标靠它区分) ──────────────────────────
const SRC = {
  param: { label: '计费参数', tone: 'blue' as const, color: 'var(--hue-blue)' },
  import: { label: '导入', tone: 'cyan' as const, color: 'var(--hue-cyan)' },
  auth: { label: '账号与角色', tone: 'orange' as const, color: 'var(--hue-orange)' },
}
// 后端只认这三个来源,但真冒出第四种也要看得见(而不是渲染成一行没有徽标的孤儿)
const OTHER = { label: '其他', tone: 'neutral' as const, color: 'var(--ink-500)' }

// 动作码翻人话。查不到就原样显示 —— 吞掉未知动作等于审计有洞。
const ACTION: Record<string, string> = {
  // param_change_log.action
  set: '设置', delete: '删除', recalc: '重算', migrate: '迁移',
  // import_log.status(文案与导入中心「已拒绝」一致)
  complete: '导入完成', partial: '部分导入', rejected: '已拒绝',
  // auth_audit_log.action
  'user.create': '新建账号', 'user.update': '改账号', 'user.enable': '启用账号',
  'user.disable': '停用账号', 'user.reset-password': '重置密码', 'user.change-password': '修改密码',
  'role.create': '新建角色', 'role.update': '改角色权限', 'role.delete': '删除角色',
  'lock.takeover': '接管编辑锁', 'lock.force-release': '强制解锁',
}

// ─── state ───────────────────────────────────────────────
const rows = ref<AuditRowDTO[] | null>(null)   // null = 首载未完成(不闪「共 0 条」空态)
const total = ref(0)
const actors = ref<string[]>([])
const loadErr = ref('')

const src = ref('')      // '' = 全部来源
const actor = ref('')    // '' = 全部操作人
const from = ref('')     // YYYY-MM-DD,含当天 00:00
const to = ref('')       // YYYY-MM-DD,后端按「含结束当天全天」处理
const page = ref(1)
const listWrapEl = ref<HTMLElement | null>(null)
const pageSize = useFitRows(listWrapEl)

// ─── 取数(服务端分页) ────────────────────────────────────
// 记住本次请求用的每页行数:窗口高度变 → pageSize 变 → 才重新请求(避免挂载期重复发一次)
let lastSize = 0
async function load() {
  loadErr.value = ''
  lastSize = pageSize.value
  try {
    const r = await systemApi.logs({
      src: src.value || undefined,
      actor: actor.value || undefined,
      from: from.value || undefined,
      to: to.value || undefined,
      page: page.value,
      size: pageSize.value,
    })
    rows.value = r.rows
    total.value = r.total
    actors.value = r.actors
  } catch (e) {
    rows.value = null                                  // 失败不留半截旧数据在屏上
    loadErr.value = (e as { message?: string })?.message || '服务异常'
  }
}
onMounted(load)
// 侧栏点击自 P3 起是「恢复现场」,不再重建实例 —— 纯读屏没有草稿要保,
// 切回来该看最新的(导入中心导完租户,回这屏必须是新名单)。
onReactivated(() => { void load() })

// 改筛选 = 回第一页 + 重新请求。翻页走 FPPager 的 @page(不另设 page 的 watch,
// 否则「筛选里顺带把 page 拨回 1」会连带触发一次,同一次交互发两个请求)。
watch([src, actor, from, to], () => { page.value = 1; load() })
watch(pageSize, (n) => { if (n !== lastSize) { page.value = 1; load() } })
function goPage(n: number) { page.value = n; load() }

// ─── 筛选选项 ─────────────────────────────────────────────
const SRC_OPTS = [
  { value: '', label: '全部来源' },
  { value: 'param', label: '计费参数' },
  { value: 'import', label: '导入' },
  { value: 'auth', label: '账号与角色' },
]
// 操作人来自返回的 actors(三表并集),与当前筛选无关 —— 筛出 0 条时下拉不会跟着空掉
const actorOpts = computed(() => [
  { value: '', label: '全部操作人' },
  ...actors.value.map(a => ({ value: a, label: a })),
])
const hasFilter = computed(() => !!(src.value || actor.value || from.value || to.value))
function clearFilters() { src.value = ''; actor.value = ''; from.value = ''; to.value = '' }

// ─── 展示层归一 ───────────────────────────────────────────
const fmtTime = (s: string) => (s ? s.replace('T', ' ').slice(0, 16) : '—')

// 模板里不调返回新对象的函数(LIST-PAGE-SPEC §8):徽标/动作/标题一次算完
const view = computed(() => (rows.value ?? []).map((r, i) => {
  const m = SRC[r.source as keyof typeof SRC] ?? OTHER
  const act = ACTION[r.action] ?? r.action
  const detail = r.detail || ''
  const authorizer = r.authorizer || ''
  return {
    key: `${r.source}-${r.ts}-${i}`,
    source: r.source,
    srcLabel: m.label,
    tone: m.tone,
    color: m.color,
    ts: fmtTime(r.ts),
    actor: r.actor || '—',
    act,
    target: r.target || '—',
    detail,
    authorizer,
    // 一行读起来像一句话:谁 · 什么时候 · 对什么 · 做了什么(截断时靠 title 出全文)
    title: [`${m.label} · ${fmtTime(r.ts)}`, r.actor || '—', act, r.target || '—', detail,
      authorizer && `由 ${authorizer} 授权`].filter(Boolean).join('  ·  '),
  }
}))

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
</script>

<template>
  <!-- 根收编 .mx-page(迁移①):内联 height:100% 媒体查询盖不住,S 档高度链三件套要在类上生效;
       fp-fluid = 摘掉 base.css 的 800px 屏级地板(通过 §9 验收的标志) -->
  <div class="mx-page fp-fluid">
    <!-- 1. 标题行 -->
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div>
        <h2 style="margin:0;font-size:var(--fs-h2);font-weight:var(--fw-semibold)">操作日志</h2>
        <p style="margin:5px 0 0;font-size:var(--fs-label);color:var(--text-muted)">
          系统管理 · 计费参数、导入、账号与角色三路留痕,按时间倒序 · 共 {{ rows ? total : '…' }} 条
        </p>
      </div>
    </div>

    <!-- 2. 工具栏(LIST-PAGE-SPEC §2:单行,筛选靠右)。本屏无期别/分组维度,左侧留空撑开 space-between。
         首载/失败时也照常渲染:①失败了筛选条件还在屏上,重试不用重设;
         ②卡片壳从挂载起就存在,useFitRows 在首次请求前就量到了每页行数,不会「先按兜底 10 行发一次、
           量完再发一次」——服务端分页下那就是每次进屏白发一个请求。 -->
    <div class="mx-toolbar">
      <span aria-hidden="true" />
      <div class="mx-toolbar-right">
        <Button v-if="hasFilter" variant="outline" size="sm" @click="clearFilters">清除筛选</Button>
        <!-- 下拉一律 ds/Select,不用原生 <select>(UI-CONSISTENCY-SPEC §1) -->
        <div style="width:132px">
          <Select :options="SRC_OPTS" v-model="src" size="sm" />
        </div>
        <div style="width:150px">
          <Select :options="actorOpts" v-model="actor" size="sm" />
        </div>
        <label class="lg-range" :class="{ on: !!(from || to) }" title="按时间范围筛,止日含当天全天">
          <component :is="iconFor('calendar')" :size="15" />
          <input type="date" v-model="from" aria-label="起始日期" />
          <span class="lg-range-sep">至</span>
          <input type="date" v-model="to" aria-label="结束日期" />
        </label>
      </div>
    </div>

    <!-- 3. 时间线卡片(骨架同列表页:卡片定高 + 分页条贴底,LIST-PAGE-SPEC §3) -->
    <Card surface="white" :padding="0" class="mx-listcard">
      <div ref="listWrapEl" class="lg-wrap">
        <div v-for="r in view" :key="r.key" class="lg-row" :data-src="r.source" :title="r.title">
          <span class="lg-rail"><span class="lg-dot" :style="{ background: r.color }" /></span>
          <span class="lg-badge">
            <Badge :tone="r.tone" variant="solid" :dot="false">{{ r.srcLabel }}</Badge>
          </span>
          <span class="lg-ts">{{ r.ts }}</span>
          <span class="lg-actor">{{ r.actor }}</span>
          <span class="lg-act">{{ r.act }}</span>
          <span class="lg-what">
            <span class="lg-target">{{ r.target }}</span>
            <span v-if="r.detail" class="lg-detail">{{ r.detail }}</span>
          </span>
          <!-- 代他人执行的动作必须把授权人也显示出来:审计要记两个人,
               只显示操作人的话「谁批准的」就白记了 -->
          <span v-if="r.authorizer" class="lg-auth">
            <component :is="iconFor('shield-check')" :size="12" />
            由 {{ r.authorizer }} 授权
          </span>
        </div>
        <!-- 空/加载/失败三态都留在 wrap 内:wrap 是 useFitRows 的量高对象,
             v-if 掉整块会让每页行数失去测量锚点 -->
        <div v-if="rows && view.length === 0" class="lg-empty">
          {{ hasFilter ? '这个筛选条件下没有操作记录 —— 换个来源、操作人或日期范围试试。' : '还没有任何操作记录。' }}
        </div>
        <FPLoadError v-else-if="loadErr" class="lg-center" @retry="load">
          <span>操作日志没加载出来:{{ loadErr }} —— 屏上不显示任何记录,重试成功前查不到留痕。</span>
        </FPLoadError>
        <div v-else-if="!rows" class="page-loading"><span class="page-spin" /></div>
      </div>
      <div v-if="view.length > 0" class="mx-pagerbar">
        <FPPager :page="page" :pageCount="pageCount" :total="total" @page="goPage" />
      </div>
    </Card>
  </div>
</template>

<style scoped>
/* 加载失败条(1:1 SystemUsersView .su-bar.err);margin:auto 0 让它在卡片里竖向居中 */
/* 失败条在定高卡片里垂直居中 —— 原 .lg-bar 靠 `margin: auto 0` 做到,
   换成 FPLoadError 之后由这一条接手(组件只管自己的样子,不管宿主怎么摆)。 */
.lg-center { margin: auto 0; }
/* 日期范围(1:1 ContractsView .mx-asof,贴合工具栏其它控件高度) */
.lg-range { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-white); color: var(--text-muted); cursor: pointer; }
.lg-range.on { border-color: var(--hue-blue); color: var(--hue-blue); }
.lg-range input[type="date"] { width: 118px; border: none; outline: none; background: none; font-size: var(--fs-label); font-family: var(--font-mono); color: var(--text-primary); cursor: pointer; }
.lg-range-sep { font-size: var(--fs-label); color: var(--text-muted); }

/* 时间线容器:高度由布局链撑满,禁止滚动条 —— 每页行数由 useFitRows 保证恰好放满(LIST-PAGE-SPEC §6)。
   竖向 flex 是为了首载/失败态(.page-loading / FPLoadError 都靠 flex 与 auto margin)在卡片里居中 */
.lg-wrap { flex: 1 1 auto; overflow: hidden; padding: 10px 16px 0; display: flex; flex-direction: column; }

/* 行:等高铁律(--mx-row-h),内容一律 nowrap + ellipsis,全文走 title。
   flex:0 0 auto —— 行高是布局常量,任何情况下都不许被压缩(差一行就把等高铁律破了) */
.lg-row { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; height: var(--mx-row-h, 56px); border-bottom: 1px solid var(--divider); }
.lg-row:hover { background: var(--bg-panel); }
.lg-row:last-child { border-bottom: none; }

/* 时间线竖轴:一条贯穿的细线 + 每行一个来源色圆点(首尾两行只画半截,不让线悬空) */
.lg-rail { position: relative; flex: 0 0 13px; align-self: stretch; }
.lg-rail::before { content: ''; position: absolute; left: 6px; top: 0; bottom: 0; width: 1px; background: var(--divider); }
.lg-row:first-child .lg-rail::before { top: 50%; }
.lg-row:last-child .lg-rail::before { bottom: 50%; }
.lg-dot { position: absolute; left: 2px; top: 50%; margin-top: -4px; width: 9px; height: 9px; border-radius: 50%; box-shadow: 0 0 0 3px var(--surface-white); }

.lg-badge { flex: 0 0 92px; overflow: hidden; }
.lg-ts { flex: 0 0 124px; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-muted); }
.lg-actor { flex: 0 0 92px; font-size: var(--fs-body); font-weight: var(--fw-medium); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lg-act { flex: 0 0 84px; font-size: var(--fs-label); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 唯一的弹性列(列宽铁律:至多一列不定宽) */
.lg-what { flex: 1 1 auto; min-width: 0; display: flex; align-items: baseline; gap: 10px; overflow: hidden; }
.lg-target { flex: 0 1 auto; font-size: var(--fs-body); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lg-detail { flex: 1 1 auto; min-width: 0; font-size: var(--fs-label); color: var(--text-muted); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 授权人:审计的第二个人,给足对比度别当装饰淡化掉 */
.lg-auth { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: var(--radius-full); background: rgba(255, 149, 0, 0.12); color: rgb(190, 110, 0); font-size: var(--fs-label); font-weight: var(--fw-medium); white-space: nowrap; }

.lg-empty { margin: auto 0; text-align: center; padding: 40px; color: var(--text-disabled); font-size: var(--fs-body); }

/* ── 响应式(RESPONSIVE-LAYOUT-SPEC §5.1 迁移③/②)——宽档在前窄档在后 ── */
/* M(≤960):工具栏两行收纳 —— 右组(两 Select + 日期范围)~590px,601px 附近一行放不下。
   行的定宽列合计也 ~590px:M 档改卡内横滚(同 §5.3 宽表口径),行高/每页行数的 56px 口径不动 */
@media (max-width: 960px) {
  .mx-toolbar-right { flex-wrap: wrap; justify-content: flex-end; }
  .lg-wrap { overflow-x: auto; }
  .lg-row { min-width: 640px; }
}
/* S(≤600):行转两行卡 —— 72px 定高与 .mx-rowcard 同节奏(本屏不走 FPSortableTable,
   卡片几何只能在此对齐)。第一行 谁·做了什么·对什么,第二行 来源徽标·时间·授权人;
   时间线竖轴是装饰,窄屏收掉。grid 布局下上面 flex 定宽自动失效,无需逐列重置 */
@media (max-width: 600px) {
  .lg-wrap { overflow: visible; }               /* 高度链三件套③的本屏对应物(容器不是 .mx-tablewrap) */
  .lg-rail { display: none; }
  .lg-row {
    height: 72px;
    box-sizing: border-box;
    min-width: 0;
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    grid-template-areas: 'actor act what' 'badge ts auth';
    align-content: center;
    column-gap: 10px;
    row-gap: 4px;
  }
  .lg-actor { grid-area: actor; max-width: 40vw; }  /* 超长操作人名不许把 390 撑破,截断走 title */
  .lg-act { grid-area: act; }
  .lg-what { grid-area: what; }
  .lg-badge { grid-area: badge; }
  .lg-ts { grid-area: ts; }
  .lg-auth { grid-area: auth; justify-self: end; }
}
</style>
