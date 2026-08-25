<script setup lang="ts">
// 未绑定租户问题面板(V105):台账 / 附表10 共用。每个账面名一张卡:
// 出现位置 + 金额 + 可一键绑定的精确命中 / 相近候选(子租户前缀·剥后缀·一字之差) + 手动选择器。
// 只读态(canAct=false)整面板可看不可操作——绑定是写,走编辑模式门(EDIT-MODE-SPEC §①)。
import { ref, computed } from 'vue'
import { suggestBind, type BindSuggestion } from '@/utils/tenantSuggest'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import type { FPTenantOption } from '@/components/fp/fpTenantPicker'
import Button from '@/components/ds/Button.vue'
import { iconFor } from '@/components/ds/icon'
import { finMoney } from '@/utils/finFmt'

export interface IssueGroup {
  name: string            // 账面名(未绑定行的 tenant_name 原文)
  count: number           // 该名下未绑定行数
  total: number           // 该名下金额合计(应收/收款口径由调用方定)
  where: string           // 出现位置摘要,如「1月 · 3月 · 10月」/「一期 2月」
}

const props = defineProps<{
  groups: IssueGroup[]
  tenants: { id: number; companyName: string; parentId?: number | null; aliases?: string | null; status?: number }[]
  canAct: boolean          // 编辑模式才允许绑定;false 时写入口整体不渲染(EDIT-MODE §1)
  actHint?: string         // canAct=false 时的提示文案
  /** 绑定动作(评审A4:必须回传 Promise,busy 锁才锁得住整个请求在途期) */
  onBind: (name: string, tenantId: number) => Promise<void>
}>()

const emit = defineEmits<{ 'goto-tenants': [] }>()

const Sparkles = iconFor('wand-2')
const UserPlus = iconFor('users')

// 每个名字的建议(纯函数,tenants/groups 变才重算)
const suggestions = computed<Record<string, BindSuggestion>>(() =>
  Object.fromEntries(props.groups.map(g => [g.name, suggestBind(g.name, props.tenants)])))

// 手动选择器候选(全部档案,含退租——导入月当时可能在租;退租户名后缀标注)
const pickerOptions = computed<FPTenantOption[]>(() =>
  props.tenants.map(t => ({
    id: t.id,
    name: t.status !== 1 ? `${t.companyName}(已退租)` : t.companyName,   // 状态枚举:1在租,其余(2退租/3黑名单)非在租
    parentName: null,
  })))

const picked = ref<Record<string, number | null>>({})
const busy = ref<string | null>(null)

async function doBind(name: string, tenantId: number) {
  if (!props.canAct || busy.value) return
  busy.value = name
  try { await props.onBind(name, tenantId) } finally { busy.value = null }
}
</script>

<template>
  <div class="tip-wrap">
    <p v-if="!groups.length" class="tip-empty">本表全部行都已对上租户档案,没有待处理的问题。</p>
    <template v-else>
      <p class="tip-lead">
        以下账面名没有对上租户档案,<b>数据已照常导入</b>,不影响合计;绑定后即可参与按租户的汇总与核对。
        绑定按账面名生效:<b>其他月份/公司的同名未绑定行会一并挂上</b>。
      </p>
      <p v-if="!canAct && actHint" class="tip-hint-ro">{{ actHint }}</p>

      <div v-for="g in groups" :key="g.name" class="tip-card">
        <div class="tip-head">
          <span class="tip-name" :title="g.name">{{ g.name }}</span>
          <span class="tip-meta">{{ g.count }} 行 · {{ finMoney(g.total) }}</span>
        </div>
        <div class="tip-where">{{ g.where }}</div>

        <!-- ① 精确命中:一键绑定(浏览态只显示结论,写入口不渲染 —— EDIT-MODE §1) -->
        <div v-if="suggestions[g.name]?.auto" class="tip-auto">
          <component :is="Sparkles" :size="14" class="ic" />
          <span class="txt">{{ suggestions[g.name]!.auto!.reason }}:「{{ suggestions[g.name]!.auto!.name }}」</span>
          <Button v-if="canAct" size="sm" :disabled="busy === g.name"
                  @click="doBind(g.name, suggestions[g.name]!.auto!.id)">绑定</Button>
        </div>

        <!-- ② 相近候选 -->
        <div v-for="c in suggestions[g.name]?.candidates ?? []" :key="c.id" class="tip-cand">
          <span class="txt">{{ c.reason }} → <b>{{ c.name }}</b></span>
          <Button v-if="canAct" size="sm" variant="ghost" :disabled="busy === g.name"
                  @click="doBind(g.name, c.id)">绑定为它</Button>
        </div>

        <!-- ③ 手动兜底(仅编辑态渲染) -->
        <div v-if="canAct" class="tip-manual">
          <FPTenantPicker
            v-model="picked[g.name]"
            :tenants="pickerOptions"
            placeholder="手动选择要绑定的租户…"
            empty-hint="档案里没有?去租户管理新增后回来绑定,或直接改表格里的账面名"
          />
          <Button size="sm" :disabled="picked[g.name] == null || busy === g.name"
                  @click="doBind(g.name, picked[g.name]!)">绑定</Button>
        </div>

        <div v-if="!suggestions[g.name]?.auto && !(suggestions[g.name]?.candidates ?? []).length" class="tip-none">
          档案中没有相近的租户。常见原因:新租户还没建档(去租户管理新增)、账面用了老板名/简称
          (在租户档案里加别名)、或名字写错(在表格里直接改账面名,改对后会自动配上)。
        </div>
      </div>

      <button class="tip-goto" @click="emit('goto-tenants')">
        <component :is="UserPlus" :size="14" />去租户管理新增 / 加别名
      </button>
    </template>
  </div>
</template>

<style scoped>
.tip-wrap { display: flex; flex-direction: column; gap: 12px; }
.tip-empty { margin: 24px 0; text-align: center; color: var(--text-muted); font-size: 14px; }
.tip-lead { margin: 0; font-size: 12px; line-height: 1.6; color: var(--text-secondary); }
.tip-hint-ro {
  margin: 0; font-size: 12px; color: var(--status-warning);
  background: var(--bg-sunken); border-radius: var(--radius-sm); padding: 8px 10px;
}
.tip-card {
  background: var(--surface-card); border-radius: var(--radius-md);
  padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;
}
.tip-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.tip-name {
  font-size: 14px; font-weight: 600; color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tip-meta { flex: 0 0 auto; font-size: 12px; color: var(--text-muted); font-family: var(--font-mono); }
.tip-where { font-size: 12px; color: var(--text-muted); }
.tip-auto, .tip-cand {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--text-secondary);
}
.tip-auto { color: var(--text-primary); }
.tip-auto .ic { flex: 0 0 auto; color: var(--status-success); }
.tip-auto .txt, .tip-cand .txt { flex: 1 1 auto; min-width: 0; }
.tip-manual { display: flex; align-items: center; gap: 8px; }
.tip-manual > :first-child { flex: 1 1 auto; min-width: 0; }
.tip-none { font-size: 12px; line-height: 1.6; color: var(--text-muted); }
.tip-goto {
  align-self: flex-start;
  display: inline-flex; align-items: center; gap: 6px;
  border: none; background: transparent; padding: 4px 0;
  font-size: 12px; color: var(--hue-blue); cursor: pointer;
}
</style>
