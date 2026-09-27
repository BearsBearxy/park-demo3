// 离线校验:把 executor.chunkNN.js 按顺序灌进一个假 window(node:vm),假 fetch 回放 requests/ 里终跑录下的状态:
//   合同首次 GET = 该合同第一条写记录的 beforeSnapshot(未被 set/append 覆盖的字段取录下 body 里的原值)+ 行 id 按键取自
//   ../out/db-snapshot.json;写之后的 GET = 录下的 afterDetail;写请求按录下顺序应答(录下的 http/code/response)。
//   没被写过的合同(zbn23=474)与合同列表取 db-snapshot。引用扫描类 GET(表/分摊/台账…)回空表。
//   phase2 的续签:POST /{旧}/renew 之后新旧两份合同的 GET = 录下的 afterDetail.new / .old;/version.json 默认回 0.22.0。
// 判据:执行器发出的每条请求(写 + 基线 GET)与录下的逐条比 method/path/body,body 逐字段全等;全部项 ok、
//      pre/expect 无不符;再做破坏验证,每种都必须停在指定那一项且那一项一条写都没发(续签回包不符那一种只许发了 POST)。
//      另有:停在 expect 后续跑(F4)、刷新页面接着跑(F6,假 localStorage)、贴错旧版 chunk01(F7)三组流程用例。
//      跑完把 dry 预期失败清单写进 executor.RUNBOOK.md 的 dry 那一节。
// 运行:node executor.harness.mjs      退出码 0 = 全过
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const rd = p => JSON.parse(fs.readFileSync(path.join(DIR, p), 'utf8'));
const REQ_FIELDS = ['contractNo', 'tenantId', 'buildingId', 'unitId', 'buildingArea', 'rentArea', 'unitPrice', 'monthlyRent',
  'deposit', 'mgmtFeePrice', 'infraFeePrice', 'elevatorCount', 'elevatorFloors', 'elevatorFee', 'transformerFee', 'powerType',
  'kva', 'startDate', 'endDate', 'signDate', 'status', 'remark', 'rentFree', 'termText', 'termType', 'tierPriceNote'];
const NUMERIC = new Set(['tenantId', 'buildingId', 'unitId', 'buildingArea', 'rentArea', 'unitPrice', 'monthlyRent', 'deposit',
  'mgmtFeePrice', 'infraFeePrice', 'elevatorCount', 'elevatorFloors', 'elevatorFee', 'transformerFee', 'kva', 'parentContractId',
  'area', 'areaShared', 'coeff', 'roomCount', 'amountOverride', 'seq']);
const typed = (f, s) => s === '-' ? null : NUMERIC.has(f) ? Number(s) : s;
const txt = v => v === undefined ? '' : v === null ? 'null' : String(v);
const nz = v => v == null ? '-' : String(Number(v));
const key = (loc, fk, area) => txt(loc) + '|' + txt(fk) + '|' + nz(area);
const LINE_RE = /^propertyType=(.*?);location=(.*?);feeKey=(.*?);area=(.*?);areaShared=(.*?);unitPrice=(.*?);coeff=(.*?);roomCount=(.*?);billMode=(.*?);amountOverride=(.*?);seq=(.*?);source=(.*?);unitIds=(\[.*\])$/;
const LF = ['propertyType', 'location', 'feeKey', 'area', 'areaShared', 'unitPrice', 'coeff', 'roomCount', 'billMode', 'amountOverride', 'seq', 'source'];
const TODAY = '2026-09-27';

const recs = fs.readdirSync(path.join(DIR, 'requests')).filter(f => /^\d{3}\.json$/.test(f)).sort().map(f => rd('requests/' + f));
const summary = rd('requests/_summary.json');
const db = rd('../out/db-snapshot.json');
const chunkFiles = fs.readdirSync(DIR).filter(f => /^executor\.chunk\d+\.js$/.test(f)).sort();

