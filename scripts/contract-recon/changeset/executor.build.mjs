// 打包:four/mgmt/empty/merge/phase2 五份变更集(按 requests/_summary.json 的终跑顺序)→ executor.bundle.js + executor.chunkNN.js。
// phase2 本身就按行键写(不含行 id),这里只拿终跑写前快照核:每个被改/删的键恰好 1 行,pre.lineKeys = 写前全部行键。
// 计费行 id 引用(lines.remove / lines.update[].id / pre.lines 的键 / pre.lineIds)在这里换成行键
// location|feeKey|area(与 ContractFixRunner.lineKey 同款),线上按键找行,不认 id(每次 PUT 行 id 都会重编)。
// id→键 取自 ../out/db-snapshot.json(park_demo3 只读快照),并逐项对 requests/ 里终跑录下的 beforeSnapshot 核:
// 每个被引用的键在该合同写前恰好 1 行,lineIds 换出的键多重集 = 写前全部行键。对不上就不出包。
// 非合同项另附 op.who(楼栋名/租户名/合同号,取自 db-snapshot):线上同 id 不是同一个实体就停。
// chunk01 = executor.js 把 '@@EXE@@' 换成它自己的指纹;最后一块在 seal 前核这个指纹(贴错旧版执行器装不上)。
// 同时生成 executor.RUNBOOK.md(字节数、seal 参数、分段下标都从这次打包算出来,不手抄);dry 预期那一节由 harness 填。
// 运行:node executor.build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CHUNK_MAX = 60000;   // 字节;每块一句独立可执行的 JS(页面 CSP 无 unsafe-eval,不走字符串 eval)
const rd = p => JSON.parse(fs.readFileSync(path.join(DIR, p), 'utf8'));
const FILES = ['four', 'mgmt', 'empty', 'merge', 'phase2'];

// 与 executor.js 同款的键
const txt = v => v === undefined ? '' : v === null ? 'null' : String(v);
const num = v => { if (v == null || v === 'null') return null; if (typeof v === 'number') return v; if (typeof v !== 'string') return null; const s = v.trim(); return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null; };
const nz = v => { const b = num(v); return b !== null ? String(b) : (v == null || v === 'null') ? '-' : String(v); };
const key = (loc, fk, area) => txt(loc) + '|' + txt(fk) + '|' + nz(area);

// 终跑录下的写前快照:行串 → 键
const LINE_RE = /^propertyType=(.*?);location=(.*?);feeKey=(.*?);area=(.*?);areaShared=(.*?);unitPrice=(.*?);coeff=(.*?);roomCount=(.*?);billMode=(.*?);amountOverride=(.*?);seq=(.*?);source=(.*?);unitIds=(\[.*\])$/;
const snapKey = s => { const m = LINE_RE.exec(s); if (!m) throw new Error('快照行解析不了: ' + s); return key(m[2] === '-' ? null : m[2], m[3], m[4] === '-' ? null : m[4]); };

const summary = rd('requests/_summary.json');
const recs = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'requests'))) if (/^\d{3}\.json$/.test(f)) { const r = rd('requests/' + f); recs.set(r.seq, r); }
const SNAP = rd('../out/db-snapshot.json');
const term = new Map(SNAP.term.map(t => [t.id, t]));
const tenantName = new Map(SNAP.tenant.map(t => [t.id, t.company_name]));
const buildingName = new Map(SNAP.building.map(b => [b.id, b.name]));
const contractNo = new Map(SNAP.contract.map(c => [c.id, c.contract_no]));
const byFile = Object.fromEntries(FILES.map(f => [f, rd(f + '.json')]));

