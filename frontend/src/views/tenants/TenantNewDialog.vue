<script setup lang="ts">
// 新增/编辑租户弹窗 — 样式 1:1 FinDialogs 的 .fin-mask/.fin-dlg(Teleport 居中弹窗,回车提交,错误行内提示)。
// 传 initial=编辑态(回填初值+状态下拉,提交走 update);不传=新增态,原流程不变。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { tenantApi } from '@/api/tenant'
import type { TenantCategoryDTO, TenantDTO } from '@/types/tenant'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'

const props = defineProps<{ initial?: TenantDTO | null }>()
const emit = defineEmits<{ close: []; created: []; updated: [] }>()

const isEdit = computed(() => !!props.initial)

const categories = ref<TenantCategoryDTO[]>([])
const allTenants = ref<TenantDTO[]>([])
const companyName = ref(props.initial?.companyName ?? '')
const businessType = ref(props.initial?.businessType ?? '')
const categoryId = ref<number | ''>(props.initial?.categoryId ?? '')
const contactName = ref(props.initial?.contactName ?? '')
const contactPhone = ref(props.initial?.contactPhone ?? '')
const phase = ref<number | ''>(props.initial?.phase ?? '')
const since = ref(props.initial?.since ?? '')
const remark = ref(props.initial?.remark ?? '')
const aliases = ref(props.initial?.aliases ?? '')   // 别名,逗号分隔(V86):worksheet老板名/曾用名
const status = ref(props.initial?.status ?? 1)
const parentId = ref<number | null>(props.initial?.parentId ?? null) // null=不关联
const err = ref('')
const busy = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  inputRef.value?.focus()
  try { categories.value = await tenantApi.categories() } catch { /* 下拉仅剩「未分类」,不阻断新增 */ }
  try { allTenants.value = await tenantApi.list() } catch { /* 关联下拉仅剩「不关联」,不阻断新增 */ }
})

// 下拉候选(ds/Select):值一律字符串,''=未分类,进出各转一道
const categoryOpts = computed(() =>
  [{ value: '', label: '未分类' }, ...categories.value.map(c => ({ value: String(c.id), label: c.name }))],
)
const STATUS_OPTS = [
  { value: '1', label: '在租' },
  { value: '2', label: '已退租' },
  { value: '0', label: '黑名单' },
]

// 关联主租户候选:在租且自身无 parent(仅一级关联)且 ≠ 正在编辑的租户
const parentOptions = computed(() =>
  allTenants.value.filter(t => t.status === 1 && t.parentId == null && t.id !== props.initial?.id),
)

// FPTenantPicker 候选形状:候选全是 root,parentName 一律 null(spec §T2)
const parentPickerOptions = computed(() =>
  parentOptions.value.map(t => ({ id: t.id, name: t.companyName, phase: t.phase, parentName: null })),
)

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