const tenantName = new Map(db.tenant.map(t => [t.id, t.company_name]));
const buildingName = new Map(db.building.map(b => [b.id, b.name]));
function loadExecutor({ storage, chunk01 } = {}) {
  const win = { console, crypto: globalThis.crypto, TextEncoder };
  if (storage) win.localStorage = storage;
  win.window = win;
  vm.createContext(win);
  for (const f of chunkFiles) {
    const src = f === chunkFiles[0] && chunk01 ? chunk01(fs.readFileSync(path.join(DIR, f), 'utf8')) : fs.readFileSync(path.join(DIR, f), 'utf8');
    win.__last = vm.runInContext(src, win, { filename: f });
  }
  if (!win.__cx.sealed || win.__cx.ops.length !== summary.length) throw new Error('chunk 装载失败');
  win.__cx.today = TODAY;
  return win.__cx;
}
const memStorage = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };

// ─── 假服务器 ────────────────────────────────────────────────
function makeFake(ops, sabotage = {}) {
  const writes = recs.filter(r => r.kind !== 'baseline');
  const opOf = r => ops.find(o => o.file === r.file && o.idx === r.opIndex);
  const termBy = new Map();
  for (const t of db.term) (termBy.get(t.contract_id) || termBy.set(t.contract_id, []).get(t.contract_id)).push(t);
  const firstRec = new Map();   // '/api/contracts/158' → 第一条写它的记录
  for (const r of writes) if (/^\/api\/(contracts|tenants)\/\d+$/.test(r.path) && !firstRec.has(r.path)) firstRec.set(r.path, r);

  const contracts = new Map(), tenants = new Map(), gone = new Set();
  const paymap = [];
  for (const r of writes) {
    const m = /^paymap:\((\d+),(\w+)\)=(\w+)$/.exec(r.beforeDetailSig || '');
    if (m && m[3] !== 'absent' && !paymap.some(x => x.tenantId === +m[1] && x.feeKey === m[2])) paymap.push({ tenantId: +m[1], feeKey: m[2], companyId: +m[3] });
  }
  for (const x of sabotage.paymapExtra || []) paymap.push(x);
  const meterRec = writes.find(r => r.path === '/api/meters/assign');
  const mm = /meter_id=(\d+), from_ym=([\d-]+), tenant_id=(\d+)/.exec(meterRec.beforeDetailSig);
  const seg = { id: 1, meterId: +mm[1], fromYm: mm[2], tenantId: +mm[3] };
  const baseline = new Map(recs.filter(r => r.kind === 'baseline').map(r => [r.path.split('=')[1], JSON.parse(JSON.stringify(r.response))]));
  if (sabotage.notice) sabotage.notice(baseline);
  const regenerated = new Set();
  const goneTenants = new Set(ops.filter(o => o.op === 'tenant.delete').map(o => o.target.tenantId));
  const errors = [];
  let k = 0, synthetic = 9000000, probes = 0;

  function snapDetail(r) {   // 首次 GET = 写前快照 + 录下 body 的原值
    const id = +r.path.split('/').pop(), op = opOf(r), sc = r.beforeSnapshot.contract;
    const overridden = new Set([...Object.keys(op.set || {}), ...Object.keys(op.append || {}), 'status']);
    const ct = { id };
    for (const f of [...REQ_FIELDS, 'parentContractId', 'linkType', 'kind'])
      ct[f] = r.body && REQ_FIELDS.includes(f) && !overridden.has(f) ? r.body[f] : typed(f, sc[f]);
    const pool = [...(termBy.get(id) || [])];
    const lines = r.beforeSnapshot.lines.map(s => {
      const m = LINE_RE.exec(s);
      const l = { contractId: id };
      LF.forEach((f, i) => { l[f] = typed(f, m[i + 1]); });
      l.unitIds = JSON.parse(m[13]);
      const kk = key(l.location, l.feeKey, l.area);
      const cand = pool.filter(t => key(t.location, t.fee_key, t.area) === kk);
      const t = cand.find(t => t.seq === l.seq && nz(t.unit_price) === nz(l.unitPrice)) || cand[0];
      if (t) pool.splice(pool.indexOf(t), 1);
      l.id = t ? t.id : synthetic++;
      return l;
    });
    // 真 GET 按 location(MySQL 排序规则)/seq/id 排,这里照录下 body 里保留行的先后排,body 里没有的(被删的)放最后
    const pos = new Map(((r.body && r.body.billingLines) || []).map((bl, i) => [bl.id, i]));
    const at = l => pos.has(l.id) ? pos.get(l.id) : 1e6 + l.seq;
    lines.sort((x, y) => at(x) - at(y) || x.id - y.id);
    for (const bl of (r.body && r.body.billingLines) || [])
      if (bl.id !== null && !lines.some(l => l.id === bl.id)) errors.push(`假服务器:#${r.seq} body 里行 id ${bl.id} 在重建的 GET 里没有`);
    const d = { contract: ct, billingLines: lines, extraUnitIds: JSON.parse(r.beforeSnapshot.extraUnitIds) };
    if (sabotage.contract) sabotage.contract(id, d);
    return d;
  }
  function dbDetail(id) {   // 没被写过的合同:db-snapshot
    const row = db.contract.find(x => x.id === id);
    if (!row) return null;
    const cam = s => s.replace(/_(\w)/g, (_, c) => c.toUpperCase());
    const ct = {};
    for (const [k2, v] of Object.entries(row)) ct[cam(k2)] = v != null && NUMERIC.has(cam(k2)) ? Number(v) : v;
    ct.contractNo = row.contract_no;
    ct.status = row.status !== 'active' ? row.status : row.start_date > TODAY ? 'future' : !row.end_date ? 'active'
      : row.end_date < TODAY ? 'expired' : 'active';
    const lines = (termBy.get(id) || []).map(t => ({ id: t.id, contractId: id, location: t.location, feeKey: t.fee_key, area: t.area == null ? null : Number(t.area) }));
    return { contract: ct, billingLines: lines, extraUnitIds: db.contract_unit.filter(u => u.contract_id === id).map(u => u.unit_id) };
  }
  function contract(id) {
    if (gone.has(id)) return null;
    if (!contracts.has(id)) {
      const r = firstRec.get('/api/contracts/' + id);
      contracts.set(id, r ? snapDetail(r) : dbDetail(id));
    }
    return contracts.get(id);
  }
  function tenant(id) {
    if (gone.has('t' + id)) return null;
    if (!tenants.has(id)) {
      const r = firstRec.get('/api/tenants/' + id);
      if (!r) return tenantName.has(id) ? { tenant: { id, companyName: tenantName.get(id) }, contracts: [] } : null;   // 没被写过的租户:db-snapshot
      tenants.set(id, r.method === 'DELETE' ? r.beforeSnapshot : { tenant: r.beforeSnapshot, contracts: [] });
    }
    return tenants.get(id);
  }

  const res = (status, body) => ({ status, text: async () => body === undefined ? '' : JSON.stringify(body) });
  const okr = data => res(200, { code: 0, message: 'ok', data });
  const nf = () => res(404, { code: 404, message: '资源不存在', data: null });

  function get(p) {
    let m;
    if ((m = /^\/api\/contracts\/(\d+)$/.exec(p))) {
      const d = contract(+m[1]) || (sabotage.extraDetails || {})[+m[1]];
      if (!d) return nf();
      const cp = JSON.parse(JSON.stringify(d));
      if (sabotage.onGet) sabotage.onGet(+m[1], cp, k);   // 每次 GET 都改(contract 钩子只改首次 GET);k=已收到的写条数
      return okr(cp);
    }
    if (p === '/api/contracts') {
      const ids = new Set([...db.contract.map(x => x.id), ...contracts.keys()]);
      return okr([...ids].filter(i => contract(i)).map(i => ({ id: i, contractNo: contract(i).contract.contractNo,
        parentContractId: contract(i).contract.parentContractId ?? null })).concat(sabotage.extraContracts || []));
    }
    if (p === '/version.json') return res(200, { version: sabotage.version || '0.22.0' });
    if ((m = /^\/api\/tenants\/(\d+)$/.exec(p))) { const t = tenant(+m[1]); return t ? okr(JSON.parse(JSON.stringify(t))) : nf(); }
    if (p === '/api/bills/paymap') return okr(JSON.parse(JSON.stringify(paymap)));
    if ((m = /^\/api\/buildings\/(\d+)$/.exec(p))) {
      const nm = (sabotage.buildingNames || {})[+m[1]] ?? buildingName.get(+m[1]);
      return nm === undefined ? nf() : okr({ building: { id: +m[1], name: nm }, units: [] });
    }
    if ((m = /^\/api\/meters\/(\d+)\/timeline\?ym=/.exec(p))) return okr({ assign: +m[1] === seg.meterId ? [{ ...seg }] : ((sabotage.segs || {})[+m[1]] || []) });
    if ((m = /^\/api\/bill-notices\/(\d+)$/.exec(p))) return okr((sabotage.noticeDetail || {})[+m[1]] || { lines: [] });
    if (p === '/api/bill-notices/months') return okr([...baseline.keys()].sort());
    if ((m = /^\/api\/bill-notices\?ym=(.+)$/.exec(p)))
      return okr((baseline.get(m[1]) || []).filter(x => !(regenerated.has(m[1]) && goneTenants.has(x.tenantId))));
    if (p === '/api/meters' || /^\/api\/meters\?ym=/.test(p)) return okr(sabotage.meters || []);
    if (/^\/api\/(meters\/months|alloc\/pool-months|alloc\/rules|tenants|analysis\/(ledger|s10)-tenant-months)$/.test(p)
      || /^\/api\/bill-notices\/notes\?/.test(p)) return okr([]);
    errors.push('假服务器没料到的 GET ' + p);
    return nf();
  }
  function write(method, p, body) {
    if (method === 'POST' && p === '/api/contracts/0/renew') {   // linkType 探针:不写库,不算写
      probes++;
      return sabotage.noLinkType ? res(200, { code: 404, message: '合同不存在', data: null }) : res(400, { code: 400, message: 'linkType: 须匹配 renew|escalation', data: null });
    }
    const r = writes[k];
    if (!r || r.method !== method || r.path !== p) throw new Error(`写请求错位:第 ${k + 1} 条应为 ${r ? r.method + ' ' + r.path : '(无)'} 实际 ${method} ${p}`);
    k++;
    let m;
    if ((m = /^\/api\/contracts\/(\d+)\/renew$/.exec(p))) { contracts.set(+m[1], r.afterDetail.old); if (r.afterDetail.new) contracts.set(r.response.id, r.afterDetail.new); }
    else if ((m = /^\/api\/contracts\/(\d+)$/.exec(p))) { if (method === 'DELETE') gone.add(+m[1]); else contracts.set(+m[1], r.afterDetail); }
    else if (p === '/api/contracts') contracts.set(r.response.id, r.afterDetail);
    else if ((m = /^\/api\/tenants\/(\d+)$/.exec(p))) { if (method === 'DELETE') gone.add('t' + m[1]); else tenants.set(+m[1], r.afterDetail); }
    else if (p === '/api/bills/paymap') { const i = paymap.findIndex(x => x.tenantId === body.tenantId && x.feeKey === body.feeKey); if (i >= 0) paymap.splice(i, 1); paymap.push(r.afterDetail); }
    else if (p === '/api/meters/assign') seg.tenantId = r.afterDetail.tenant_id;
    else if ((m = /^\/api\/bill-notices\/generate\?ym=(.+)$/.exec(p))) regenerated.add(m[1]);
    if (sabotage.afterWrite) sabotage.afterWrite(method, p, contracts);
    return res(r.http, { code: r.code, message: r.message, data: r.response });
  }
  const fetch = async (p, init = {}) => {
    const method = init.method || 'GET';
    if (!/^Bearer tok-harness$/.test(init.headers?.Authorization || '')) throw new Error('Authorization 头不对');
    const body = init.body === undefined ? null : JSON.parse(init.body);
    return method === 'GET' ? get(p) : write(method, p, body);
  };
  return { fetch, errors, writes: () => k, probes: () => probes };
}

