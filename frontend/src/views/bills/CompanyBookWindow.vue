<script setup lang="ts">
// 收款公司管理窗口(S20-BILL-DELIVERY-SPEC §4):左栏公司列表(新增/改名/停用),
// 右栏该公司三字段(显示名/短名/法定全称)+ 收款账户列表(增删改/设默认/kind 徽标)。
// 容器与二次确认范式同 CoefBookWindow(居中 FPDrawer + 未保存改动挡在切换/关闭前)。
// 本刀只交付「能用的空表单」:公司名必填,其余全选填 —— 账户明细由用户逐条补录。
// 法定全称印在通知单落款与账户块(空则回落显示名);停用公司不再进收款公司选择器,历史单不受影响。
import { computed, ref, watch } from 'vue'
import {
  ACCOUNT_KINDS, ACCOUNT_KIND_LABEL, companyBookApi,
  type AccountKind, type AccountReq, type CompanyAccountDTO, type CompanyFullDTO,
} from '@/api/billDelivery'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const auth = useAuthStore()
const canEdit = computed(() => auth.can('master:edit'))   // 收款公司/账户属主数据(RBAC-SPEC §2)
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback

const loading = ref(false)
const saving = ref(false)
const companies = ref<CompanyFullDTO[]>([])
const selId = ref<number | null>(null)        // null + creating=false → 未选中
const creating = ref(false)
const okMsg = ref('')
let okTimer: ReturnType<typeof setTimeout> | undefined
function flashOk(msg: string) {
  okMsg.value = msg
  clearTimeout(okTimer)
  okTimer = setTimeout(() => { okMsg.value = '' }, 4000)
}

// ── 公司表单 ──
const form = ref({ name: '', short: '', fullName: '', status: 1 })
const cur = computed(() => companies.value.find(c => c.id === selId.value) ?? null)
const dirty = computed(() => {
  if (creating.value) return form.value.name.trim() !== ''
  const c = cur.value
  if (!c) return false
  return form.value.name !== c.name || form.value.short !== (c.short ?? '')
    || form.value.fullName !== (c.fullName ?? '') || form.value.status !== (c.status ?? 1)
})
function fillForm(c: CompanyFullDTO | null) {
  form.value = c
    ? { name: c.name, short: c.short ?? '', fullName: c.fullName ?? '', status: c.status ?? 1 }
    : { name: '', short: '', fullName: '', status: 1 }
}

async function load(keepId?: number | null) {
  loading.value = true
  try {
    companies.value = await companyBookApi.list()
    const id = keepId ?? selId.value
    selId.value = companies.value.some(c => c.id === id) ? id! : companies.value[0]?.id ?? null
    creating.value = false
    fillForm(cur.value)
  } catch (e) {
    alert(errMsg(e, '公司数据加载失败'))
    emit('close')
  } finally { loading.value = false }
}
watch(() => props.open, o => {
  if (!o) return
  selId.value = null
  creating.value = false
  acctEdit.value = null
  okMsg.value = ''
  load()
})

function guardDirty(): boolean {
  if (!dirty.value && !acctEdit.value) return true
  return confirm('有未保存的改动,继续将放弃。确认?')
}
function pick(id: number) {
  if (id === selId.value && !creating.value) return
  if (!guardDirty()) return
  selId.value = id
  creating.value = false
  acctEdit.value = null
  fillForm(cur.value)
}
function startCreate() {
  if (!guardDirty()) return
  creating.value = true
  acctEdit.value = null
  fillForm(null)
}

async function saveCompany() {
  const name = form.value.name.trim()
  if (!name) { alert('公司名必填'); return }
  if (saving.value) return
  saving.value = true
  try {
    // 短名留空回落公司名:徽标/下拉全靠它,空串会显成一片空白
    const req = {
      name, short: form.value.short.trim() || name,
      fullName: form.value.fullName.trim() || null, status: form.value.status,
    }
    const saved = creating.value
      ? await companyBookApi.create(req)
      : await companyBookApi.update(selId.value!, req)
    flashOk(creating.value ? `已新增公司「${saved.name}」` : `已保存「${saved.name}」`)
    await load(saved.id)
    emit('saved')
  } catch (e) { alert(errMsg(e, '保存失败')) } finally { saving.value = false }
}

// ── 收款账户 ──
const acctEdit = ref<number | 'new' | null>(null)
const acctForm = ref<{ kind: AccountKind; accountName: string; accountNo: string; bankName: string; isDefault: boolean; remark: string }>(
  { kind: 'bank', accountName: '', accountNo: '', bankName: '', isDefault: false, remark: '' })
