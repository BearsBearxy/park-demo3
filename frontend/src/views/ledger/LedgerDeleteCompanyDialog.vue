<script setup lang="ts">
// 删除公司弹窗(company:manage):两步——①选要删的账册(入口在左轨底部与「新增」并排,
// 不预选;用户拍板 2026-08-24:删除不放行内) ②输入公司名**原文**才激活删除(GitHub 范式)。
// 步间整体切换不做增量展开(LAYOUT-STABILITY:已渲染内容不被顶动)。
// 居中弹窗,版式 1:1 复用 LedgerNewCompanyDialog 的 lg-dlg 族(危险色变体)。
import { ref, computed, nextTick } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'

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
  <div class="lg-dlg-mask" @click="emit('close')">
    <div class="lg-dlg" role="dialog" aria-modal="true" @click.stop>
      <!-- 步① 选册 -->
      <template v-if="!picked">
        <div class="lg-dlg-h">
          <h3>删除账册</h3>
          <p>选择要删除的账册(=记账公司)。删除<b>连同全部台账/报表数据,不可恢复</b>。</p>
        </div>
        <div class="lg-dlg-b">
          <div class="lg-dlg-list">
            <button v-for="b in props.books" :key="b.id" class="lg-dlg-row" @click="pick(b)">
              <span class="nm">{{ b.name }}</span>
              <component :is="iconFor('chevron-right')" :size="14" />
            </button>
            <div v-if="!props.books.length" class="lg-dlg-none">没有可删除的账册</div>
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
          <p>将删除该公司,<b>连同全部台账/报表数据,不可恢复</b>。</p>
        </div>
        <div class="lg-dlg-b">
          <div class="lg-dlg-warn">
            <component :is="iconFor('alert-triangle')" :size="15" />
            <span>此操作立即生效且无法撤销:该公司名下所有月份的台账行与报表数据将一并删除。</span>
          </div>
          <div class="lg-dlg-lab">请输入公司名称「{{ picked.companyName }}」以确认</div>
          <input ref="inputRef" class="lg-dlg-in" v-model="typed"
                 :placeholder="picked.companyName" @keydown.enter="submit" />
          <!-- 提示位常驻占位(LAYOUT-STABILITY §4.2):不一致提示进出不顶动下方按钮 -->
          <div class="lg-dlg-erm">
            <template v-if="typed.trim() && !ok">名称与「{{ picked.companyName }}」不一致</template>
          </div>
        </div>
        <div class="lg-dlg-f">
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
.lg-dlg-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:80; display:grid; place-items:center; opacity:0; animation:lgdfade .16s forwards; }
@keyframes lgdfade { to { opacity:1; } }
.lg-dlg { width:min(440px,90vw); background:var(--surface-white); border-radius:var(--radius-xl); box-shadow:0 16px 48px rgba(28,28,28,.22);
  overflow:hidden; animation:lgdrise .2s var(--ease-standard) both; }
@keyframes lgdrise { from { opacity:0; transform:translateY(10px) scale(.99); } to { opacity:1; transform:translateY(0) scale(1); } }
.lg-dlg-h { padding:20px 22px 0; }
.lg-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.lg-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.lg-dlg-b { padding:18px 22px 4px; }
.lg-dlg-warn { display:flex; gap:8px; align-items:flex-start; margin-bottom:14px; padding:11px 13px; border-radius:var(--radius-md);
  background:rgb(252,235,233); font-size:12px; line-height:1.55; color:var(--text-secondary); }
.lg-dlg-warn > :first-child { flex:0 0 auto; color:var(--hue-red); margin-top:1px; }
.lg-dlg-lab { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); margin-bottom:7px; }
.lg-dlg-in { width:100%; box-sizing:border-box; height:40px; padding:0 12px; font-size:13.5px; color:var(--text-primary);
  border:1px solid var(--border-subtle); border-radius:var(--radius-md); outline:none; background:var(--surface-white);
  font-family:var(--font-sans); transition:border-color var(--dur-fast) var(--ease-standard); }
.lg-dlg-in:focus { border-color:var(--hue-red); }
.lg-dlg-erm { font-size:11.5px; color:var(--hue-red); margin-top:6px; min-height:14px; }
.lg-dlg-f { display:flex; justify-content:flex-end; align-items:center; gap:8px; padding:16px 22px 20px; }
.lg-dlg-fsp { flex:1; }
.lg-dlg-back { display:inline-flex; align-items:center; gap:4px; border:none; background:transparent; cursor:pointer;
  font-family:var(--font-sans); font-size:12px; color:var(--text-muted); padding:4px 6px; border-radius:var(--radius-sm); }
.lg-dlg-back:hover { color:var(--text-primary); background:var(--surface-sunken); }
.lg-dlg-list { display:flex; flex-direction:column; gap:2px; max-height:280px; overflow-y:auto; }
.lg-dlg-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px;
  border:none; border-radius:var(--radius-md); background:transparent; cursor:pointer; text-align:left;
  font-family:var(--font-sans); font-size:13px; color:var(--text-secondary); }
.lg-dlg-row:hover { background:rgb(252,235,233); color:var(--hue-red); }
.lg-dlg-row .nm { font-weight:var(--fw-medium); }
.lg-dlg-none { padding:18px 0; text-align:center; font-size:12px; color:var(--text-disabled); }
</style>