// ─── 逐字段比 ────────────────────────────────────────────────
function diff(a, b, at, out) {
  if (a === b) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) out.push(`${at}.${k}: 录下没有 / 发出 ${JSON.stringify(b[k])}`);
      else if (!(k in b)) out.push(`${at}.${k}: 录下 ${JSON.stringify(a[k])} / 发出没有`);
      else diff(a[k], b[k], `${at}.${k}`, out);
    }
    return;
  }
  out.push(`${at}: 录下 ${JSON.stringify(a)} / 发出 ${JSON.stringify(b)}`);
}

async function runOnce(sabotage, runOpts, { storage, fake: fake0 } = {}) {
  const cx = loadExecutor({ storage });
  const fake = fake0 || makeFake(cx.ops, sabotage);
  cx.fetch = fake.fetch;
  const r = await cx.run({ token: 'tok-harness', ...runOpts });
  return { cx, fake, r };
}

const out = { checked: 0, mismatches: [], notes: [] };
const assert = (cond, msg) => { if (!cond) out.mismatches.push(msg); };

// 1) 正跑
{
  const { cx, fake, r } = await runOnce({}, {});
  const sent = cx.log.flatMap(c => c.requests.map(q => ({ ...q, op: `${c.file}[${c.opIndex}]` })));
  assert(sent.length === recs.length, `请求条数 ${sent.length} ≠ 录下 ${recs.length}`);
  for (let i = 0; i < Math.max(sent.length, recs.length); i++) {
    const s = sent[i], rec = recs[i];
    if (!s || !rec) { assert(false, `第 ${i + 1} 条:${s ? '多发' : '少发'}`); continue; }
    const d = [];
    if (s.method !== rec.method || s.path !== rec.path) d.push(`${rec.method} ${rec.path} ≠ ${s.method} ${s.path}`);
    if ((s.kind || null) !== (rec.kind || null)) d.push(`kind ${rec.kind} ≠ ${s.kind}`);
    diff(rec.body, s.body, 'body', d);
    d.forEach(x => out.mismatches.push(`#${rec.seq} ${s.op} ${x}`));
    out.checked++;
  }
  const st = cx.log.map((c, i) => [c, summary[i]]);
  for (const [c, s] of st) {
    if (c.status !== s.status) out.mismatches.push(`${c.file}[${c.opIndex}] 状态 ${c.status} ≠ 终跑 ${s.status}: ${c.errors.join(';')}`);
    if (c.preMismatch.length || c.expectMismatch.length) out.mismatches.push(`${c.file}[${c.opIndex}] pre/expect 不符 ${c.preMismatch} ${c.expectMismatch}`);
    if (c.op.startsWith('contract.') && c.op !== 'contract.create' && c.sameAsTested !== true) out.mismatches.push(`${c.file}[${c.opIndex}] 写前快照指纹对不上终跑(sameAsTested=${c.sameAsTested})`);
  }
  assert(cx.log.length === summary.length, `跑了 ${cx.log.length} 项 ≠ ${summary.length}`);
  assert(fake.writes() === recs.filter(x => x.kind !== 'baseline').length, `假服务器收到写 ${fake.writes()} 条`);
  fake.errors.forEach(e => out.mismatches.push(e));
  assert(fake.probes() === 1, `正跑 linkType 探针发了 ${fake.probes()} 次(应 1 次)`);
  assert(r.failed === 0 && r.halted === null && r.strict === true, `正跑 failed=${r.failed} halted=${r.halted} strict=${r.strict}`);
  const unchecked = cx.log.reduce((n, c) => n + c.preUnchecked.length + c.expectUnchecked.length, 0);
  out.notes.push(`正跑:${r.ran} 项 ${r.failed} 失败;请求 ${sent.length} 条逐条比 method/path/kind/body;说明性未核键 ${unchecked} 个;写 ${fake.writes()} 条`);
}

