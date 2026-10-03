<script setup lang="ts">
// 删除公司弹窗(company:manage):两步——①选要删的账册(入口在左轨底部与「新增」并排,
// 不预选;用户拍板 2026-08-24:删除不放行内) ②输入公司名**原文**才激活删除(GitHub 范式)。
// 步间整体切换不做增量展开(LAYOUT-STABILITY:已渲染内容不被顶动)。
// 居中弹窗,版式 1:1 复用 LedgerNewCompanyDialog 的 lg-dlg 族(危险色变体)。
import { ref, computed, nextTick } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import FPNote from '@/components/fp/FPNote.vue'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import { useFormSheet } from '@/composables/useFormSheet'

// 步② 有输入(要打出公司名原文)→ S 档全屏 sheet;步① 只是一列可选账册,没有输入控件,
// 按判据仍是居中小卡(styles/form-sheet.css)。
const sheet = useFormSheet()

export interface DeletableBook { id: number; name: string; companyName: string }

const props = defineProps<{ books: DeletableBook[]; busy?: boolean }>()
const emit = defineEmits<{ close: []; confirm: [bookId: number] }>()

const picked = ref<DeletableBook | null>(null)
const typed = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

function pick(b: DeletableBook) {
  picked.value = b
  typed.value = ''
  void nextTick(() => inputRef.value?.focus())
}
function back() { picked.value = null; typed.value = '' }

const ok = computed(() => picked.value != null && typed.value.trim() === picked.value.companyName)
function submit() {
  if (ok.value && !props.busy && picked.value) emit('confirm', picked.value.id)
}
</script>

<template>
  <div class="lg-dlg-mask" :class="{ 'fp-fsheet': sheet && !!picked }" @click="emit('close')">
    <div class="lg-dlg" role="dialog" aria-modal="true" @click.stop>
      <!-- 步① 选册 -->
      <template v-if="!picked">
        <div class="lg-dlg-h">
          <h3>删除账册</h3>
          <p>选择要删除的账册(=记账公司)。名下还有台账、报表或催缴单的删不掉;删除<b>不可恢复</b>。</p>
        </div>
        <div class="lg-dlg-b">
          <div class="lg-dlg-list">
            <button v-for="b in props.books" :key="b.id" class="lg-dlg-row" @click="pick(b)">
              <span class="nm">{{ b.name }}</span>
              <component :is="iconFor('chevron-right')" :size="14" />
            </button>
            <FPEmpty v-if="!props.books.length" size="sm">没有可删除的账册</FPEmpty>
          </div>
        </div>
        <div class="lg-dlg-f">
          <Button variant="gray" size="sm" @click="emit('close')">取消</Button>
        </div>
      </template>

      <!-- 步② 输名确认(原有高摩擦流程) -->
      <template v-else>
        <div class="lg-dlg-h">
          <h3>删除公司「{{ picked.companyName }}」</h3>
          <!-- 收款簿的指定与收款账户是 FK 级联删的(V34 / V94),不在 409 守卫里:只当收款主体、没出过单的公司照样删得掉 -->
          <p>将删除该公司和它的账册、收款账户;收款簿里指给它的收款项也一起清掉,以后生成催缴单时这些格是「未设置」。<b>不可恢复</b>。</p>
        </div>
        <div class="lg-dlg-b fp-fsheet-bd">
          <FPNote tone="danger" class="lg-dlg-warn">此操作立即生效且无法撤销。名下还有台账、报表或催缴单时删不掉。</FPNote>
          <div class="lg-dlg-lab">请输入公司名称「{{ picked.companyName }}」以确认</div>
          <input ref="inputRef" class="lg-dlg-in" v-model="typed"
                 :placeholder="picked.companyName" @keydown.enter="submit" />
          <!-- 提示位常驻占位(LAYOUT-STABILITY §4.2):不一致提示进出不顶动下方按钮 -->
          <p class="fp-field-err">
            <template v-if="typed.trim() && !ok">名称与「{{ picked.companyName }}」不一致</template>
          </p>
        </div>
        <div class="lg-dlg-f fp-fsheet-ft">
          <button class="lg-dlg-back" @click="back">
            <component :is="iconFor('arrow-left')" :size="13" />重新选择
          </button>
          <span class="lg-dlg-fsp"></span>
          <Button variant="gray" size="sm" @click="emit('close')">取消</Button>
          <Button variant="danger" size="sm" :disabled="!ok || busy" @click="submit">
            <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
            {{ busy ? '删除中…' : '永久删除' }}
          </Button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 1:1 LedgerNewCompanyDialog .lg-dlg 族;警示块换危险色 */
.lg-dlg-mask { position:fixed; inset:0; background:var(--scrim); z-index:80; display:grid; place-items:center; opacity:0; animation:fp-fade-in var(--dur-base) forwards; }
.lg-dlg { width:min(440px,90vw); background:var(--surface-white); border-radius:var(--radius-xl); box-shadow:0 16px 48px rgba(28,28,28,.22);
  overflow:hidden; animation:fp-rise-in var(--dur-base) var(--ease-standard) both; }
.lg-dlg-h { padding:20px 22px 0; }
.lg-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.lg-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.lg-dlg-b { padding:18px 22px 4px; }
.lg-dlg-warn { margin-bottom:14px; }
.lg-dlg-lab { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); margin-bottom:7px; }
.lg-dlg-in { width:100%; box-sizing:border-box; height:40px; padding:0 12px; font-size:13.5px; color:var(--text-primary);
  border:1px solid var(--border-control); border-radius:var(--radius-md); outline:none; background:var(--surface-white);
  font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.lg-dlg-in:focus { border-color:var(--hue-red); }
.lg-dlg-in + .fp-field-err { margin-top:6px; }
.lg-dlg-f { display:flex; justify-content:flex-end; align-items:center; gap:8px; padding:16px 22px 20px; }
.lg-dlg-fsp { flex:1; }
.lg-dlg-back { display:inline-flex; align-items:center; gap:4px; border:none; background:transparent; cursor:pointer;
  font-family:var(--font-sans); font-size:12px; color:var(--text-muted); padding:4px 6px; border-radius:var(--radius-sm); }
.lg-dlg-back:hover { color:var(--text-primary); background:var(--surface-sunken); }
.lg-dlg-list { display:flex; flex-direction:column; gap:2px; max-height:280px; overflow-y:auto; }
.lg-dlg-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px;
  border:none; border-radius:var(--radius-md); background:transparent; cursor:pointer; text-align:left;
  font-family:var(--font-sans); font-size:13px; color:var(--text-secondary); }
.lg-dlg-row:hover { background:var(--danger-soft); color:var(--hue-red); }
.lg-dlg-row .nm { font-weight:var(--fw-medium); }
</style>
