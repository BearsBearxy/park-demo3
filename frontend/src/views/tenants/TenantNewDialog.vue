<script setup lang="ts">
// 新增/编辑租户弹窗 — 样式 1:1 FinDialogs 的 .fin-mask/.fin-dlg(Teleport 居中弹窗,回车提交,错误行内提示)。
// 传 initial=编辑态(回填初值+状态下拉,提交走 update);不传=新增态,原流程不变。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { tenantApi } from '@/api/tenant'
import type { TenantCategoryDTO, TenantDTO } from '@/types/tenant'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'

const props = defineProps<{ initial?: TenantDTO | null }>()
const emit = defineEmits<{ close: []; created: []; updated: [] }>()

const isEdit = computed(() => !!props.initial)

const categories = ref<TenantCategoryDTO[]>([])
const companyName = ref(props.initial?.companyName ?? '')
const businessType = ref(props.initial?.businessType ?? '')
const categoryId = ref<number | ''>(props.initial?.categoryId ?? '')
const contactName = ref(props.initial?.contactName ?? '')
const contactPhone = ref(props.initial?.contactPhone ?? '')
const phase = ref<number | ''>(props.initial?.phase ?? '')
const since = ref(props.initial?.since ?? '')
const remark = ref(props.initial?.remark ?? '')
const status = ref(props.initial?.status ?? 1)
const err = ref('')
const busy = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  inputRef.value?.focus()
  try { categories.value = await tenantApi.categories() } catch { /* 下拉仅剩「未分类」,不阻断新增 */ }
})

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
              <select class="fin-in" v-model="categoryId">
                <option value="">未分类</option>
                <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
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
              <select class="fin-in" v-model.number="status">
                <option :value="1">在租</option>
                <option :value="2">已退租</option>
                <option :value="0">黑名单</option>
              </select>
            </div>
            <div></div>
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
.fin-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:300; display:grid; place-items:center; padding:24px; box-sizing:border-box; backdrop-filter:blur(2px); opacity:0; animation:finfade .16s forwards; }
@keyframes finfade { to { opacity:1; } }
.fin-dlg { width:min(480px,92vw); max-height:88vh; overflow-y:auto; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:16px; box-shadow:0 24px 64px rgba(28,28,28,.28); animation:finrise .2s var(--ease-standard) both; }
@keyframes finrise { from { opacity:0; transform:translateY(8px) scale(.985); } to { opacity:1; transform:translateY(0) scale(1); } }
.fin-dlg-h { padding:20px 22px 0; }
.fin-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.fin-dlg-b { padding:18px 22px 4px; display:flex; flex-direction:column; gap:14px; }
.fin-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.fin-field .lab { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); margin-bottom:7px; }
.fin-field .req { color:var(--hue-red); font-weight:var(--fw-medium); }
.fin-in { width:100%; box-sizing:border-box; height:40px; padding:0 12px; font-size:13.5px; color:var(--text-primary); border:1px solid var(--border-subtle); border-radius:var(--radius-md); outline:none; background:var(--surface-white); font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.fin-in:focus { border-color:var(--hue-blue); }
.fin-in.err { border-color:var(--hue-red); }
.fin-erm { font-size:11.5px; color:var(--hue-red); margin-top:-6px; min-height:14px; }
.fin-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:16px 22px 20px; }
</style>