// 2) 破坏验证:每种都必须停在 at 那一项,且那一项一条写都没发
const idxOf = (file, i) => summary.findIndex(s => s.file === file && s.opIndex === i);
const baselineSeq = new Set(recs.filter(r => r.kind === 'baseline').map(r => r.seq));
const writesBefore = n => summary.slice(0, n).reduce((s, x) => s + x.requests.filter(q => !baselineSeq.has(q)).length, 0);   // 基线 GET 不算写
const ops0 = loadExecutor().ops;
const mgmtUpd = ops0.find(o => o.file === 'mgmt' && o.idx === 23);
const firstPaymap = (() => { const at = ops0.findIndex(o => o.op === 'other' && o.body?.path === '/api/bills/paymap' && !o.overwrite); const j = ops0[at].body.json; return { at, tid: j.tenantId, fk: j.feeKey }; })();
const cases = [
  { name: '合同200(four[9])行 二期五号楼七层701室|rent_factory 面积 1006.03→1006.04', at: idxOf('four', 9),
    sabotage: { contract: (id, d) => { if (id === 200) d.billingLines.find(l => l.feeKey === 'rent_factory' && l.area === 1006.03).area = 1006.04; } } },
  { name: `mgmt[23] 被 update 的行 ${mgmtUpd.lines.update[0].k} 面积 +0.01`, at: idxOf('mgmt', 23),
    sabotage: { contract: (id, d) => { if (id === mgmtUpd.target.contractId) { const l = d.billingLines.find(x => `${x.location}|${x.feeKey}|${nz(x.area)}` === mgmtUpd.lines.update[0].k); l.area = +(l.area + 0.01).toFixed(2); } } } },
  { name: '待删租户 364 的 2024-02 单改成 confirmed', at: idxOf('merge', 10),
    sabotage: { notice: b => { b.get('2024-02').find(x => x.tenantId === 364).status = 'confirmed'; } } },
  { name: '合同 8 被表钉住,那一段在所有读数月之外(1900-01 起,F5)', at: idxOf('merge', 3),
    sabotage: { meters: [{ id: 999 }], segs: { 999: [{ meterId: 999, fromYm: '1900-01', tenantId: 114, contractId: 8 }, { meterId: 999, fromYm: '2023-08', tenantId: null, contractId: null }] } } },
  { name: '别户(999)已确认的单引用合同 8(F2)', at: idxOf('merge', 3),
    sabotage: { notice: b => { b.get('2024-02').push({ id: 990001, ym: '2024-02', tenantId: 999, status: 'confirmed' }); },
      noticeDetail: { 990001: { lines: [{ contractId: 8 }] } } } },
  { name: '后端 0.22.0 但续签接口不认 linkType(探针回 code 404,F1)', at: idxOf('phase2', 2), sabotage: { noLinkType: true } },
  { name: '第 0 项楼栋 32 线上不是同一栋(F8)', at: 0, sabotage: { buildingNames: { 32: '别的楼' } } },
  { name: `第一个收款映射项线上已是别的公司(strict,F3)`, at: firstPaymap.at,
    sabotage: { paymapExtra: [{ tenantId: firstPaymap.tid, feeKey: firstPaymap.fk, companyId: 99 }] } },
  // strict:false —— strict 会把任何 already-applied 都拦下,这里要单验「同号核租户」那一道
  { name: '合同号 S10-0018B#1 线上已被别的租户占用(F3,strict 关着也拦)', at: idxOf('mgmt', 0), runOpts: { strict: false },
    sabotage: { extraContracts: [{ id: 999999, contractNo: 'S10-0018B#1', parentContractId: null }],
      // 照抄终跑建出来的那份(remark 特征串、expect 各项都对得上),只把租户换掉 —— 单拦租户那一道
      extraDetails: { 999999: (() => { const d = JSON.parse(JSON.stringify(recs.find(r => r.file === 'mgmt' && r.opIndex === 0 && r.method === 'POST').afterDetail));
        d.contract.id = 999999; d.contract.tenantId = 1; return d; })() } } },
  { name: 'phase2[5] 续签后旧合同被标 renewed(后端没带 F1,新一期 2026-12-15 才起租)', at: idxOf('phase2', 5), writesInItem: 1,
    sabotage: { afterWrite: (method, p, cs) => { if (method === 'POST' && /\/renew$/.test(p)) { const id = +p.split('/')[3]; const d = cs.get(id); if (d && d.contract.contractNo === 'S10-0018B#1') cs.set(id, { ...d, contract: { ...d.contract, status: 'renewed' } }); } } } },
  { name: '合同198 天面 40㎡ 行面积 40→40.5(phase2[0] 按键找不到)', at: idxOf('phase2', 0),
    sabotage: { onGet: (id, d) => { if (id === 198) { const l = d.billingLines.find(x => x.feeKey === 'rent_land' && x.area === 40); if (l) l.area = 40.5; } } } },
  { name: '线上版本 0.21.0(afterDeploy 首项 phase2[2])', at: idxOf('phase2', 2), sabotage: { version: '0.21.0' } },
  { name: '合同 18 已有另一份后继(phase2[3] 续签会分叉)', at: idxOf('phase2', 3),
    sabotage: { extraContracts: [{ id: 999999, contractNo: 'X-FORK', parentContractId: 18 }] } },
];
for (const cs of cases) {
  const { cx, fake, r } = await runOnce(cs.sabotage, cs.runOpts || {});
  const last = cx.log[cx.log.length - 1];
  const wi = cs.writesInItem || 0;
  const okStop = r.halted === cs.at && cx.halt && cx.halt.n === cs.at && fake.writes() === writesBefore(cs.at) + wi && last.requests.length === wi
    && (wi === 0 || last.requests.every(q => q.method === 'POST'));
  assert(okStop, `破坏[${cs.name}] 没停在第 ${cs.at} 项:halted=${r.halted} 写=${fake.writes()}/${writesBefore(cs.at)} 末项请求 ${last && last.requests.length}`);
  out.notes.push(`破坏[${cs.name}] → 停在第 ${r.halted} 项 ${last.file}[${last.opIndex}],之前写 ${fake.writes()} 条;${[...last.errors, ...last.preMismatch].join(' ; ').slice(0, 300)}`);
}