const KIND_OPTS = ACCOUNT_KINDS.map(k => ({ value: k, label: ACCOUNT_KIND_LABEL[k] }))
// 银行类才需要开户行(微信/支付宝没有开户行,别摆一个永远空着的框)
const needBank = computed(() => acctForm.value.kind === 'bank' || acctForm.value.kind === 'personal')

function startAcct(a: CompanyAccountDTO | null) {
  if (!canEdit.value) return
  acctEdit.value = a?.id ?? 'new'
  acctForm.value = a
    ? { kind: a.kind, accountName: a.accountName ?? '', accountNo: a.accountNo ?? '',
        bankName: a.bankName ?? '', isDefault: !!a.isDefault, remark: a.remark ?? '' }
    : { kind: 'bank', accountName: form.value.fullName || form.value.name, accountNo: '',
        bankName: '', isDefault: (cur.value?.accounts?.length ?? 0) === 0, remark: '' }
}
async function saveAcct() {
  if (saving.value || selId.value == null || acctEdit.value == null) return
  const f = acctForm.value
  const req: AccountReq = {
    kind: f.kind,
    accountName: f.accountName.trim() || null,
    accountNo: f.accountNo.trim() || null,
    bankName: needBank.value ? (f.bankName.trim() || null) : null,
    isDefault: f.isDefault,
    remark: f.remark.trim() || null,
  }
  saving.value = true
  try {
    if (acctEdit.value === 'new') await companyBookApi.addAccount(selId.value, req)
    else await companyBookApi.updateAccount(acctEdit.value, req)
    acctEdit.value = null
    await load(selId.value)
    emit('saved')
  } catch (e) { alert(errMsg(e, '账户保存失败')) } finally { saving.value = false }
}
async function delAcct(a: CompanyAccountDTO) {
  if (saving.value) return
  if (!confirm(`删除账户「${a.accountName || ACCOUNT_KIND_LABEL[a.kind]}${a.accountNo ? ' ' + a.accountNo : ''}」?导出时选过它的历史文件不受影响。`)) return
  saving.value = true
  try {
    await companyBookApi.deleteAccount(a.id)
    await load(selId.value)
    emit('saved')
  } catch (e) { alert(errMsg(e, '删除失败')) } finally { saving.value = false }
}
async function setDefault(a: CompanyAccountDTO) {
  if (saving.value || a.isDefault) return
  saving.value = true
  try {
    await companyBookApi.updateAccount(a.id, {
      kind: a.kind, accountName: a.accountName, accountNo: a.accountNo,
      bankName: a.bankName, isDefault: true, remark: a.remark,
    })
    await load(selId.value)
    emit('saved')
  } catch (e) { alert(errMsg(e, '设默认失败')) } finally { saving.value = false }
}

function onClose() {
  if (saving.value) return
  if ((dirty.value || acctEdit.value) && !confirm('有未保存的改动,关闭将放弃。确认关闭?')) return
  emit('close')
}
</script>

