/* 合同修数变更集 · 线上执行器(ContractFixRunner 的浏览器 HTTP 版)。纯浏览器 JS,无依赖,不用 eval。
 * window.__cx = { load(ops), run({from, to, dry, token}), log, ... }
 *   run: 按 ops 顺序逐项:GET 现状 → 核 pre(不符不发写请求)→ 照 runner 同规则拼请求体 → 发送 → GET 核 expect。
 *        任一 pre/expect 不符或非 2xx 立即停(dry 默认不停,把每项的问题都列出来)。to 不含;dry=true 只算请求体不发写请求。
 *   token:主会话在页面里取了传进来(字符串或返回字符串的函数);本文件不读 storage,不打印它。
 * 计费行一律按键 location|feeKey|area 找行(打包时已把变更集里的行 id 换成键),不认行 id。
 * 与 runner 的差别(线上没有库连接):
 *   - status 前置/期望用 GET 展示态收回存储态(future/expiring/expired→active),库里历史 expiring 分不出;
 *   - 回滚事务里的原样 PUT 幂等检查、lineExtras 行备注计数做不了(终跑已做过);
 *   - 删合同/删租户的引用计数改成逐个 GET 接口扫(见 refs 注释),recon_mark 无接口 → 记 preUnchecked;
 *   - 重生成前先看待删租户的单:有非 draft/void 的就停(decisions.md「已确认/已导出的列给用户」),不发 generate;
 *   - meter.assign 按 meterId+fromYm 在 timeline 里找段,不认 meter_assign 行 id;
 *   - 带 requires 的项(phase2 afterDeploy 组)先取 /version.json,线上版本低于它就停;版本号相同不等于有 linkType
 *     (PR #58 已推的头也是 0.22.0),所以再发一次无副作用的探针 POST /api/contracts/0/renew {linkType:'__probe__'}:
 *     新后端校验不过回 http 400,老后端不认这个字段、按合同不存在回 code 404 → 停,不发写请求。
 * phase2 起:target 可只给 contractNo(运行时在合同列表里找,恰好 1 份);contract.renew = POST /{旧}/renew → PUT 新合同
 *   (set/append、按键改行,行绑定取旧合同同键行、附加单元照抄旧合同 —— 续签接口本身不抄这两样)。
 *   POST 回包的 linkType / 父指针 / 旧合同存储态(新一期已起租 → renewed,没起租 → 不变)任一不符,停在 PUT 之前。
 * 真跑默认 strict:任何一项不是 ok(already-applied / skipped)都当失败停下 —— 终跑 183 项全是 ok,线上出现别的状态
 *   就是线上和试跑不一样;唯一例外是从上次停下的那一项续跑时它可以是 already-applied(写已发出、后面核对没过)。
 *   already-applied 也照 expect 核一遍现值,不符判 failed(不再把停下的那一项直接记成完成)。
 * 进度(done/next/halt/vars/每项一行摘要)每项写一次 localStorage(键 cx:<变更集指纹>),页面刷新后重新贴 chunk
 *   会自动接上;cx.forget() 清掉。只存进度,不存 token。
 * 非合同项(建单元/收款映射/建合同/删合同/删租户)先按 op.who 核楼栋名/租户名/合同号(打包时取自 db-snapshot),
 *   线上 id 对应的不是同一个实体就停,一条写都不发。 */