// 3) F4:停在 expect(写已发出)→ 照手册从停点续跑,现值还不对就还是 failed、不记完成;线上改好后续跑才过,停点清掉
{
  const at = idxOf('four', 1), cid = ops0[at].target.contractId, after = writesBefore(at);
  const sab = { bad: true, onGet: (id, d, k) => { if (sab.bad && id === cid && k > after) d.contract.monthlyRent = Number(d.contract.monthlyRent) + 100; } };
  const { cx, fake, r } = await runOnce(sab, { to: at + 1 });
  const w1 = fake.writes();
  const r2 = await cx.run({ from: cx.halt ? cx.halt.n : at, to: at + 1, token: 'tok-harness' });
  const done2 = !!cx.done[at], st2 = cx.log[cx.log.length - 1];
  sab.bad = false;
  const r3 = await cx.run({ from: at, to: at + 2, token: 'tok-harness' });
  const st3 = cx.log.slice(-2).map(c => c.status);
  const ok = r.halted === at && w1 === after + 1 && r2.failed === 1 && r2.halted === at && !done2
    && r3.failed === 0 && st3[0] === 'already-applied' && st3[1] === 'ok' && cx.halt === null && fake.writes() === writesBefore(at + 2);
  assert(ok, `F4 续跑:首跑 halted=${r.halted} 写=${w1};续跑 failed=${r2.failed} halted=${r2.halted} done=${done2};改好后 ${st3} halt=${JSON.stringify(cx.halt)}`);
  out.notes.push(`F4 续跑:停点照核 expect → ${st2.status}「${st2.errors.join(';').slice(0, 120)}」;线上改好后 ${st3.join(' / ')},停点清掉`);
}