<template>
  <FPDrawer :open="open" title="收款公司" icon="landmark" :width="1000" :fixed-height="true"
            subtitle="管理收款主体与收款账户 —— 法定全称与账户块会印在通知单上;停用只影响以后的选择器,历史单不动"
            @close="onClose">
    <div v-if="loading" class="cw-empty">加载中…</div>
    <template v-else>
      <div v-if="okMsg" class="cw-bar ok">
        <component :is="iconFor('check')" :size="14" />
        <span>{{ okMsg }}</span>
      </div>

      <div class="cw-split">
        <!-- 左:公司列表 -->
        <div class="cw-list">
          <button v-for="c in companies" :key="c.id" type="button" class="cw-item"
                  :class="{ sel: !creating && c.id === selId, off: c.status === 0 }" @click="pick(c.id)">
            <span class="cw-item-n">{{ c.name }}</span>
            <span class="cw-item-s">
              {{ c.short || '—' }} · {{ c.accounts?.length ?? 0 }} 个账户
              <em v-if="c.status === 0">已停用</em>
            </span>
          </button>
          <button v-if="canEdit" type="button" class="cw-item add" :class="{ sel: creating }" @click="startCreate">
            <component :is="iconFor('plus')" :size="14" /> 新增公司
          </button>
        </div>

        <!-- 右:表单 + 账户 -->
        <div v-if="creating || cur" class="cw-pane">
          <div class="cw-form">
            <label class="cw-f">
              <span>显示名 <em>*</em></span>
              <input v-model="form.name" :disabled="!canEdit" placeholder="如:一泽" />
            </label>
            <label class="cw-f">
              <span>短名</span>
              <input v-model="form.short" :disabled="!canEdit" placeholder="徽标/下拉里显示;留空取显示名" />
            </label>
            <label class="cw-f wide">
              <span>法定全称</span>
              <input v-model="form.fullName" :disabled="!canEdit" placeholder="如:佛山一泽科技有限公司;印在通知单落款与账户块" />
            </label>
            <label class="cw-f chk">
              <input type="checkbox" :checked="form.status === 0" :disabled="!canEdit"
                     @change="form.status = form.status === 0 ? 1 : 0" />
              <span>停用(不再出现在收款公司选择器)</span>
            </label>
            <div class="cw-f-act">
              <Button v-if="canEdit" variant="filled" size="sm" :disabled="!dirty || saving" @click="saveCompany">
                {{ creating ? '新增' : '保存' }}
              </Button>
            </div>
          </div>

          <template v-if="!creating">
            <div class="cw-sec">
              <span>收款账户</span>
              <span class="cw-sec-sub">{{ cur?.accounts?.length ?? 0 }} 个 · 导出通知单时默认取「默认」那个</span>
              <span style="flex:1"></span>
              <Button v-if="canEdit" variant="outline" size="sm" :disabled="acctEdit !== null" @click="startAcct(null)">
                <template #leading><component :is="iconFor('plus')" :size="14" /></template>
                新增账户
              </Button>
            </div>

            <table class="cw-table">
              <colgroup>
                <col style="width:82px" /><col style="width:150px" /><col />
                <col style="width:170px" /><col style="width:130px" /><col style="width:104px" />
              </colgroup>
              <thead>
                <tr>
                  <th class="l">类型</th><th class="l">户名</th><th class="l">账号</th>
                  <th class="l">开户行</th><th class="l">备注</th><th class="ct">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in cur?.accounts ?? []" :key="a.id">
                  <td class="l"><span class="cw-kind" :class="a.kind">{{ ACCOUNT_KIND_LABEL[a.kind] }}</span></td>
                  <td class="l"><span class="cw-txt">{{ a.accountName || '–' }}</span></td>
                  <td class="l"><span class="cw-txt mono">{{ a.accountNo || '–' }}</span></td>
                  <td class="l"><span class="cw-txt">{{ a.bankName || '–' }}</span></td>
                  <td class="l"><span class="cw-txt dim">{{ a.remark || '–' }}</span></td>
                  <td class="ct">
                    <button class="cw-mini" :class="{ on: a.isDefault }" :disabled="!canEdit"
                            :title="a.isDefault ? '当前默认账户' : '设为默认'" @click="setDefault(a)">默认</button>
                    <button v-if="canEdit" class="cw-mini" title="编辑" @click="startAcct(a)">
                      <component :is="iconFor('pencil')" :size="12" />
                    </button>
                    <button v-if="canEdit" class="cw-mini del" title="删除" @click="delAcct(a)">
                      <component :is="iconFor('trash-2')" :size="12" />
                    </button>
                  </td>
                </tr>
                <tr v-if="(cur?.accounts?.length ?? 0) === 0 && acctEdit === null">
                  <td class="cw-noro" colspan="6">还没有收款账户 —— 没有账户的公司,通知单上整块账户信息省略(源册本来也有这种简化版)</td>
                </tr>
              </tbody>
            </table>

            <!-- 账户编辑器(新增/改共用) -->
            <div v-if="acctEdit !== null" class="cw-acct">
              <div class="cw-form">
                <label class="cw-f">
                  <span>类型</span>
                  <div style="width:100%">
                    <Select :options="KIND_OPTS" :model-value="acctForm.kind" size="sm"
                            @update:model-value="acctForm.kind = $event as AccountKind" />
                  </div>
                </label>
                <label class="cw-f">
                  <span>户名</span>
                  <input v-model="acctForm.accountName" placeholder="对公=公司全称,个人=收款人姓名" />
                </label>
                <label class="cw-f">
                  <span>账号 / 收款码标识</span>
                  <input v-model="acctForm.accountNo" />
                </label>
                <label v-if="needBank" class="cw-f">
                  <span>开户行</span>
                  <input v-model="acctForm.bankName" />
                </label>
                <label class="cw-f wide">
                  <span>备注</span>
                  <input v-model="acctForm.remark" placeholder="如:仅限水电费" />
                </label>
                <label class="cw-f chk">
                  <input type="checkbox" v-model="acctForm.isDefault" />
                  <span>设为该公司默认收款账户(导出时预选)</span>
                </label>
                <div class="cw-f-act">
                  <Button variant="gray" size="sm" :disabled="saving" @click="acctEdit = null">取消</Button>
                  <Button variant="filled" size="sm" :disabled="saving" @click="saveAcct">
                    {{ saving ? '保存中…' : '保存账户' }}
                  </Button>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div v-else class="cw-pane empty">左栏选一家公司,或点「新增公司」</div>
      </div>
    </template>

    <template #footer>
      <Button variant="outline" size="sm" @click="onClose">关闭</Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