const errs = [];
const ops = [];
for (const s of summary) {
  const src = byFile[s.file][s.opIndex];
  if (!src || src.op !== s.op || src.ref !== s.ref) throw new Error(`_summary 与变更集对不上: ${s.file}[${s.opIndex}]`);
  const op = JSON.parse(JSON.stringify(src));
  delete op.evidence; delete op.why; delete op.reviewFix;
  op.file = s.file; op.idx = s.opIndex;
  for (const a of op.lines?.add || []) { delete a.note; delete a.feeName; delete a.taxRate; }   // 接口不收(runner 也只计数)

  const rs = s.requests.map(n => recs.get(n));
  if (['contract.patch', 'contract.delete', 'contract.renew'].includes(op.op) && s.status === 'ok') {   // 终跑写前快照指纹,线上比了只记不拦
    const w = rs.find(r => r.beforeSnapshotSha);   // patch/delete=那一条写;renew=POST(旧合同)
    if (w) op.sha = w.beforeSnapshotSha; else errs.push(`${s.file}[${s.opIndex}] 没有写前快照指纹`);
  }
  const numeric = [...(op.lines?.remove || []), ...(op.lines?.update || []).map(u => u.id), ...Object.keys(op.pre?.lines || {}), ...(op.pre?.lineIds || [])]
    .filter(x => x != null && /^\d+$/.test(String(x)));
  if (!numeric.length && ['contract.patch', 'contract.renew'].includes(op.op) && s.status === 'ok') {   // phase2:键引用对写前快照
    const tag = `${s.file}[${s.opIndex}]`;
    const keysOf = r => r ? r.beforeSnapshot.lines.map(snapKey) : null;
    const put = keysOf(rs.find(r => r.method === 'PUT' && /^\/api\/contracts\/\d+$/.test(r.path)));
    const pre = keysOf(rs.find(r => r.beforeSnapshot && r.beforeSnapshot.lines));   // patch=PUT;renew=POST 的旧合同
    const once = (ks, k, what) => { const c = ks ? ks.filter(x => x === k).length : -1; if (c !== 1) errs.push(`${tag}: ${what} 键 ${k} 在写前快照里 ${c} 行(要 1)`); };
    for (const k of op.lines?.remove || []) once(put, k, 'remove');
    for (const u of op.lines?.update || []) once(put, u.k, 'update');
    for (const k of Object.keys(op.pre?.lines || {})) once(pre, k, 'pre.lines');
    if (op.pre?.lineKeys && JSON.stringify([...op.pre.lineKeys].sort()) !== JSON.stringify([...(pre || [])].sort())) errs.push(`${tag}: pre.lineKeys ≠ 写前快照行键`);
  }
  if (op.op === 'contract.patch' && numeric.length) {
    const cid = op.target.contractId;
    const tag = `${s.file}[${s.opIndex}] 合同${cid}`;
    const ids = [...(op.lines?.remove || []), ...(op.lines?.update || []).map(u => u.id),
      ...Object.keys(op.pre?.lines || {}).map(Number), ...(op.pre?.lineIds || [])];
    if (ids.length) {
      const put = s.requests.map(n => recs.get(n)).find(r => r.method === 'PUT' && r.path === '/api/contracts/' + cid);
      if (!put) { errs.push(tag + ': 找不到终跑的 PUT 记录'); continue; }
      const snapKeys = put.beforeSnapshot.lines.map(snapKey);
      const k = id => {
        const t = term.get(Number(id));
        if (!t) { errs.push(`${tag}: 行 ${id} 不在 db-snapshot`); return '?' + id; }
        if (t.contract_id !== cid) errs.push(`${tag}: 行 ${id} 属合同 ${t.contract_id}`);
        return key(t.location, t.fee_key, t.area);
      };
      const one = id => { const kk = k(id); const c = snapKeys.filter(x => x === kk).length; if (c !== 1) errs.push(`${tag}: 行 ${id} 键 ${kk} 在写前快照里 ${c} 行(要 1)`); return kk; };
      if (op.lines) {
        op.lines.remove = (op.lines.remove || []).map(one);
        op.lines.update = (op.lines.update || []).map(({ id, ...rest }) => ({ k: one(id), ...rest }));
      }
      if (op.pre?.lines) op.pre.lines = Object.fromEntries(Object.entries(op.pre.lines).map(([id, v]) => [one(id), v]));
      if (op.pre?.lineIds) {
        const ks = op.pre.lineIds.map(k);
        if (JSON.stringify([...ks].sort()) !== JSON.stringify([...snapKeys].sort())) errs.push(`${tag}: lineIds 换出的键 ≠ 写前快照的行键`);
        // 放回原位,只换名(pre 的键序即 runner 的核对顺序)
        op.pre = Object.fromEntries(Object.entries(op.pre).map(([kk, v]) => kk === 'lineIds' ? ['lineKeys', ks] : [kk, v]));
      }
    }
  }
  // op.who:执行器写之前核的实体身份(只收数字 id;$占位符是前面建出来的,不核)
  const who = {};
  const tid = x => typeof x === 'number' ? x : null;
  const addT = id => { if (id == null) return; if (!tenantName.has(id)) errs.push(`${s.file}[${s.opIndex}] 租户 ${id} 不在 db-snapshot`); else who.tenant = [id, tenantName.get(id)]; };
  const addB = id => { if (id == null) return; if (!buildingName.has(id)) errs.push(`${s.file}[${s.opIndex}] 楼栋 ${id} 不在 db-snapshot`); else who.building = [id, buildingName.get(id)]; };
  const unitPath = /^\/api\/buildings\/(\d+)\/units$/.exec(op.body?.path || '');
  if (op.op === 'other' && unitPath) addB(Number(unitPath[1]));
  if (op.op === 'other' && op.body?.path === '/api/bills/paymap') addT(tid(op.body.json.tenantId));
  if (op.op === 'contract.create') { addT(tid(op.set?.tenantId)); addB(tid(op.set?.buildingId)); }
  if (op.op === 'tenant.delete') addT(op.target.tenantId);
  if (op.op === 'contract.delete') who.contract = [op.target.contractId, contractNo.get(op.target.contractId)];
  if (op.op === 'meter.assign') addT(tid(op.body?.patch?.tenantId));
  const scopeT = /^tenant:(\d+)$/.exec(op.op === 'param.put' ? op.body?.json?.scope || '' : '');
  if (scopeT) addT(Number(scopeT[1]));
  if (Object.keys(who).length) op.who = who;
  ops.push(op);
}
for (const o of ops) for (const k of [...(o.lines?.remove || []), ...(o.lines?.update || []).map(u => u.k)])
  if (k.split('|').length !== 3) errs.push(`${o.file}[${o.idx}] 键里有 '|': ${k}`);
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }

// FNV-1a 32 位,seal 时浏览器端对同一 JSON.stringify(ops) 再算一次
const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
const opsJson = JSON.stringify(ops);

const exeSrc = fs.readFileSync(path.join(DIR, 'executor.js'), 'utf8');
if (exeSrc.split("'@@EXE@@'").length !== 2) throw new Error("executor.js 里要恰好一处 '@@EXE@@'");
const exeSum = fnv(exeSrc);
const exe = exeSrc.replace("'@@EXE@@'", `'${exeSum}'`);
const chunks = [exe.trimEnd() + '\n'];
let cur = [];
const flush = () => { if (cur.length) { chunks.push(`window.__cx.add(${chunks.length + 1},[${cur.join(',')}]);\n`); cur = []; } };
for (const o of ops) {
  const j = JSON.stringify(o);
  const size = Buffer.byteLength(`window.__cx.add(99,[${[...cur, j].join(',')}]);window.__cx.seal(99,999,"ffffffff");\n`);
  if (size > CHUNK_MAX && cur.length) flush();
  cur.push(j);
}
flush();
const sealCall = `window.__cx.seal(${chunks.length},${ops.length},"${fnv(opsJson)}")`;
chunks[chunks.length - 1] = `if(window.__cx.exe!=="${exeSum}")throw new Error("执行器(chunk01)不是这一版:"+window.__cx.exe+" ≠ ${exeSum},先贴这次打包的 chunk01");`
  + chunks[chunks.length - 1].trimEnd() + sealCall + ';\n';

for (const f of fs.readdirSync(DIR)) if (/^executor\.chunk\d+\.js$/.test(f)) fs.unlinkSync(path.join(DIR, f));
chunks.forEach((c, i) => {
  if (Buffer.byteLength(c) > CHUNK_MAX) throw new Error(`chunk${i + 1} ${Buffer.byteLength(c)} 字节 > ${CHUNK_MAX}`);
  fs.writeFileSync(path.join(DIR, `executor.chunk${String(i + 1).padStart(2, '0')}.js`), c);
});
fs.writeFileSync(path.join(DIR, 'executor.bundle.js'), chunks.join(''));
const sizes = chunks.map(c => Buffer.byteLength(c));
console.log(`ops=${ops.length} opsJson=${Buffer.byteLength(opsJson)}B chunks=${chunks.length} sizes=${sizes.join(',')} fnv=${fnv(opsJson)} exe=${exeSum}`);