(() => {
  'use strict';
  const REQ_FIELDS = ['contractNo', 'tenantId', 'buildingId', 'unitId', 'buildingArea', 'rentArea', 'unitPrice', 'monthlyRent',
    'deposit', 'mgmtFeePrice', 'infraFeePrice', 'elevatorCount', 'elevatorFloors', 'elevatorFee', 'transformerFee', 'powerType',
    'kva', 'startDate', 'endDate', 'signDate', 'status', 'remark', 'rentFree', 'termText', 'termType', 'tierPriceNote'];
  const LINE_FIELDS = ['id', 'propertyType', 'location', 'feeKey', 'area', 'areaShared', 'unitPrice', 'coeff', 'roomCount',
    'billMode', 'amountOverride', 'seq', 'unitIds'];
  const TENANT_FIELDS = ['companyName', 'businessType', 'contactName', 'contactPhone', 'categoryId', 'parentId', 'phase', 'since',
    'remark', 'status', 'aliases'];
  const OTHER_CONTRACT = /^.*\((\d+)\)$/;

  // exe:打包时换成本文件的指纹,最后一块 chunk 在 seal 之前核它 —— 贴错了旧版执行器(chunk01)就装不上
  const cx = window.__cx = { exe: '@@EXE@@', ops: [], log: [], vars: {}, parts: {}, done: {}, sealed: false, busy: false, halt: null, next: 0,
    fetch: null, today: null, sum: null, restored: null };
  let TOKEN = null, V = cx.vars, CACHE = new Map(), SEGS = null, PROBE = null;
  // 北京时间今天(旧合同是否标 renewed 按新一期起租日比它);cx.today 可覆盖(离线校验用)
  const today = () => cx.today || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

  // ─── 值比较(runner 同款) ─────────────────────────────────
  const has = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const isNull = v => v === null || v === undefined || v === 'null';
  const num = v => { if (isNull(v)) return null; if (typeof v === 'number') return v; if (typeof v !== 'string') return null; const s = v.trim(); return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null; };
  const nz = v => { const b = num(v); return b !== null ? String(b) : isNull(v) ? '-' : String(v); };
  const txt = v => v === undefined ? '' : v === null ? 'null' : String(v);
  const J = v => v === undefined ? 'missing' : JSON.stringify(v);
  const canon = v => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
    : v !== null && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v);
  const same = (a, b) => {
    if (isNull(a) || isNull(b)) return isNull(a) && isNull(b);
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      const x = a.slice(), y = b.slice();
      if (x.every(v => typeof v === 'number') && y.every(v => typeof v === 'number')) { x.sort((p, q) => p - q); y.sort((p, q) => p - q); }
      return x.every((v, i) => same(v, y[i]));
    }
    if (typeof a === 'object' || typeof b === 'object') return canon(a) === canon(b);
    const p = num(a), q = num(b);
    if (p !== null && q !== null) return p === q;
    return String(a) === String(b);
  };
  const stored = s => (s === 'future' || s === 'expiring' || s === 'expired') ? 'active' : s;
  const lineKey = l => txt(l.location) + '|' + txt(l.feeKey) + '|' + nz(l.area);
  const empty = a => !a || a.length === 0;

  // ─── 与终跑写前快照比(runner.snapshot 同款规范化 → SHA-256);只记不拦 ───────
  const jnorm = v => {   // Java norm:数值去尾零、null 族记 '-'、其余原文
    if (isNull(v)) return '-';
    if (typeof v === 'number') return String(v);
    if (typeof v !== 'string') return JSON.stringify(v);
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v.trim());
    if (!m) return v;
    const i = m[2].replace(/^0+(?=\d)/, ''), f = (m[3] || '').replace(/0+$/, ''), s = f ? i + '.' + f : i;
    return s === '0' ? '0' : m[1] + s;
  };
  const ids = a => '[' + (a || []).map(Number).sort((p, q) => p - q).join(', ') + ']';
  const snapshot = d => {
    const c = d.contract || {}, ct = {};
    for (const f of [...REQ_FIELDS, 'parentContractId', 'linkType', 'kind']) ct[f] = jnorm(c[f]);
    const ls = (d.billingLines || []).map(l => LINE_FIELDS.filter(f => f !== 'id' && f !== 'unitIds').map(f => f + '=' + jnorm(l[f]) + ';').join('')
      + 'source=' + jnorm(l.source) + ';unitIds=' + ids(l.unitIds)).sort();
    return { contract: ct, extraUnitIds: ids(d.extraUnitIds), lines: ls };
  };
  async function tested(c, op, d) {
    if (!op.sha) return;
    const sub = window.crypto && window.crypto.subtle;
    if (!sub) { c.notes.push('无 crypto.subtle,没比终跑写前快照'); return; }
    const h = await sub.digest('SHA-256', new TextEncoder().encode(JSON.stringify(snapshot(d))));
    c.sameAsTested = [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('') === op.sha;
    if (!c.sameAsTested) c.notes.push('线上写前状态与终跑试跑时的不同(只记不拦;pre 另核)');
  }

  // ─── HTTP ────────────────────────────────────────────────
  const R = (http, body) => ({ http, body, code: body == null ? 0 : has(body, 'code') ? Number(body.code) : -1,
    data: body == null ? null : body.data, msg: body == null ? '' : String(body.message == null ? '' : body.message) });
  const ok = r => r.http === 200 && r.code === 0;
  const say = r => `http ${r.http} code ${r.code} ${r.msg}`;
  async function call(method, path, body) {
    const headers = { Authorization: 'Bearer ' + (typeof TOKEN === 'function' ? TOKEN() : TOKEN) };
    const init = { method, headers };
    if (body !== null && body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    if (method !== 'GET') CACHE = new Map();   // 任何写都作废引用扫描的 GET 缓存
    // 归属段全表(segsAll)只有改表会动它:删合同/删租户只在没有段引用它们时才发(否则前置就停了),删了也不改段
    if (method !== 'GET' && /^\/api\/meters/.test(path)) SEGS = null;
    const r = await (cx.fetch || window.fetch.bind(window))(path, init);
    const s = await r.text();
    let j = null;
    if (s.trim()) { try { j = JSON.parse(s); } catch (e) { j = { code: -1, message: s.slice(0, 300) }; } }
    return R(r.status, j);
  }
  /** 只读 GET,非 2xx 抛错(调用方整项失败);refs 扫描用缓存,写一次清一次。 */
  async function need(path, cached) {
    if (cached && CACHE.has(path)) return CACHE.get(path);
    const r = await call('GET', path);
    if (!ok(r)) throw new Error(`GET ${path} → ${say(r)}`);
    const d = r.data == null ? [] : r.data;
    if (cached) CACHE.set(path, d);
    return d;
  }

  // ─── 每项上下文 ───────────────────────────────────────────
  const ctx = (n, op, dry) => ({ n, file: op.file, opIndex: op.idx, ref: op.ref, op: op.op, dry: !!dry, status: 'ok', errors: [],
    preMismatch: [], preUnchecked: [], expectMismatch: [], expectUnchecked: [], notes: [], requests: [] });
  const fail = (c, why) => { c.status = 'failed'; c.errors.push(why); };
  const applied = (c, why) => { c.status = 'already-applied'; c.notes.push(why); };
  const record = (c, method, path, body, r, after, kind) => c.requests.push({ method, path, body: body === undefined ? null : body,
    kind: kind || null, http: r.http, code: r.code, message: r.msg, ok: ok(r), response: r.data === undefined ? null : r.data,
    after: after === undefined ? null : after });
  const dryRec = (c, method, path, body) => { c.requests.push({ method, path, body: body === undefined ? null : body, dry: true }); c.notes.push('dry:未发送'); };

  const resolve = v => {
    if (v === undefined) return null;
    if (typeof v === 'string' && v.startsWith('$')) { if (!has(V, v)) throw new Error('占位符未解析: ' + v); return V[v]; }
    if (Array.isArray(v)) return v.map(resolve);
    return v;
  };

  // ─── contract.patch ─────────────────────────────────────
  const marker = op => {
    if (op.marker != null) return String(op.marker);   // remark 整段改写时显式给
    if (op.append && op.append.remark != null) return String(op.append.remark);
    const set = op.set || {};
    if (set.remark === undefined || set.remark === null) return null;
    const s = String(set.remark);
    const pre = op.pre && has(op.pre, 'contract') ? op.pre.contract : (op.pre || {});
    const base = pre.remark === undefined || pre.remark === null ? '' : String(pre.remark);
    if (!s.startsWith(base) || s.length === base.length) return null;
    const tail = s.slice(base.length);
    return tail.startsWith(' | ') ? tail.slice(3) : tail;
  };
  const lineReq = l => { const o = {}; for (const f of LINE_FIELDS) o[f] = has(l, f) ? l[f] : null; o.unitIds = null; return o; };
  const addLine = a => { const o = {}; for (const f of LINE_FIELDS) o[f] = f === 'id' ? null : has(a, f) ? resolve(a[f]) : null; return o; };
  function fullReq(d, withLines) {
    const ct = d.contract || {}, r = {};
    for (const f of REQ_FIELDS) r[f] = has(ct, f) ? ct[f] : null;
    r.status = stored(txt(ct.status));
    r.extraUnitIds = null;
    r.billingLines = withLines ? (d.billingLines || []).map(lineReq) : null;
    return r;
  }
  function applySet(body, set) {
    for (const [k, v0] of Object.entries(set || {})) {
      let v = resolve(v0);
      if (k === 'rentFree' && typeof v === 'string') v = JSON.stringify(JSON.parse(v));   // toWire:紧凑格式
      body[k] = v;
    }
  }
  function applyAppend(c, body, append) {
    for (const [k, v] of Object.entries(append || {})) {
      const cur = body[k] === undefined || body[k] === null ? '' : String(body[k]);
      const nv = cur.trim() === '' ? String(v) : cur + ' | ' + v;
      if (nv.length > 255) { fail(c, `${k} 追加后 ${nv.length} 字 > 255`); return false; }
      body[k] = nv;
    }
    return true;
  }
  const keyed = (lines, k) => (lines || []).filter(l => lineKey(l) === k);

  function comparePre(c, pc, d, prefix) {
    const ct = d.contract || {};
    for (const [k, e] of Object.entries(pc || {})) {
      let a;
      if (k === 'lines') continue;
      if (k.startsWith('status')) { a = stored(txt(ct.status)); c.statusDerived = true; }
      else if (k === 'lineCount') a = (d.billingLines || []).length;
      else if (k === 'extraUnitIds') a = d.extraUnitIds;
      else if (k === 'lineKeys') {   // 打包时由 pre.lineIds 换来:行键多重集
        const got = (d.billingLines || []).map(lineKey).sort(), want = [...e].sort();
        if (!same(want, got)) c.preMismatch.push(`${prefix}lineKeys: 期望 ${J(want)} 实际 ${J(got)}`);
        continue;
      } else if (k === 'lineIds') { c.preMismatch.push(prefix + 'lineIds 未经打包换成行键'); continue; }
      else if (has(ct, k)) a = ct[k];
      else { c.preUnchecked.push(prefix + k); continue; }
      if (!same(e, a)) c.preMismatch.push(`${prefix}${k}: 期望 ${J(e)} 实际 ${J(a)}`);
    }
  }
  async function checkPre(c, op, d0) {
    const pre = op.pre || {};
    const nested = has(pre, 'contract');
    comparePre(c, nested ? pre.contract : pre, d0, '');
    if (nested) for (const [k, v] of Object.entries(pre)) {
      if (k === 'contract' || k === 'lines') continue;
      const m = OTHER_CONTRACT.exec(k);   // 例 "zbn23(474)":另一份合同的现值
      if (m && v !== null && typeof v === 'object' && !Array.isArray(v)) {
        const g = await call('GET', '/api/contracts/' + m[1]);
        if (!ok(g)) { c.preMismatch.push(`${k}: GET → ${g.code}`); continue; }
        comparePre(c, v, g.data, k + '.');
      } else c.preUnchecked.push(k);
    }
    const pl = pre.lines;
    if (pl !== null && typeof pl === 'object' && !Array.isArray(pl)) for (const [k, fs] of Object.entries(pl)) {
      if (/^\d+$/.test(k)) { c.preMismatch.push('pre.lines 仍是行 id(未经打包换成键): ' + k); continue; }
      const m = keyed(d0.billingLines, k);
      if (m.length !== 1) { c.preMismatch.push(`计费行[${k}] 在 GET 里 ${m.length} 行(要 1 行)`); continue; }
      for (const [f, e] of Object.entries(fs)) {
        if (!has(m[0], f)) { c.preUnchecked.push(`计费行[${k}].${f}`); continue; }
        if (!same(e, m[0][f])) c.preMismatch.push(`计费行[${k}].${f}: 期望 ${J(e)} 实际 ${J(m[0][f])}`);
      }
    }
    if (c.statusDerived) { c.notes.push('status 按 GET 展示态收回存储态(future/expiring/expired→active)'); delete c.statusDerived; }
    return c.preMismatch.length === 0;
  }
  function patchLines(c, d0, lines) {
    const ls = d0.billingLines || [], act = new Map();
    const pick = (k, what) => {
      if (typeof k !== 'string' || /^\d+$/.test(k)) { fail(c, `${what} 引用 ${J(k)} 不是行键(未经打包转换)`); return null; }
      const m = keyed(ls, k);
      if (m.length !== 1) { fail(c, `${what} 计费行[${k}] 在 GET 里 ${m.length} 行(要 1 行)`); return null; }
      if (act.has(m[0])) { fail(c, `${what} 计费行[${k}] 被引用两次`); return null; }
      return m[0];
    };
    for (const k of lines.remove || []) { const l = pick(k, 'remove'); if (!l) return null; act.set(l, { rm: true }); }
    for (const u of lines.update || []) { const l = pick(u.k, 'update'); if (!l) return null; act.set(l, { u }); }
    const bl = [], kept = new Set();
    for (const l of ls) {
      const a = act.get(l);
      if (a && a.rm) continue;
      const r = lineReq(l);
      if (a && a.u) for (const [k, v] of Object.entries(a.u)) {
        if (k === 'k' || k === 'id' || k === 'feeName') continue;
        if (!LINE_FIELDS.includes(k)) { c.notes.push('update 键接口不收: ' + k); continue; }
        r[k] = resolve(v);
      }
      kept.add(lineKey(r));
      bl.push(r);
    }
    // 只加行的操作重跑会重复插行(接口无重复行校验):目标行已在就停
    for (const a of lines.add || []) {
      const r = addLine(a), k = lineKey(r);
      if (kept.has(k)) { fail(c, '目标行已存在(疑已应用或重复): ' + k); return null; }
      kept.add(k);
      bl.push(r);
    }
    return bl;
  }
  function checkExpect(c, op, putResp, after) {
    const ct = (after && after.contract) || {};
    for (const [k, e0] of Object.entries(op.expect || {})) {
      let e = e0, a;
      if (typeof e === 'string' && e.startsWith('$') && has(V, e)) e = V[e];
      if (k === 'lineCount') a = ((after && after.billingLines) || []).length;
      else if (k === 'warnings') { if (!putResp) { c.expectUnchecked.push(k + '(没发 PUT,无回包)'); continue; } a = putResp.warnings; }
      else if (k.startsWith('status(')) a = stored(txt(ct.status));
      else if (has(ct, k)) a = ct[k];
      else { c.expectUnchecked.push(k); continue; }
      if (!same(e, a)) c.expectMismatch.push(`${k}: 期望 ${J(e)} 实际 ${J(a)}`);
    }
    if (c.expectMismatch.length) fail(c, 'expect 不符: ' + c.expectMismatch.join(' ; '));
  }

  /** target 的合同 id:有 idKey 用它;否则按 noKey 的合同号在合同列表里找,恰好 1 份,否则整项失败(返回 null)。 */
  async function contractIdOf(c, t, idKey, noKey) {
    if (t[idKey] != null) return t[idKey];
    const no = t[noKey];
    if (no == null) { fail(c, `target 缺 ${idKey}/${noKey}`); return null; }
    const hit = (await need('/api/contracts')).filter(x => txt(x.contractNo) === no).map(x => x.id);
    if (hit.length !== 1) { fail(c, `合同号 ${no} 在合同列表里 ${hit.length} 份(要 1 份)`); return null; }
    c.notes.push(`${no} → id ${hit[0]}`);
    return hit[0];
  }
  /** 线上版本门:/version.json(前端构建产物,CI 前后端同发)低于 want 就记前置不符。 */
  const vnum = v => String(v).split('.').map(Number);
  const vlt = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); return false; };
  async function versionGate(c, want, dry) {
    const r = await call('GET', '/version.json');
    const v = r.http === 200 && r.body && r.body.version;
    if (!v || !/^\d+\.\d+\.\d+$/.test(String(v))) { c.preMismatch.push(`读不到线上版本(/version.json → http ${r.http})`); return false; }
    c.notes.push(`线上版本 ${v}`);
    if (vlt(v, want)) { c.preMismatch.push(`线上版本 ${v} < ${want}(本项要新版接口)`); return false; }
    // 同版本号不等于同功能:探续签接口认不认 linkType。非法值 → 新后端 @Pattern 拒(http 400),不进 service、不写库;
    // 老后端不认这个字段照常进 service,合同 0 不存在 → code 404。每次 run 只探一次
    if (dry) { c.notes.push('dry:没发 linkType 探针'); return true; }
    if (PROBE === null) {
      const r = await call('POST', '/api/contracts/0/renew', { contractNo: '__probe__', linkType: '__probe__' });
      PROBE = r.http === 400 ? true : say(r);
    }
    c.notes.push('续签接口 linkType 探针: ' + (PROBE === true ? '认(http 400)' : PROBE));
    if (PROBE !== true) { c.preMismatch.push(`线上续签接口不认 linkType(探针回 ${PROBE}),本项要新版接口`); return false; }
    return true;
  }

  async function patchContract(c, op, dry) {
    if (op.requires && !await versionGate(c, op.requires, dry)) return fail(c, '前置不符,未发请求');
    const id = await contractIdOf(c, op.target, 'contractId', 'contractNo');
    if (id === null) return;
    const path = '/api/contracts/' + id;
    const g = await call('GET', path);
    if (!ok(g)) return fail(c, `GET ${path} → ${say(g)}`);
    const d0 = g.data;
    await tested(c, op, d0);
    const mk = marker(op);
    if (mk !== null && txt(d0.contract.remark === null ? '' : d0.contract.remark).includes(mk)) {
      checkExpect(c, op, null, d0);   // 写发出去了不等于写对了:上次停在 expect 的项,续跑时照样核
      if (c.status === 'failed') return;
      return applied(c, 'remark 已含本操作特征串,现值合 expect,判已应用: ' + mk);
    }
    if (!await checkPre(c, op, d0)) return fail(c, '前置不符,未发请求');
    const lines = op.lines || {};
    const noLineChange = empty(lines.remove) && empty(lines.update) && empty(lines.add);
    if (noLineChange) c.notes.push('lines 三组全空 → billingLines 传 null(不重建计费行)');
    const body = fullReq(d0, !noLineChange);
    applySet(body, op.set);
    if (!applyAppend(c, body, op.append)) return;
    if (!noLineChange) { const bl = patchLines(c, d0, lines); if (!bl) return; body.billingLines = bl; }
    if (dry) return dryRec(c, 'PUT', path, body);
    const p = await call('PUT', path, body);
    const ag = await call('GET', path);
    record(c, 'PUT', path, body, p, ag.data);
    if (!ok(p)) return fail(c, 'PUT → ' + say(p));
    if (!ok(ag)) return fail(c, `写后 GET ${path} → ${say(ag)}`);
    checkExpect(c, op, p.data, ag.data);
  }

  // ─── contract.renew ─────────────────────────────────────
  /** 续签/递增段(runner.renewContract 同款):pre 核旧合同;旧合同已有后继就停(再续会分叉)。
   *  新合同号已在:父指针须是旧合同,remark 含特征串且 linkType、expect 都对才判已应用,否则只补 PUT。
   *  POST 之后 linkType / 父指针 / 旧合同存储态有一样不对就停,不发 PUT(新合同已建,停下交人看)。 */
  async function renewContract(c, op, dry) {
    if (op.requires && !await versionGate(c, op.requires, dry)) return fail(c, '前置不符,未发请求');
    const t = op.target, b = op.body || {};
    const oldId = await contractIdOf(c, t, 'fromContractId', 'fromContractNo');
    if (oldId === null) return;
    const no = t.contractNo;
    let newId = null;
    const kids = [];
    for (const x of await need('/api/contracts')) {
      if (txt(x.contractNo) === no) newId = x.id;
      else if (x.parentContractId === oldId) kids.push(x.id);
    }
    const og = await call('GET', '/api/contracts/' + oldId);
    if (!ok(og)) return fail(c, `GET 旧合同 ${oldId} → ${say(og)}`);
    const old = og.data;
    const mk = marker(op);
    const wantLt = b.linkType != null ? b.linkType : 'renew';
    if (newId !== null) {
      const nd = await need('/api/contracts/' + newId), nc = nd.contract || {};
      if (nc.parentContractId !== oldId) return fail(c, `合同号 ${no} 已存在(id=${newId})但父指针是 ${J(nc.parentContractId)} 不是 ${oldId}`);
      if (nc.linkType !== wantLt) return fail(c, `合同号 ${no} 已存在(id=${newId})但 linkType 是 ${J(nc.linkType)} 不是 ${wantLt}`);
      if (mk !== null && txt(nc.remark === null ? '' : nc.remark).includes(mk)) {
        checkExpect(c, op, null, nd);
        if (c.status === 'failed') return;
        return applied(c, '新合同已在、remark 含特征串、现值合 expect,判已应用: ' + mk);
      }
      c.notes.push(`新合同已在(id=${newId}),只补 PUT`);
    } else {
      await tested(c, op, old);
      if (kids.length) c.preMismatch.push(`旧合同 ${oldId} 已有后继 ${J(kids)},再续会分叉`);
      if (!await checkPre(c, op, old)) return fail(c, '前置不符,未发请求');
      const rb = { contractNo: no };
      for (const f of ['startDate', 'endDate', 'signDate', 'linkType']) rb[f] = has(b, f) ? b[f] : null;
      const rp = `/api/contracts/${oldId}/renew`;
      if (dry) { dryRec(c, 'POST', rp, rb); c.notes.push('dry:新合同不存在,PUT 那一步要等 POST 真做后'); return; }
      // 旧合同只在新一期已起租时标 renewed(ContractService.renew,2026-07-28 裁定);没起租 → 存储态不变
      const oldBefore = stored(txt((old.contract || {}).status));
      const wantOld = rb.startDate == null || String(rb.startDate) <= today() ? 'renewed' : oldBefore;
      const p = await call('POST', rp, rb);
      const after = { old: (await call('GET', '/api/contracts/' + oldId)).data };
      if (ok(p)) after.new = (await call('GET', '/api/contracts/' + p.data.id)).data;
      record(c, 'POST', rp, rb, p, after);
      if (!ok(p)) return fail(c, `POST ${rp} → ${say(p)}`);
      newId = p.data.id;
      c.notes.push('新合同 id=' + newId);
      if (p.data.linkType !== wantLt) c.expectMismatch.push(`linkType: 期望 ${wantLt} 实际 ${J(p.data.linkType)}`);
      if (p.data.parentContractId !== oldId) c.expectMismatch.push(`parentContractId: 期望 ${oldId} 实际 ${J(p.data.parentContractId)}`);
      const os = after.old && after.old.contract ? stored(txt(after.old.contract.status)) : null;
      if (os !== wantOld) c.expectMismatch.push(`旧合同 status: 期望 ${wantOld} 实际 ${J(os)}`);
      if (c.expectMismatch.length) return fail(c, `续签回包不符,没发 PUT(新合同 id=${newId} 已建,交人核): ` + c.expectMismatch.join(' ; '));
    }
    const path = '/api/contracts/' + newId;
    const d0 = await need(path);
    const body = fullReq(d0, true);
    applySet(body, op.set);
    if (!applyAppend(c, body, op.append)) return;
    const bl = patchLines(c, d0, op.lines || {});
    if (!bl) return;
    const binds = new Map();
    for (const l of old.billingLines || []) { const k = lineKey(l); if (!binds.has(k)) binds.set(k, []); binds.get(k).push(Array.isArray(l.unitIds) ? l.unitIds : []); }
    for (const r of bl) { const q = binds.get(lineKey(r)); r.unitIds = q && q.length ? q.shift() : []; }
    body.billingLines = bl;
    body.extraUnitIds = Array.isArray(old.extraUnitIds) ? old.extraUnitIds : [];
    if (dry) return dryRec(c, 'PUT', path, body);
    const pu = await call('PUT', path, body);
    const ag = await call('GET', path);
    record(c, 'PUT', path, body, pu, ag.data);
    if (!ok(pu)) return fail(c, 'PUT → ' + say(pu));
    if (!ok(ag)) return fail(c, `写后 GET ${path} → ${say(ag)}`);
    checkExpect(c, op, pu.data, ag.data);
  }

  // ─── contract.create / delete ───────────────────────────
  async function createContract(c, op, dry) {
    if (!await identity(c, op)) return fail(c, '前置不符,未发请求');
    const no = op.target.contractNo;
    const hit = (await need('/api/contracts')).filter(x => no === txt(x.contractNo));
    if (hit.length) {   // 同号已在:得是这一项建的那份(租户对、remark 带特征串、现值合 expect)才算已应用,否则停
      const d = await need('/api/contracts/' + hit[0].id), ct = d.contract || {}, mk = marker(op);
      const wantTid = resolve((op.set || {}).tenantId);
      if (Number(ct.tenantId) !== Number(wantTid)) return fail(c, `合同号 ${no} 已存在(id=${hit[0].id})但租户是 ${J(ct.tenantId)} 不是 ${wantTid}`);
      if (mk !== null && !txt(ct.remark === null ? '' : ct.remark).includes(mk)) return fail(c, `合同号 ${no} 已存在(id=${hit[0].id})但 remark 不含本项特征串`);
      checkExpect(c, op, null, d);
      if (c.status === 'failed') return;
      return applied(c, `合同号已存在且是本项建的那份,判已应用: ${no} id=${hit[0].id}`);
    }
    const body = {};
    applySet(body, op.set);
    if (!has(op.set || {}, 'billingLines')) {
      const add = ((op.lines && op.lines.add) || []).map(addLine);
      body.billingLines = add.length ? add : null;
    }
    if (dry) return dryRec(c, 'POST', '/api/contracts', body);
    const p = await call('POST', '/api/contracts', body);
    const nid = p.data && p.data.id;
    const ag = ok(p) ? await call('GET', '/api/contracts/' + nid) : null;
    record(c, 'POST', '/api/contracts', body, p, ag && ag.data);
    if (!ok(p)) return fail(c, 'POST → ' + say(p));
    c.notes.push('新合同 id=' + nid);
    if (!ok(ag)) return fail(c, `写后 GET /api/contracts/${nid} → ${say(ag)}`);
    checkExpect(c, op, p.data, ag.data);
  }

  // refs:runner 用 SQL 计数的引用,这里逐个走只读接口。
  //   单:按月取全部单(不按租户筛 —— 别户的单也可能引用这份合同,库里跨户引用 15 行),非草稿/作废的逐张看明细行;
  //   归属段:逐块表取 timeline(一块表的全部归属段),不按「有读数的月」站位看 —— 那样扫不到读数月之外的段;
  //   备注覆盖:接口要按月查,月份取 单月 ∪ 读数月 ∪ 池月,这三类之外的月份仍扫不到(RUNBOOK 列为残余风险)。
  const billMonths = () => need('/api/bill-notices/months', true);
  async function allNotices() {
    const out = [];
    for (const m of await billMonths()) out.push(...await need('/api/bill-notices?ym=' + m, true));
    return out;
  }
  async function segsAll() {   // [{meterId, fromYm, tenantId, contractId}] 全部表的全部归属段(每块表一次 GET);缓存到下一次改表为止
    if (SEGS) return SEGS;
    const out = [];
    for (const m of await need('/api/meters', true)) {
      const tl = await need(`/api/meters/${m.id}/timeline?ym=${today().slice(0, 7)}`, true);
      out.push(...(tl.assign || []).map(a => ({ meterId: m.id, fromYm: a.fromYm, tenantId: a.tenantId, contractId: a.contractId })));
    }
    return (SEGS = out);
  }
  async function metersWhere(pred) {
    const hit = new Map();
    for (const a of await segsAll()) if (pred(a)) hit.set(a.meterId, (hit.get(a.meterId) || []).concat(a.fromYm));
    return [...hit].map(([id, yms]) => `表${id}@${yms.join('/')}起`);
  }
  // op.who(打包时取自 db-snapshot):线上这个 id 是不是同一个楼栋/租户/合同。不符就停,一条写都不发
  async function identity(c, op) {
    const w = op.who || {};
    if (w.building) {
      const b = await need('/api/buildings/' + w.building[0]);
      if (txt((b.building || {}).name) !== w.building[1]) c.preMismatch.push(`楼栋 ${w.building[0]}: 期望「${w.building[1]}」实际 ${J((b.building || {}).name)}`);
    }
    if (w.tenant) {
      const t = await call('GET', '/api/tenants/' + w.tenant[0]);
      const nm = ok(t) ? (t.data.tenant || {}).companyName : undefined;
      if (txt(nm) !== w.tenant[1]) c.preMismatch.push(`租户 ${w.tenant[0]}: 期望「${w.tenant[1]}」实际 ${ok(t) ? J(nm) : say(t)}`);
    }
    if (w.contract) {
      const g = await call('GET', '/api/contracts/' + w.contract[0]);
      if (ok(g) && txt((g.data.contract || {}).contractNo) !== w.contract[1]) c.preMismatch.push(`合同 ${w.contract[0]}: 期望「${w.contract[1]}」实际 ${J(g.data.contract.contractNo)}`);
    }
    return c.preMismatch.length === 0;
  }

  async function deleteContract(c, op, dry) {
    const id = op.target.contractId, path = '/api/contracts/' + id, tid = op.target.tenantId;
    const g = await call('GET', path);
    if (g.http === 404 || g.code === 404) return applied(c, '合同已不存在,判已应用');
    if (!ok(g)) return fail(c, `GET ${path} → ${say(g)}`);
    const d = g.data;
    await tested(c, op, d);
    if (Number(d.contract.tenantId) !== tid) c.preMismatch.push(`tenantId: 期望 ${tid} 实际 ${J(d.contract.tenantId)}`);
    if (!empty(d.billingLines)) c.preMismatch.push(`计费行 ${d.billingLines.length} 条`);
    if (!empty(d.extraUnitIds)) c.preMismatch.push('附加单元 ' + J(d.extraUnitIds));
    await identity(c, op);
    const pinned = await metersWhere(m => m.contractId === id);
    if (pinned.length) c.preMismatch.push('meter_assign 钉住: ' + pinned.join(','));
    const live = (await allNotices()).filter(x => x.status !== 'draft' && x.status !== 'void');   // 只有非草稿/作废的单才要看明细行
    c.notes.push(`全部租户非草稿/作废的单 ${live.length} 张,逐张看明细行`);
    for (const x of live) {
      const det = await need('/api/bill-notices/' + x.id, true);
      const k = (det.lines || []).filter(l => l.contractId === id).length;
      if (k) c.preMismatch.push(`被 ${x.status} 单 ${x.ym}#${x.id}(租户 ${x.tenantId})引用 ${k} 行`);
    }
    if (c.preMismatch.length) return fail(c, '前置不符,未发请求');
    if (dry) return dryRec(c, 'DELETE', path, null);
    const del = await call('DELETE', path);
    const a = await call('GET', path);
    record(c, 'DELETE', path, null, del, a.body);
    if (!ok(del)) return fail(c, 'DELETE → ' + say(del));
    if (!(a.http === 404 || a.code === 404)) fail(c, '删后 GET 仍在: ' + say(a));
  }

  // ─── tenant.patch / delete ──────────────────────────────
  async function patchTenant(c, op, dry) {
    const path = '/api/tenants/' + op.target.tenantId;
    const g = await call('GET', path);
    if (!ok(g)) return fail(c, `GET ${path} → ${say(g)}`);
    const t = g.data.tenant || {};
    const mk = op.append && op.append.remark != null ? String(op.append.remark) : null;
    const aliasesDone = !has(op.set || {}, 'aliases') || same(op.set.aliases, t.aliases);
    if (aliasesDone && (mk === null || txt(t.remark === null ? '' : t.remark).includes(mk))) return applied(c, '别名与备注已是目标值,跳过');
    for (const [k, e] of Object.entries(op.pre || {}))
      if (!same(e, t[k])) c.preMismatch.push(`${k}: 期望 ${J(e)} 实际 ${J(t[k])}`);
    if (c.preMismatch.length) return fail(c, '前置不符,未发请求');
    const body = {};
    for (const f of TENANT_FIELDS) body[f] = has(t, f) ? t[f] : null;
    applySet(body, op.set);
    if (!applyAppend(c, body, op.append)) return;
    if (dry) return dryRec(c, 'PUT', path, body);
    const p = await call('PUT', path, body);
    const after = (await call('GET', path)).data;
    record(c, 'PUT', path, body, p, after);
    if (!ok(p)) fail(c, 'PUT → ' + say(p));
  }

  async function deleteTenant(c, op, dry) {
    const tid = op.target.tenantId, path = '/api/tenants/' + tid;
    const g = await call('GET', path);
    if (g.http === 404 || g.code === 404) return applied(c, '租户已不存在,判已应用');
    if (!ok(g)) return fail(c, `GET ${path} → ${say(g)}`);
    if (!await identity(c, op)) return fail(c, '前置不符,未发请求');
    const of = (rows, f = 'tenantId') => rows.filter(x => x[f] === tid).length;
    const refs = {};
    refs.contract = (g.data.contracts || []).length;
    const ns = (await allNotices()).filter(x => x.tenantId === tid);
    refs.bill_notice = ns.length;
    let notes = 0;
    const noteMonths = new Set([...await billMonths(), ...await need('/api/meters/months', true), ...await need('/api/alloc/pool-months', true)]);
    for (const m of [...noteMonths].sort()) notes += (await need(`/api/bill-notices/notes?ym=${m}&tenantId=${tid}`, true)).length;
    refs.bill_note_override = notes;
    c.notes.push(`备注覆盖扫了 ${noteMonths.size} 个月(单月 ∪ 读数月 ∪ 池月),别的月份扫不到`);
    refs.bill_pay_company = of(await need('/api/bills/paymap', true));
    refs.monthly_ledger = of(await need('/api/analysis/ledger-tenant-months', true));
    refs.s10_record = of(await need('/api/analysis/s10-tenant-months', true));
    refs.meter_assign = (await metersWhere(m => m.tenantId === tid)).length;
    let ar = 0;
    for (const m of await need('/api/alloc/pool-months', true)) ar += of(await need('/api/alloc/result?ym=' + m, true));
    refs.alloc_result = ar;
    refs.alloc_rule_member = (await need('/api/alloc/rules', true)).reduce((s, r) => s + of(r.members || []), 0);
    refs['tenant(parent_id)'] = of(await need('/api/tenants', true), 'parentId');
    c.preUnchecked.push('recon_mark(无只读接口;删租户时后端把它置 NULL)');
    c.notes.push('引用计数: ' + J(refs) + (ns.length ? ' 单: ' + J(ns.map(x => `${x.ym}#${x.id}:${x.status}`)) : ''));
    for (const [k, v] of Object.entries(refs)) if (v > 0) c.preMismatch.push(`${k} 还有 ${v} 行`);
    if (c.preMismatch.length) return fail(c, '前置不符,未发请求');
    if (dry) return dryRec(c, 'DELETE', path, null);
    const d = await call('DELETE', path);
    const a = await call('GET', path);
    record(c, 'DELETE', path, null, d, a.body);
    if (!ok(d)) return fail(c, 'DELETE → ' + say(d));
    if (!(a.http === 404 || a.code === 404)) fail(c, '删后 GET 仍在: ' + say(a));
  }

  // ─── meter.assign ────────────────────────────────────────
  async function meterAssign(c, op, dry) {
    const body = op.body, row = op.target.assignRowId, mid = op.target.meterId;
    const pre = (op.pre || {})['meter_assign#' + row] || {};
    if (!await identity(c, op)) return fail(c, '前置不符,未发请求');
    if (pre.meterId !== mid) return fail(c, `pre.meterId ${J(pre.meterId)} ≠ target.meterId ${mid}`);
    const seg = async () => (await need(`/api/meters/${mid}/timeline?ym=${body.ym}`)).assign.find(a => a.meterId === mid && a.fromYm === pre.fromYm);
    const cur = await seg();
    if (!cur) { c.preMismatch.push(`表 ${mid} 没有 fromYm=${pre.fromYm} 的归属段`); return fail(c, '前置不符,未发请求'); }
    const want = body.patch.tenantId;
    if (cur.tenantId === want) return applied(c, `表 ${mid}@${pre.fromYm} 已挂 ${want}`);
    if (cur.tenantId !== pre.tenantId) { c.preMismatch.push(`表 ${mid}@${pre.fromYm}.tenantId: 期望 ${pre.tenantId} 实际 ${J(cur.tenantId)}`); return fail(c, '前置不符,未发请求'); }
    if (dry) return dryRec(c, 'PUT', '/api/meters/assign', body);
    const r = await call('PUT', '/api/meters/assign', body);
    const after = await seg();
    record(c, 'PUT', '/api/meters/assign', body, r, after || null);
    if (!ok(r)) return fail(c, 'PUT → ' + say(r));
    if (!after || after.tenantId !== want) fail(c, `写后归属段 tenantId 不是 ${want}: ${J(after)}`);
  }

  // ─── other:建单元 / 收款映射 / 重生成;param.put ──────────
  async function findUnit(path, j) {
    const b = await need(path.slice(0, path.lastIndexOf('/units')));
    return (b.units || []).find(u => Number(u.floor) === Number(j.floor) && txt(u.unitNo) === txt(j.unitNo));
  }
  async function createUnit(c, op, dry) {
    const path = op.body.path, j = op.body.json, saveAs = op.target.saveAs;
    if (!await identity(c, op)) return fail(c, '前置不符,未发请求');
    if (dry) {
      const u = await findUnit(path, j);
      if (u) { V[saveAs] = u.id; return applied(c, `单元已存在,沿用 ${saveAs}=${u.id}`); }
      V[saveAs] = `<dry ${saveAs}>`;
      return dryRec(c, 'POST', path, j);
    }
    const p = await call('POST', path, j);
    record(c, 'POST', path, j, p, null);
    if (ok(p)) { V[saveAs] = p.data.id; c.notes.push(`${saveAs}=${p.data.id}`); return; }
    if (p.code !== 409) return fail(c, 'POST → ' + say(p));
    const u = await findUnit(path, j);   // 已存在:取已有单元 id,不重建
    if (u) { V[saveAs] = u.id; return applied(c, `单元已存在,沿用 ${saveAs}=${u.id}`); }
    fail(c, '409 但找不到已有单元: ' + p.msg);
  }
  const findPaymap = async (tid, fk) => (await need('/api/bills/paymap')).find(x => x.tenantId === tid && x.feeKey === fk) || null;
  async function paymap(c, op, dry) {
    const j = op.body.json, tid = j.tenantId, fk = j.feeKey, want = j.companyId, ow = op.overwrite;
    if (!await identity(c, op)) return fail(c, '前置不符,未发请求');
    const cur = await findPaymap(tid, fk);
    if (cur) {
      if (Number(cur.companyId) === want) return applied(c, `(${tid},${fk}) 已是 ${want}`);
      if (!ow) { c.status = 'skipped'; c.notes.push(`(${tid},${fk}) 已存在 companyId=${cur.companyId},不覆盖`); return; }
      if (Number(cur.companyId) !== ow.expectCompanyId) { c.preMismatch.push(`(${tid},${fk}) 期望现值 ${ow.expectCompanyId} 实际 ${cur.companyId}`); return fail(c, '前置不符,未发请求'); }
    } else if (ow) { c.preMismatch.push(`(${tid},${fk}) 期望现值 ${ow.expectCompanyId} 实际不存在`); return fail(c, '前置不符,未发请求'); }
    if (dry) return dryRec(c, 'PUT', '/api/bills/paymap', j);
    const p = await call('PUT', '/api/bills/paymap', j);
    const now = await findPaymap(tid, fk);
    record(c, 'PUT', '/api/bills/paymap', j, p, now);
    if (!ok(p)) fail(c, 'PUT → ' + say(p));
    else if (!now || Number(now.companyId) !== want) fail(c, `写后 GET 不是 ${want}: ${J(now)}`);
  }
  /** 重生成:月份 = target.ym ∪ 待删租户有单的月;先记这些月的通知单基线,再逐月 alloc→bill-notices,任一月失败立刻停。 */
  async function regenerate(c, op, dry) {
    const months = new Set(op.target.ym || []);
    const gone = new Set(cx.ops.filter(o => o.file === op.file && o.op === 'tenant.delete').map(o => o.target.tenantId));
    const bad = [];
    for (const m of await need('/api/bill-notices/months')) for (const x of await need('/api/bill-notices?ym=' + m))
      if (gone.has(x.tenantId)) {
        months.add(m);
        c.notes.push(`${m} 有待删租户 ${x.tenantId} 的单 #${x.id} status=${x.status}`);
        if (x.status !== 'draft' && x.status !== 'void') bad.push(`${m} 租户${x.tenantId} 单#${x.id} status=${x.status}`);
      }
    const ms = [...months].sort();
    c.notes.push('重生成月份: ' + ms.join(','));
    if (bad.length) { c.preMismatch.push(...bad); return fail(c, '待删租户有非草稿/作废的单(重生成挪不走),列给用户,未发 generate'); }
    for (const m of ms) { const l = await call('GET', '/api/bill-notices?ym=' + m); record(c, 'GET', '/api/bill-notices?ym=' + m, null, l, null, 'baseline'); }
    for (const m of ms) for (const p of ['/api/alloc/generate?ym=' + m, '/api/bill-notices/generate?ym=' + m]) {
      if (dry) { dryRec(c, 'POST', p, null); continue; }
      const r = await call('POST', p);
      record(c, 'POST', p, null, r, null);
      if (!ok(r)) return fail(c, `POST ${p} → ${say(r)}(整体停止)`);
    }
  }
  async function simple(c, method, path, body, dry) {
    if (dry) return dryRec(c, method, path, body);
    const r = await call(method, path, body);
    record(c, method, path, body, r, null);
    if (!ok(r)) fail(c, `${method} ${path} → ${say(r)}`);
  }
  async function other(c, op, dry) {
    const b = op.body || {};
    if (has(b, 'calls')) return regenerate(c, op, dry);
    if (b.path === '/api/bills/paymap') return paymap(c, op, dry);
    if (/^\/api\/buildings\/\d+\/units$/.test(b.path || '')) return createUnit(c, op, dry);
    fail(c, '不认识的 other: ' + J(b));
  }
  function dispatch(c, op, dry) {
    switch (op.op) {
      case 'contract.patch': return patchContract(c, op, dry);
      case 'contract.create': return createContract(c, op, dry);
      case 'contract.delete': return deleteContract(c, op, dry);
      case 'contract.renew': return renewContract(c, op, dry);
      case 'tenant.patch': return patchTenant(c, op, dry);
      case 'tenant.delete': return deleteTenant(c, op, dry);
      case 'meter.assign': return meterAssign(c, op, dry);
      case 'param.put': return identity(c, op).then(y => y ? simple(c, op.body.method, op.body.path, op.body.json, dry) : fail(c, '前置不符,未发请求'));
      case 'other': return other(c, op, dry);
      default: return fail(c, '未知 op: ' + op.op);
    }
  }

  // ─── 装载 / 运行 / 取日志 ────────────────────────────────
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
  cx.add = (k, ops) => { cx.parts[k] = ops; return `chunk${k} ok(${ops.length} 项)`; };
  cx.seal = (nChunks, nOps, sum) => {
    const miss = [];
    for (let k = 2; k <= nChunks; k++) if (!cx.parts[k]) miss.push(k);
    if (miss.length) throw new Error('缺 chunk: ' + miss.join(','));
    const ops = [];
    for (let k = 2; k <= nChunks; k++) ops.push(...cx.parts[k]);
    if (ops.length !== nOps || fnv(JSON.stringify(ops)) !== sum) throw new Error(`变更集校验不过: ${ops.length}/${nOps} 项, fnv ${fnv(JSON.stringify(ops))}/${sum}`);
    return cx.load(ops);
  };
  cx.load = ops => {
    cx.ops = ops; cx.sealed = true; cx.parts = {}; cx.sum = fnv(JSON.stringify(ops));
    cx.restored = restore();
    return `loaded ${ops.length} ops` + (cx.restored ? `;接上 ${cx.restored} 存的进度:next=${cx.next},halt=${cx.halt ? cx.halt.n : 'null'}` : '');
  };

  // ─── 进度落 localStorage:页面刷新后重新贴 chunk 就接上(done/next/halt/vars/每项一行摘要;不存 token) ─────
  const store = () => { try { return window.localStorage || null; } catch (e) { return null; } };
  const KEY = () => 'cx:' + cx.sum;
  function save() {
    const s = store();
    if (!s || !cx.sum) return;
    try { s.setItem(KEY(), JSON.stringify({ at: new Date().toISOString(), done: cx.done, next: cx.next, halt: cx.halt, vars: cx.vars, lines: cx.lines })); cx.persistError = null; }
    catch (e) { cx.persistError = String((e && e.message) || e); }   // 存不进去不影响执行,status() 里报
  }
  function restore() {
    const s = store();
    let j = null;
    try { j = s && JSON.parse(s.getItem(KEY()) || 'null'); } catch (e) { return null; }
    if (!j) return null;
    cx.done = j.done || {}; cx.next = j.next || 0; cx.halt = j.halt || null; cx.lines = j.lines || [];
    for (const k of Object.keys(cx.vars)) delete cx.vars[k];
    Object.assign(cx.vars, j.vars || {});
    return j.at || '?';
  }
  cx.lines = [];
  cx.forget = () => {
    const s = store();
    try { if (s) s.removeItem(KEY()); } catch (e) { /* 清不掉就算了,内存里照样清 */ }
    cx.done = {}; cx.next = 0; cx.halt = null; cx.lines = []; cx.restored = null;
    for (const k of Object.keys(cx.vars)) delete cx.vars[k];
    return 'progress cleared';
  };

  const brief = c => `${c.n} ${c.file}[${c.opIndex}] ${c.op} ${c.dry ? 'DRY ' : ''}${c.status}${c.sameAsTested === false ? ' ≠tested' : ''}`
    + (c.errors.length ? ' ERR ' + c.errors.join(' ; ') : '') + (c.preMismatch.length ? ' PRE ' + c.preMismatch.join(' ; ') : '')
    + (c.expectMismatch.length ? ' EXP ' + c.expectMismatch.join(' ; ') : '');
  cx.run = async ({ from = 0, to, dry = false, token, stopOnFail = !dry, force = false, strict = !dry } = {}) => {
    if (!cx.sealed) throw new Error('变更集未装载(先按顺序执行全部 chunk)');
    if (cx.busy) throw new Error('上一次 run 还在跑: ' + J(cx.busy));
    if (!token) throw new Error('缺 token');
    to = to === undefined ? cx.ops.length : Math.min(to, cx.ops.length);
    TOKEN = token; V = dry ? Object.assign({}, cx.vars) : cx.vars; CACHE = new Map(); SEGS = null;
    cx.busy = { from, to, dry, at: from };
    PROBE = null;
    const resumeAt = cx.halt ? cx.halt.n : null;   // 从上次停下的那一项续跑:它可以是 already-applied(写已发出)
    const out = [], sts = [];
    let halted = null;
    try {
      for (let i = from; i < to; i++) {
        cx.busy.at = i;
        const op = cx.ops[i], c = ctx(i, op, dry);
        if (!dry && cx.done[i] && !force) { c.status = 'done-before'; c.notes.push('之前已成功执行过此项(进度在本页/localStorage;force:true 可重跑)'); }
        else {
          try { await dispatch(c, op, dry); } catch (e) { fail(c, 'exception: ' + (e && e.message ? e.message : e)); }
        }
        // strict:终跑试跑 183 项全是 ok;线上出现 skipped / already-applied 就是线上和试跑不一样,停下核
        if (strict && (c.status === 'skipped' || (c.status === 'already-applied' && i !== resumeAt)))
          fail(c, `strict:本项判了 ${c.status}(${c.notes.slice(-1)[0] || ''})—— 线上和终跑试跑不一样,停下核;核过没问题用 run({from:${i}, strict:false}) 接着跑`);
        cx.log.push(c);
        out.push(brief(c));
        sts.push(c.status);
        if (!dry) cx.lines[i] = brief(c).slice(0, 400);
        if (c.status === 'failed') {
          if (!dry) cx.halt = { n: i, file: c.file, opIndex: c.opIndex, ref: c.ref, errors: c.errors, preMismatch: c.preMismatch, expectMismatch: c.expectMismatch };
          if (!dry) save();
          if (stopOnFail) { halted = i; break; }
        } else if (!dry) {
          cx.done[i] = true; cx.next = i + 1;
          if (cx.halt && cx.halt.n === i) cx.halt = null;   // 停点这一项过了,停点清掉
          save();
        }
      }
    } finally { TOKEN = null; V = cx.vars; cx.busy = false; }
    const failed = sts.filter(s => s === 'failed').length;
    return { from, to, dry, strict, ran: out.length, failed, halted, next: cx.next, lines: out };
  };
  cx.brief = (a = 0, b = cx.log.length) => cx.log.slice(a, b).map(brief).join('\n');
  cx.dump = (a = 0, b = cx.log.length) => JSON.stringify(cx.log.slice(a, b));
  cx.entry = n => [...cx.log].reverse().find(c => c.n === n) || null;
  cx.status = () => ({ sealed: cx.sealed, ops: cx.ops.length, busy: cx.busy, next: cx.next, halt: cx.halt, log: cx.log.length, vars: cx.vars,
    restored: cx.restored, persist: store() ? (cx.persistError ? '存不进 localStorage: ' + cx.persistError : 'localStorage ' + KEY()) : '无 localStorage(刷新即丢)',
    done: Object.keys(cx.done).length, lines: cx.lines.filter(Boolean).length });
  return 'executor ready';
})();