.cw-empty { padding: 40px 12px; text-align: center; color: var(--text-disabled); font-size: var(--fs-label); }
.cw-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px solid var(--hue-green); border-radius: var(--radius-md); background: rgb(240, 251, 244); font-size: var(--fs-label); color: rgb(21, 108, 60); }

.cw-split { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 216px 1fr; gap: 14px; }
.cw-list { min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 2px; }
.cw-item { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-white); text-align: left; cursor: pointer; font-family: var(--font-sans); }
.cw-item:hover { background: var(--surface-card); }
.cw-item.sel { border-color: var(--hue-blue); background: rgba(10, 132, 255, 0.06); }
.cw-item.off .cw-item-n { color: var(--text-muted); text-decoration: line-through; }
.cw-item-n { font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.cw-item-s { font-size: 11px; color: var(--text-muted); }
.cw-item-s em { font-style: normal; margin-left: 5px; padding: 0 5px; border-radius: var(--radius-full); background: var(--surface-sunken); }
.cw-item.add { flex-direction: row; align-items: center; gap: 6px; justify-content: center; border-style: dashed; color: var(--text-secondary); font-size: 12px; }

.cw-pane { min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white); padding: 14px; }
.cw-pane.empty { align-items: center; justify-content: center; color: var(--text-disabled); font-size: var(--fs-label); }

.cw-form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.cw-f { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--text-muted); }
.cw-f.wide { grid-column: 1 / -1; }
.cw-f.chk { grid-column: 1 / -1; flex-direction: row; align-items: center; gap: 7px; color: var(--text-secondary); font-size: 12px; cursor: pointer; }
.cw-f.chk input { accent-color: var(--hue-blue); cursor: pointer; }
.cw-f em { color: var(--hue-red); font-style: normal; }
.cw-f input { height: 32px; padding: 0 10px; box-sizing: border-box; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); font-size: 12.5px; background: var(--surface-white); color: var(--text-primary); font-family: var(--font-sans); }
.cw-f input:focus { outline: none; border-color: var(--hue-blue); }
.cw-f input:disabled { background: var(--surface-sunken); color: var(--text-muted); }
.cw-f-act { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; }

.cw-sec { display: flex; align-items: center; gap: 8px; padding-top: 6px; border-top: 1px solid var(--divider); font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.cw-sec-sub { font-size: 11px; font-weight: var(--fw-regular); color: var(--text-muted); }

.cw-table { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: fixed; font-family: var(--font-sans); }
.cw-table th, .cw-table td { border-bottom: 1px solid var(--divider); box-sizing: border-box; padding: 0 8px; overflow: hidden; }
.cw-table thead th { height: 30px; color: var(--text-muted); font-size: 11.5px; font-weight: var(--fw-semibold); text-align: left; white-space: nowrap; }
.cw-table th.ct, .cw-table td.ct { text-align: center; }
.cw-table tbody td { height: 34px; vertical-align: middle; }
.cw-noro { text-align: center !important; padding: 22px 12px !important; color: var(--text-muted); font-size: 11.5px; }
.cw-txt { display: block; font-size: 12px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cw-txt.dim { color: var(--text-muted); }
.cw-txt.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.cw-kind { display: inline-block; padding: 1px 6px; border-radius: var(--radius-full); background: var(--surface-sunken); font-size: 10.5px; color: var(--text-secondary); }
.cw-kind.bank { background: rgba(10, 132, 255, 0.12); color: rgb(10, 90, 170); }
.cw-kind.wechat { background: rgba(52, 199, 89, 0.14); color: rgb(21, 108, 60); }
.cw-kind.alipay { background: rgba(0, 122, 255, 0.10); color: rgb(0, 82, 170); }
.cw-kind.personal { background: rgba(255, 149, 0, 0.14); color: rgb(178, 100, 0); }
.cw-mini { height: 22px; min-width: 22px; padding: 0 6px; margin: 0 1px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-white); color: var(--text-muted); font-size: 11px; cursor: pointer; vertical-align: middle; }
.cw-mini:hover:not(:disabled) { background: var(--surface-card); color: var(--text-primary); }
.cw-mini:disabled { cursor: default; opacity: .55; }
.cw-mini.on { border-color: var(--hue-blue); color: var(--hue-blue); background: rgba(10, 132, 255, 0.08); }
.cw-mini.del:hover { color: var(--hue-red); border-color: var(--hue-red); }

.cw-acct { border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); padding: 12px; }
</style>