// ─── 操作手册:数都从这次打包算,dry 那一节留给 harness 填 ─────────────────
const ranges = [];
for (let i = 0; i < ops.length; i++) {
  const g = ops[i].file + (ops[i].group ? ':' + ops[i].group : '');
  if (ranges.length && ranges[ranges.length - 1].g === g) ranges[ranges.length - 1].to = i; else ranges.push({ g, from: i, to: i });
}
const regen = ops.findIndex(o => o.op === 'other' && o.body?.calls);
const firstAfter = ops.findIndex(o => o.group === 'afterDeploy');
const DRY_MARK = ['<!-- dry:begin(executor.harness.mjs 填) -->', '<!-- dry:end -->'];
const old = fs.existsSync(path.join(DIR, 'executor.RUNBOOK.md')) ? fs.readFileSync(path.join(DIR, 'executor.RUNBOOK.md'), 'utf8') : '';
const dryOld = old.includes(DRY_MARK[0]) ? old.slice(old.indexOf(DRY_MARK[0]), old.indexOf(DRY_MARK[1]) + DRY_MARK[1].length) : DRY_MARK.join('\n(还没跑 harness)\n');
const rb = `# 合同修数变更集 · 线上执行手册

> 由 \`executor.build.mjs\` 生成,别手改(改了下次打包就被覆盖)。dry 那一节由 \`executor.harness.mjs\` 填。
> 包:${chunks.length} 块,字节 ${sizes.join(' / ')};\`executor.bundle.js\` = 这 ${chunks.length} 块直接拼接,${sizes.reduce((a, b) => a + b, 0)} 字节。
> 执行器指纹 \`${exeSum}\`(最后一块在 seal 之前核;贴成旧版 chunk01 会报「执行器(chunk01)不是这一版」)。

## 1. 装载

1. 在线上系统(已登录、账号有合同编辑权限)任一页面打开开发者工具 Console。
2. 按顺序逐块粘贴 chunk01 … chunk${String(chunks.length).padStart(2, '0')}。chunk01 回 \`'executor ready'\`;中间块回 \`chunkN ok(k 项)\`;
   最后一块回 \`'loaded ${ops.length} ops'\`,末尾是 \`${sealCall}\`。
   这个浏览器以前跑过同一个包,会接着回「接上 … 存的进度:next=…,halt=…」—— 进度在 localStorage(键 \`cx:${fnv(opsJson)}\`),
   页面刷新后重新贴全部 chunk 就接上;要从头来先 \`__cx.forget()\`。
3. token 由主会话在页面里取,传进 \`run({token})\`,执行器不读 storage 里的 token,也不打印它。

## 2. 先 dry

\`r = await __cx.run({dry:true, token})\` —— 全部 ${ops.length} 项只读 + 算请求体,一条写都不发(续签接口的 linkType 探针在 dry 里也不发)。
dry 里 failed 的项只应是下面这些(前面的写没真做造成的连带);清单之外的 failed 才是问题:

${dryOld}

## 3. 真跑(strict 默认开)

分段(下标含两端):
${ranges.map(r => `- ${r.g}:${r.from}–${r.to}`).join('\n')}

1. 发版前能跑的:\`r = await __cx.run({from:0, to:${firstAfter}, token})\`(含第 ${regen} 项重生成)。
2. 线上发版后(版本 ≥ 0.22.0 **且**续签接口认 linkType)才跑 afterDeploy:\`r = await __cx.run({from:${firstAfter}, token})\`。
   版本号相同不等于功能相同:这一段第一项先发无副作用的探针,续签接口不认 linkType 就停在那一项,一条写都不发。
3. 每段判据:\`r.failed === 0 && r.halted === null\`。strict 下任何 \`already-applied\` / \`skipped\` 也算失败停下
   (终跑试跑 ${ops.length} 项全是 ok,线上出现别的状态就是线上和试跑不一样)。

## 4. 停下之后

- \`__cx.status()\` 看 \`halt\`(停在第几项、为什么)。核清楚、修好线上状态后 \`await __cx.run({from: __cx.status().halt.n, token})\` 续跑:
  停点那一项可以是 already-applied(写已发出、后面核对没过),但照样核 expect,不符还是 failed;过了停点自动清掉。
- 某项核过确认没问题、只是状态不是 ok(比如收款映射已经是别的公司、决定不覆盖):\`run({from:n, to:n+1, strict:false, token})\` 单跑那一项,再接着跑。
- 续签(contract.renew)的 POST 发出后,linkType / 父指针 / 旧合同存储态有一样不对就停在 PUT 之前 —— 新合同已建,交人核后决定删掉还是补 PUT。

## 5. 接口扫不到的(残余风险,人工看)

- recon_mark:无只读接口(删租户时后端把它置 NULL)。
- 删租户的备注覆盖:接口要按月查,只扫了 单月 ∪ 读数月 ∪ 池月;alloc_result 只扫池月。
- 删合同 / 删租户的归属段:逐块表取 timeline(全部段,每块表一次 GET;开发库 1138 块表),第一次删之前扫一遍,改表之后再扫;
  删合同的单:全部租户、非草稿/作废的单逐张看明细行(别户的单也可能引用这份合同)。
`;
fs.writeFileSync(path.join(DIR, 'executor.RUNBOOK.md'), rb);