// 4) F6:跑到一半停下 → 新页面(新执行器、同一个 localStorage)重贴 chunk 自动接上 next/halt/vars,从停点跑完
{
  const storage = memStorage(), at = idxOf('four', 9);
  const sab = { bad: true, onGet: (id, d) => { if (sab.bad && id === 200) { const l = d.billingLines.find(x => x.feeKey === 'rent_factory' && x.area === 1006.03); if (l) l.area = 1006.04; } } };
  const a = await runOnce(sab, {}, { storage });
  sab.bad = false;
  const b = loadExecutor({ storage });
  b.fetch = a.fake.fetch;
  const st = b.status();
  const vOk = JSON.stringify(st.vars) === JSON.stringify(a.cx.vars) && Object.keys(st.vars).length > 0;
  const r = await b.run({ from: st.halt ? st.halt.n : st.next, token: 'tok-harness' });
  const ok = a.r.halted === at && st.restored && st.next === at && st.halt && st.halt.n === at && vOk
    && r.failed === 0 && r.halted === null && a.fake.writes() === recs.filter(x => x.kind !== 'baseline').length && b.status().halt === null;
  assert(ok, `F6 刷新接着跑:首跑 halted=${a.r.halted};新页面 restored=${st.restored} next=${st.next} halt=${st.halt && st.halt.n} vars 一致=${vOk};续跑 failed=${r.failed} halted=${r.halted} 写=${a.fake.writes()}`);
  out.notes.push(`F6 刷新接着跑:新页面接上 next=${st.next}、${Object.keys(st.vars).length} 个占位符,从停点跑完 ${r.ran} 项 0 失败,总写 ${a.fake.writes()} 条 = 录下`);
  const f = b.forget();
  assert(b.status().next === 0 && storage.m.size === 0, `forget 没清干净: ${f} next=${b.status().next} 存储 ${storage.m.size}`);
}