async function submit() {
  const name = companyName.value.trim()
  const biz = businessType.value.trim()
  if (!name) { err.value = '请输入企业名称'; return }
  if (!biz) { err.value = '请输入业务类型'; return }
  if (busy.value) return
  busy.value = true
  const req = {
    companyName: name,
    businessType: biz,
    contactName: contactName.value.trim() || undefined,
    contactPhone: contactPhone.value.trim() || undefined,
    categoryId: categoryId.value === '' ? null : categoryId.value,
    phase: phase.value === '' ? null : phase.value,
    since: since.value || null,
    remark: remark.value.trim() || undefined,
    parentId: parentId.value,
    aliases: aliases.value.trim() || null,
  }
  try {
    if (props.initial) {
      await tenantApi.update(props.initial.id, { ...req, status: status.value })
      emit('updated')
    } else {
      await tenantApi.create(req)
      emit('created')
    }
  } catch (e) {
    err.value = (e as { message?: string })?.message ?? (isEdit.value ? '保存失败' : '新增租户失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fin-mask" @mousedown="emit('close')">
      <div class="fin-dlg" role="dialog" aria-modal="true" @mousedown.stop>
        <div class="fin-dlg-h">
          <h3>{{ isEdit ? '编辑租户' : '新增租户' }}</h3>
          <p>{{ isEdit ? '修改该租户的主数据档案。月租金、面积等由合同派生,不在此编辑。'
                       : '创建一条租户主数据档案。月租金、面积等由合同派生,新租户暂为 0,签订合同后自动汇总。' }}</p>
        </div>
        <div class="fin-dlg-b">
          <div class="fin-field">
            <div class="lab">企业名称 <b class="req">*</b></div>
            <input ref="inputRef" class="fin-in" :class="{ err }" v-model="companyName"
                   placeholder="如:苏州精密机械有限公司" @input="err = ''" @keydown.enter="submit" />
          </div>
          <div class="fin-row">
            <div class="fin-field">
              <div class="lab">业务类型 <b class="req">*</b></div>
              <input class="fin-in" :class="{ err }" v-model="businessType"
                     placeholder="如:智能制造" @input="err = ''" @keydown.enter="submit" />
            </div>
            <div class="fin-field">
              <div class="lab">租户分类</div>
              <Select :options="categoryOpts" :model-value="categoryId === '' ? '' : String(categoryId)"
                      @update:model-value="categoryId = $event === '' ? '' : +$event" />
            </div>
          </div>
          <div class="fin-row">
            <div class="fin-field">
              <div class="lab">联系人</div>
              <input class="fin-in" v-model="contactName" placeholder="选填" @keydown.enter="submit" />
            </div>
            <div class="fin-field">
              <div class="lab">联系电话</div>
              <input class="fin-in" v-model="contactPhone" placeholder="选填" @keydown.enter="submit" />
            </div>
          </div>
          <div class="fin-row">
            <div class="fin-field">
              <div class="lab">主期数</div>
              <input class="fin-in" type="number" min="1" max="9" v-model.number="phase"
                     placeholder="选填 1-9" @keydown.enter="submit" />
            </div>
            <div class="fin-field">
              <div class="lab">入驻年月</div>
              <input class="fin-in" type="month" v-model="since" @keydown.enter="submit" />
            </div>
          </div>
          <div class="fin-row" v-if="isEdit">
            <div class="fin-field">
              <div class="lab">状态</div>
              <Select :options="STATUS_OPTS" :model-value="String(status)"
                      @update:model-value="status = +$event" />
            </div>
            <div></div>
          </div>
          <div class="fin-field">
            <div class="lab">关联主租户</div>
            <!-- 可搜索选择器;「不关联」=null,placeholder 即空态,选中后可用旁边 × 清除 -->
            <div class="fin-parent-row">
              <FPTenantPicker v-model="parentId" :tenants="parentPickerOptions" placeholder="不关联" style="flex:1;min-width:0" />
              <button v-if="parentId != null" type="button" class="fin-clear" title="清除关联(不关联)" @click="parentId = null">
                <component :is="iconFor('x')" :size="14" />
              </button>
            </div>
          </div>
          <div class="fin-field">
            <div class="lab">别名 · 导入匹配用</div>
            <input class="fin-in" v-model="aliases" placeholder="选填,逗号分隔(如财务表用的老板名:李富全)"
                   title="园区财务 worksheet 常用老板名/曾用名;导入与一键挂租户按名匹配时,别名与正名同权" @keydown.enter="submit" />
          </div>
          <div class="fin-field">
            <div class="lab">备注</div>
            <input class="fin-in" v-model="remark" placeholder="选填" @keydown.enter="submit" />
          </div>
          <div class="fin-erm">{{ err }}</div>
        </div>
        <div class="fin-dlg-f">
          <Button variant="gray" size="sm" @click="emit('close')">取消</Button>
          <Button variant="filled" size="sm" :disabled="busy" @click="submit">
            <template #leading><component :is="iconFor('check')" :size="14" /></template>
            {{ isEdit ? '保存' : '创建' }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 1:1 FinDialogs.vue .fin-mask/.fin-dlg(居中弹窗,遵 DESIGN-FIDELITY §7) */
.fin-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:300; display:grid; place-items:center; padding:24px; box-sizing:border-box; backdrop-filter:blur(2px); opacity:0; animation:fp-fade-in var(--dur-base) forwards; }
.fin-dlg { width:min(480px,92vw); max-height:88vh; overflow-y:auto; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:16px; box-shadow:0 24px 64px rgba(28,28,28,.28); animation:fp-rise-in var(--dur-base) var(--ease-standard) both; }
.fin-dlg-h { padding:20px 22px 0; }
.fin-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.fin-dlg-b { padding:18px 22px 4px; display:flex; flex-direction:column; gap:14px; }
.fin-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.fin-field .lab { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); margin-bottom:7px; }
.fin-field .req { color:var(--hue-red); font-weight:var(--fw-medium); }
/* 高度对齐设计系统 md=36(ds/Input 与 ds/Select 同档):此前 38/40px,而同一表单网格里的
   下拉已是 ds/Select 的 36px,并排就差 2~4px。改这里而不是改 Select —— 36 是三个 ds 控件
   (Button/Input/Select)共同的 md 档,38/40 才是各表单自己发明的。 */
.fin-in { width:100%; box-sizing:border-box; height:36px; padding:0 12px; font-size:var(--fs-body); color:var(--text-primary); border:1px solid var(--border-subtle); border-radius:var(--radius-md); outline:none; background:var(--surface-white); font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.fin-in:focus { border-color:var(--hue-blue); }
.fin-in.err { border-color:var(--hue-red); }
.fin-erm { font-size:11.5px; color:var(--hue-red); margin-top:-6px; min-height:14px; }
/* 关联主租户:选择器 + 清除小按钮(回到「不关联」) */
.fin-parent-row { display:flex; align-items:center; gap:8px; }
.fin-clear { flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; padding:0; border:1px solid var(--border-subtle); border-radius:var(--radius-sm); background:var(--surface-white); color:var(--text-muted); cursor:pointer; transition:border-color var(--dur-fast) var(--ease-standard); }
.fin-clear:hover { border-color:var(--border-strong); color:var(--text-secondary); }
.fin-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }
</style>