// 5) F7:贴成旧版 chunk01(没有执行器指纹 / 指纹不同)→ 最后一块 seal 前就报错,变更集装不上
{
  for (const [nm, mut] of [['没有 exe 字段', s => s.replace(/exe: '[0-9a-f]+', /, '')], ['exe 指纹不同', s => s.replace(/exe: '[0-9a-f]+'/, "exe: 'deadbeef'")]]) {
    let err = null;
    try { loadExecutor({ chunk01: mut }); } catch (e) { err = String(e && e.message); }
    assert(err && err.includes('执行器(chunk01)不是这一版'), `F7 ${nm}:应拒装,实际 ${err}`);
    out.notes.push(`F7 ${nm} → 拒装:${err}`);
  }
}

// 6) dry:全跑不发任何写(探针也不发);失败清单写进手册
{
  const { cx, fake, r } = await runOnce({}, { dry: true });
  assert(fake.writes() === 0 && fake.probes() === 0, `dry 发了 ${fake.writes()} 条写、${fake.probes()} 次探针`);
  assert(cx.log.every(c => c.requests.every(q => q.dry || q.method === 'GET')), 'dry 日志里有真发的写');
  const bad = cx.log.filter(c => c.status === 'failed').map(c => `${c.n} ${c.file}[${c.opIndex}] ${[...c.errors, ...c.preMismatch].join(';').slice(0, 160)}`);
  out.notes.push(`dry:${r.ran} 项,0 写;${bad.length} 项失败(都是前面的写没真做造成的连带):\n  ` + bad.join('\n  '));
  const RB = path.join(DIR, 'executor.RUNBOOK.md'), M = ['<!-- dry:begin(executor.harness.mjs 填) -->', '<!-- dry:end -->'];
  const rb = fs.readFileSync(RB, 'utf8');
  if (!rb.includes(M[0]) || !rb.includes(M[1])) out.mismatches.push('executor.RUNBOOK.md 没有 dry 标记,先跑 executor.build.mjs');
  else fs.writeFileSync(RB, rb.slice(0, rb.indexOf(M[0])) + M[0] + `\n共 ${bad.length} 项(第几项 文件[下标] 原因):\n\n` + bad.map(x => '- ' + x.replace(/\|/g, '\\|')).join('\n') + '\n' + rb.slice(rb.indexOf(M[1])));
}

console.log(JSON.stringify(out, null, 1));
process.exit(out.mismatches.length ? 1 : 0);
