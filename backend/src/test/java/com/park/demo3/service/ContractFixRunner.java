package com.park.demo3.service;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;

/**
 * 合同修数变更集(scripts/contract-recon/changeset/*.json)的**接口试跑器**,**不是测试**:
 * 类名不以 Test/IT 结尾 → surefire 默认不跑;没有 -Dcfix.run 也不跑。
 *
 * 连临时库 park_demo3_cfix(mysqldump park_demo3 灌出),Flyway 照常开着(迁到当前分支版本),
 * 但迁移前先核库名(CfixOnly),URL 被改到别的库时 Flyway 一行不跑就拒。
 * 每个操作走真实 HTTP 接口(MockMvc,整条 Spring Security + 校验 + 异常映射都在),身份用 @WithMockUser。
 *
 * 每个操作:先判「已应用」(remark 特征串/合同号/映射值已在 → 跳过,重跑不重复加行)→ pre 硬门(任一可机核键
 * 不符就不发写请求)→ 写 → GET 核 expect。第一个失败的操作之后全部标 not-run(-Dcfix.stopOnFail=0 可关)。
 * contract.patch:GET 详情 → 照前端 toWire 拼完整 PUT 体 → 回滚事务里原样 PUT 一次做幂等检查 → 套 set/append/lines → PUT → GET。
 * 每个写请求落 requests/NNN.json:{ref, method, path, body, beforeDetailSig, beforeSnapshot, beforeSnapshotSha,
 * lostLineFields, afterDetail, ...};总表 requests/_summary.json。
 * ponytail: 这是 MockMvc 进程内执行器,打不到线上;线上要同逻辑的 HTTP 版(用户本人会话),另写。
 *
 * 运行(PowerShell,带点的参数要加引号):
 *   & backend\mvnw.cmd -f backend\pom.xml test "-Dtest=ContractFixRunner" "-Dcfix.run=1"
 * 可选 "-Dcfix.files=four,mgmt" 只跑其中几份(默认 four,mgmt,empty,merge 依序);"phase2:now" 只跑该文件 group=now 的项。
 * phase2 起:target 可只给 contractNo(运行时在合同列表里找,恰好 1 份);计费行可按键 location|feeKey|area 引用
 * (lines.remove 写键串、lines.update[].k、pre.lineKeys、pre.lines 的键),行 id 每次 PUT 都会重编;
 * contract.renew = POST /{旧}/renew(linkType)→ PUT 新合同(set/append/按键改行 + 旧合同同键行绑定与附加单元照抄)。
 */
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:mysql://127.0.0.1:13306/" + ContractFixRunner.DB + "?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true&useSSL=false&rewriteBatchedStatements=true",
    "spring.datasource.username=root",
    "spring.datasource.password=root",
})
@AutoConfigureMockMvc
@EnabledIfSystemProperty(named = "cfix.run", matches = ".+")
class ContractFixRunner {

    static final String DB = "park_demo3_cfix";

    /** 库名闸放在 Flyway 迁移之前:run() 里的闸晚于上下文启动,那时 Flyway 已经把连上的库迁完了。 */
    @TestConfiguration
    static class CfixOnly {
        @Bean
        FlywayMigrationStrategy cfixOnlyMigration() {
            return fw -> {
                try (Connection c = fw.getConfiguration().getDataSource().getConnection()) {
                    if (!DB.equals(c.getCatalog())) throw new IllegalStateException("拒绝迁移非临时库: " + c.getCatalog());
                } catch (java.sql.SQLException e) {
                    throw new IllegalStateException(e);
                }
                fw.migrate();
            };
        }
    }

    /** ContractCreateReq 里能从 ContractDTO 原样回带的字段(billingLines/extraUnitIds 另拼)。 */
    static final List<String> REQ_FIELDS = List.of("contractNo", "tenantId", "buildingId", "unitId", "buildingArea",
        "rentArea", "unitPrice", "monthlyRent", "deposit", "mgmtFeePrice", "infraFeePrice", "elevatorCount",
        "elevatorFloors", "elevatorFee", "transformerFee", "powerType", "kva", "startDate", "endDate", "signDate",
        "status", "remark", "rentFree", "termText", "termType", "tierPriceNote");
    /** BillingLineReq 的字段。变更集里 note/taxRate/feeName 接口不收,落不了库(计数进 droppedLineFields)。 */
    static final List<String> LINE_FIELDS = List.of("id", "propertyType", "location", "feeKey", "area", "areaShared",
        "unitPrice", "coeff", "roomCount", "billMode", "amountOverride", "seq", "unitIds");
    /** syncScalarCache 按计费行重算的缓存:原样 PUT 后变了 = 库里缓存本就与行不一致(漂移),补丁也会重算,不拦。 */
    static final Set<String> CACHE_FIELDS = Set.of("monthlyRent", "rentArea", "buildingArea", "unitPrice",
        "mgmtFeePrice", "infraFeePrice", "elevatorFee", "transformerFee", "billingLineCount", "unboundTermCount");
    /** 原样 PUT 比较时跳过:随日期派生、只在写回包出现。 */
    static final Set<String> VOLATILE = Set.of("warnings", "daysToEnd");
    /** 删租户前逐表计数(R16:引用要挪到主户,不许随删档丢)。 */
    static final List<String> TENANT_REF_TABLES = List.of("contract", "bill_notice", "monthly_ledger", "s10_record",
        "recon_mark", "bill_pay_company", "bill_note_override", "meter_assign", "alloc_result", "alloc_rule_member");
    static final Pattern OTHER_CONTRACT = Pattern.compile(".*\\((\\d+)\\)$");

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager txm;

    final ObjectMapper m = new ObjectMapper()
        .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
        .enable(JsonGenerator.Feature.WRITE_BIGDECIMAL_AS_PLAIN)
        .setNodeFactory(JsonNodeFactory.withExactBigDecimals(true));
    final Map<String, JsonNode> vars = new HashMap<>();
    Path out;
    int seq;
    ArrayNode currentOps;   // 当前文件全部操作(重生成要知道后面删哪几户)

    // ─── 一次 HTTP 调用 ─────────────────────────────────────────

    record R(int http, JsonNode body) {
        int code() { return body == null ? 0 : body.path("code").asInt(-1); }   // void 端点无回包 = 成功
        JsonNode data() { return body == null ? NullNode.instance : body.path("data"); }
        boolean ok() { return http == 200 && code() == 0; }
        String msg() { return body == null ? "" : body.path("message").asText(""); }
    }

    R call(String method, String path, JsonNode body) throws Exception {
        MockHttpServletRequestBuilder b = request(HttpMethod.valueOf(method), path).characterEncoding("UTF-8");
        if (body != null) b = b.contentType(MediaType.APPLICATION_JSON).content(m.writeValueAsBytes(body));
        MvcResult r = mvc.perform(b).andReturn();
        String s = r.getResponse().getContentAsString(StandardCharsets.UTF_8);
        JsonNode j = null;
        if (!s.isBlank()) {
            try { j = m.readTree(s); } catch (Exception e) { j = m.createObjectNode().put("code", -1).put("message", s); }
        }
        return new R(r.getResponse().getStatus(), j);
    }

    // ─── 每个操作的上下文与落盘 ───────────────────────────────────

    class Ctx {
        final String file; final int idx; final ObjectNode op;
        String status = "ok";
        final List<String> errors = new ArrayList<>(), preMismatch = new ArrayList<>(), preUnchecked = new ArrayList<>(),
            expectMismatch = new ArrayList<>(), expectUnchecked = new ArrayList<>(), notes = new ArrayList<>();
        final List<Integer> requests = new ArrayList<>();
        JsonNode identity, lostLineFields;
        int droppedNote, droppedTaxRate;
        Ctx(String file, int idx, ObjectNode op) { this.file = file; this.idx = idx; this.op = op; }
        String ref() { return op.path("ref").asText(); }
        void fail(String why) { status = "failed"; errors.add(why); }
        void applied(String why) { status = "already-applied"; notes.add(why); }
        boolean failed() { return status.equals("failed"); }
        ObjectNode summary() {
            ObjectNode s = m.createObjectNode();
            s.put("file", file).put("opIndex", idx).put("ref", ref()).put("op", op.path("op").asText())
                .put("status", status);
            s.set("target", op.path("target"));
            s.set("requests", m.valueToTree(requests));
            s.set("errors", m.valueToTree(errors));
            s.set("preMismatch", m.valueToTree(preMismatch));
            s.set("preUnchecked", m.valueToTree(preUnchecked));
            s.set("expectMismatch", m.valueToTree(expectMismatch));
            s.set("expectUnchecked", m.valueToTree(expectUnchecked));
            if (identity != null) s.set("identity", identity);
            if (lostLineFields != null) s.set("lostLineFields", lostLineFields);
            if (droppedNote + droppedTaxRate > 0)
                s.set("droppedLineFields", m.createObjectNode().put("note", droppedNote).put("taxRate", droppedTaxRate));
            s.set("notes", m.valueToTree(notes));
            return s;
        }
    }

    /** 写一条请求记录;返回序号。before=该对象写前的规范化快照(线上执行前拿它与线上 GET 的同款快照逐字比)。 */
    int record(Ctx c, String method, String path, JsonNode body, String sig, JsonNode before, R r, JsonNode after, String kind) throws Exception {
        int n = ++seq;
        ObjectNode rec = m.createObjectNode();
        rec.put("seq", n).put("file", c.file).put("opIndex", c.idx).put("ref", c.ref()).put("op", c.op.path("op").asText());
        if (kind != null) rec.put("kind", kind);
        rec.put("method", method).put("path", path);
        rec.set("body", body == null ? NullNode.instance : body);
        rec.put("beforeDetailSig", sig);
        if (before != null) {
            rec.set("beforeSnapshot", before);
            rec.put("beforeSnapshotSha", sha(before));
        }
        if (c.lostLineFields != null && kind == null) rec.set("lostLineFields", c.lostLineFields);
        rec.put("http", r.http()).put("code", r.code()).put("message", r.msg()).put("ok", r.ok());
        rec.set("response", r.data());
        rec.set("afterDetail", after == null ? NullNode.instance : after);
        m.writerWithDefaultPrettyPrinter().writeValue(out.resolve(String.format("%03d.json", n)).toFile(), rec);
        c.requests.add(n);
        System.out.printf("CFIX %03d %s %s %s -> http=%d code=%d %s%n", n, c.file, method, path, r.http(), r.code(), r.msg());
        return n;
    }

    String sha(JsonNode j) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(m.writeValueAsBytes(j)));
    }

    // ─── 入口 ───────────────────────────────────────────────────

    @Test
    @WithMockUser(username = "cfix-runner", authorities = {"master:edit", "contract:edit", "param-policy:edit",
        "param-monthly:edit", "meter-master:edit", "billing-run:edit", "billing-issue:edit"})
    void run() throws Exception {
        String db = jdbc.queryForObject("SELECT DATABASE()", String.class);
        // 硬闸:只许写临时库。开发库 park_demo3 只读。
        if (!DB.equals(db)) throw new IllegalStateException("拒绝在非临时库上运行: " + db);
        boolean stopOnFail = !"0".equals(System.getProperty("cfix.stopOnFail", "1"));
        Path dir = Path.of(System.getProperty("cfix.dir",
            Path.of(System.getProperty("user.dir")).resolveSibling("scripts").resolve("contract-recon").resolve("changeset").toString()));
        out = dir.resolve("requests");
        Files.createDirectories(out);
        try (var s = Files.list(out)) { for (Path p : s.toList()) if (p.toString().endsWith(".json")) Files.delete(p); }

        ArrayNode summary = m.createArrayNode();
        String haltedAt = null;
        for (String spec : System.getProperty("cfix.files", "four,mgmt,empty,merge").split(",")) {
            String[] fg = spec.trim().split(":", 2);   // "phase2:now" = 只跑 group=now 的项;opIndex 仍是文件内下标
            String f = fg[0];
            ArrayNode ops = (ArrayNode) m.readTree(dir.resolve(f + ".json").toFile());
            currentOps = ops;
            for (int i = 0; i < ops.size(); i++) {
                if (fg.length > 1 && !fg[1].equals(ops.get(i).path("group").asText())) continue;
                Ctx c = new Ctx(f, i, (ObjectNode) ops.get(i));
                if (haltedAt != null) c.status = "not-run";
                else {
                    try { dispatch(c); }
                    catch (Exception e) { c.fail("exception: " + e); e.printStackTrace(); }
                    if (c.failed() && stopOnFail) haltedAt = c.file + "[" + i + "] " + c.ref();
                }
                summary.add(c.summary());
                System.out.printf("CFIX-OP %s[%d] %s %s -> %s %s %s%n", c.file, i, c.op.path("op").asText(), c.ref(),
                    c.status, c.errors, c.preMismatch);
            }
        }
        m.writerWithDefaultPrettyPrinter().writeValue(out.resolve("_summary.json").toFile(), summary);
        System.out.println("CFIX-DONE requests=" + seq + " ops=" + summary.size() + " haltedAt=" + haltedAt);
    }

    void dispatch(Ctx c) throws Exception {
        JsonNode op = c.op;
        switch (op.path("op").asText()) {
            case "contract.patch" -> patchContract(c);
            case "contract.create" -> createContract(c);
            case "contract.delete" -> deleteContract(c);
            case "contract.renew" -> renewContract(c);
            case "tenant.patch" -> patchTenant(c);
            case "tenant.delete" -> deleteTenant(c);
            case "meter.assign" -> meterAssign(c);
            case "param.put" -> simple(c, op.path("body").path("method").asText(), op.path("body").path("path").asText(),
                op.path("body").path("json"));
            case "other" -> other(c);
            default -> c.fail("未知 op: " + op.path("op").asText());
        }
    }

    void simple(Ctx c, String method, String path, JsonNode body) throws Exception {
        R r = call(method, path, body);
        record(c, method, path, body, null, null, r, null, null);
        if (!r.ok()) c.fail(method + " " + path + " → http " + r.http() + " code " + r.code() + " " + r.msg());
    }

    // ─── contract.patch ────────────────────────────────────────

    /** target 的合同 id:有 idKey 用它;否则按 noKey 的合同号在列表里找,恰好 1 份,否则记失败返回 null。 */
    Integer contractId(Ctx c, JsonNode t, String idKey, String noKey) throws Exception {
        if (t.hasNonNull(idKey)) return t.path(idKey).asInt();
        String no = t.path(noKey).asText(null);
        if (no == null) { c.fail("target 缺 " + idKey + "/" + noKey); return null; }
        List<Integer> hit = new ArrayList<>();
        for (JsonNode x : call("GET", "/api/contracts", null).data())
            if (no.equals(x.path("contractNo").asText())) hit.add(x.path("id").asInt());
        if (hit.size() != 1) { c.fail("合同号 " + no + " 在合同列表里 " + hit.size() + " 份(要 1 份)"); return null; }
        c.notes.add(no + " → id " + hit.get(0));
        return hit.get(0);
    }

    void patchContract(Ctx c) throws Exception {
        Integer id = contractId(c, c.op.path("target"), "contractId", "contractNo");
        if (id == null) return;
        String path = "/api/contracts/" + id;
        R g = call("GET", path, null);
        if (!g.ok()) { c.fail("GET " + path + " → " + g.code() + " " + g.msg()); return; }
        JsonNode d0 = g.data();
        String marker = marker(c.op);
        if (marker != null && d0.path("contract").path("remark").asText("").contains(marker)) {
            c.applied("remark 已含本操作特征串,判已应用,跳过: " + marker);
            return;
        }
        if (!checkPre(c, d0, id)) { c.fail("前置不符,未发请求"); return; }

        JsonNode lines = c.op.path("lines");
        boolean noLineChange = lines.path("remove").isEmpty() && lines.path("update").isEmpty() && lines.path("add").isEmpty();
        if (noLineChange) c.notes.add("lines 三组全空 → billingLines 传 null(不重建计费行)");
        ObjectNode base = fullReq(d0, !noLineChange);

        c.identity = identityCheck(path, base, d0, id);
        if (!c.identity.path("blocking").isEmpty()) { c.fail("原样 PUT 不幂等: " + c.identity.path("blocking")); return; }

        ObjectNode body = base.deepCopy();
        applySet(c, body, c.op.path("set"));
        if (!applyAppend(c, body, c.op.path("append"))) return;
        if (!noLineChange) {
            ArrayNode bl = patchLines(c, d0, lines);
            if (bl == null) return;
            body.set("billingLines", bl);
            c.lostLineFields = lineExtras(id);
        }
        String sig = sig(d0);
        JsonNode before = snapshot(d0);
        R p = call("PUT", path, body);
        JsonNode after = call("GET", path, null).data();
        record(c, "PUT", path, body, sig, before, p, after, null);
        if (!p.ok()) { c.fail("PUT → http " + p.http() + " code " + p.code() + " " + p.msg()); return; }
        checkExpect(c, p.data(), after, id);
    }

    /** 已应用特征串:set.remark 在 pre.remark 之后追加的那段;或 append.remark。没有 remark 改动的操作返回 null。 */
    static String marker(JsonNode op) {
        if (op.hasNonNull("marker")) return op.path("marker").asText();   // remark 整段改写时显式给
        if (op.path("append").hasNonNull("remark")) return op.path("append").path("remark").asText();
        JsonNode set = op.path("set");
        if (!set.hasNonNull("remark")) return null;
        String s = set.path("remark").asText();
        JsonNode pre = op.path("pre").has("contract") ? op.path("pre").path("contract") : op.path("pre");
        String base = pre.hasNonNull("remark") ? pre.path("remark").asText() : "";
        if (!s.startsWith(base) || s.length() == base.length()) return null;
        String tail = s.substring(base.length());
        return tail.startsWith(" | ") ? tail.substring(3) : tail;
    }

    /** 前端 toWire 同款:DTO 字段原样回带;status 派生桶收回存储态;extraUnitIds=null(不动);计费行带原 id、unitIds=null(按键回挂)。 */
    ObjectNode fullReq(JsonNode d, boolean withLines) {
        JsonNode ct = d.path("contract");
        ObjectNode r = m.createObjectNode();
        for (String f : REQ_FIELDS) r.set(f, ct.has(f) ? ct.get(f) : NullNode.instance);
        r.put("status", stored(ct.path("status").asText()));
        r.putNull("extraUnitIds");
        if (!withLines) { r.putNull("billingLines"); return r; }
        ArrayNode ls = r.putArray("billingLines");
        for (JsonNode l : d.path("billingLines")) ls.add(lineReq(l));
        return r;
    }

    ObjectNode lineReq(JsonNode l) {
        ObjectNode o = m.createObjectNode();
        for (String f : LINE_FIELDS) o.set(f, l.has(f) ? l.get(f) : NullNode.instance);
        o.putNull("unitIds");
        return o;
    }

    /** ContractDTO.status 是展示态:future/expiring/expired 都由 active 派生(ContractService.effectiveStatus)。 */
    static String stored(String shown) {
        return switch (shown) { case "future", "expiring", "expired" -> "active"; default -> shown; };
    }

    /** 该合同现有行里接口写不回去的列(note/tax_rate/params):带 billingLines 的 PUT 会把它们全部清成 NULL。 */
    JsonNode lineExtras(int contractId) {
        ArrayNode a = m.createArrayNode();
        for (Map<String, Object> r : jdbc.queryForList("SELECT id, location, fee_key, note, tax_rate, params FROM contract_billing_term "
                + "WHERE contract_id=? AND (note IS NOT NULL OR tax_rate IS NOT NULL OR params IS NOT NULL) ORDER BY seq, id", contractId))
            a.add(m.valueToTree(r));
        return a.isEmpty() ? null : a;
    }

    int noteCount(int contractId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM contract_billing_term WHERE contract_id=? AND note IS NOT NULL", Integer.class, contractId);
    }

    /** 回滚事务里原样 PUT 一次,比 PUT 前后 GET。计费行 id 必变(整组删插),比时去掉 id。
     *  GET 不带 note:行备注的丢失另用库内计数报(noteLoss,非阻断,代价逐条列在 lostLineFields)。 */
    JsonNode identityCheck(String path, ObjectNode base, JsonNode d0, int id) {
        ObjectNode res = m.createObjectNode();
        ArrayNode blocking = res.putArray("blocking"), drift = res.putArray("cacheDrift");
        new TransactionTemplate(txm).executeWithoutResult(tx -> {
            try {
                int n0 = noteCount(id);
                R p = call("PUT", path, base);
                if (!p.ok()) { blocking.add("原样 PUT → http " + p.http() + " code " + p.code() + " " + p.msg()); return; }
                if (!p.data().path("warnings").isNull() && !p.data().path("warnings").isMissingNode())
                    blocking.add("原样 PUT 回包 warnings=" + p.data().path("warnings"));
                res.put("noteLoss", n0 - noteCount(id));
                JsonNode d1 = call("GET", path, null).data();
                Iterator<String> it = d0.path("contract").fieldNames();
                while (it.hasNext()) {
                    String f = it.next();
                    if (VOLATILE.contains(f)) continue;
                    JsonNode a = d0.path("contract").get(f), b = d1.path("contract").get(f);
                    if (!same(a, b)) (CACHE_FIELDS.contains(f) ? drift : blocking).add(f + ": " + a + " → " + b);
                }
                if (!same(d0.path("extraUnitIds"), d1.path("extraUnitIds")))
                    blocking.add("extraUnitIds: " + d0.path("extraUnitIds") + " → " + d1.path("extraUnitIds"));
                JsonNode l0 = d0.path("billingLines"), l1 = d1.path("billingLines");
                if (l0.size() != l1.size()) blocking.add("billingLines 行数 " + l0.size() + " → " + l1.size());
                else for (int i = 0; i < l0.size(); i++) {
                    Iterator<String> fi = l0.get(i).fieldNames();
                    while (fi.hasNext()) {
                        String f = fi.next();
                        if (f.equals("id")) continue;
                        if (!same(l0.get(i).get(f), l1.get(i).get(f)))
                            blocking.add("line#" + l0.get(i).path("id").asInt() + "." + f + ": " + l0.get(i).get(f) + " → " + l1.get(i).get(f));
                    }
                }
            } catch (Exception e) {
                blocking.add("exception: " + e);
            } finally {
                tx.setRollbackOnly();
            }
        });
        return res;
    }

    static String lineKey(JsonNode l) {
        return l.path("location").asText() + "|" + l.path("feeKey").asText() + "|" + n(l.get("area"));
    }

    /** 行引用 → 行 id:数字按 id(老变更集),文本按键 location|feeKey|area,须恰好 1 行。 */
    List<JsonNode> keyed(JsonNode d, String k) {
        List<JsonNode> out = new ArrayList<>();
        for (JsonNode l : d.path("billingLines")) if (lineKey(l).equals(k)) out.add(l);
        return out;
    }

    ArrayNode patchLines(Ctx c, JsonNode d0, JsonNode lines) {
        Set<Integer> have = new HashSet<>();
        for (JsonNode l : d0.path("billingLines")) have.add(l.path("id").asInt());
        Set<Integer> missing = new TreeSet<>();
        List<String> badKey = new ArrayList<>();
        Set<Integer> remove = new HashSet<>();
        Map<Integer, JsonNode> upd = new HashMap<>();
        List<JsonNode> refs = new ArrayList<>();
        lines.path("remove").forEach(refs::add);
        for (JsonNode u : lines.path("update")) refs.add(u.has("k") ? u.get("k") : u.get("id"));
        int nRemove = lines.path("remove").size();
        for (int i = 0; i < refs.size(); i++) {
            JsonNode r = refs.get(i);
            int id;
            if (r == null || r.isNull()) { badKey.add("update 项缺 k/id"); continue; }
            if (r.isNumber()) { id = r.asInt(); if (!have.contains(id)) { missing.add(id); continue; } }
            else {
                List<JsonNode> hit = keyed(d0, r.asText());
                if (hit.size() != 1) { badKey.add(r.asText() + " 命中 " + hit.size() + " 行"); continue; }
                id = hit.get(0).path("id").asInt();
            }
            if (remove.contains(id) || upd.containsKey(id)) { badKey.add("行 " + r + " 被引用两次"); continue; }
            if (i < nRemove) remove.add(id); else upd.put(id, lines.path("update").get(i - nRemove));
        }
        if (!missing.isEmpty()) { c.fail("计费行 id 在 GET 里找不到: " + missing); return null; }
        if (!badKey.isEmpty()) { c.fail("计费行键要恰好 1 行: " + badKey); return null; }

        ArrayNode bl = m.createArrayNode();
        Set<String> kept = new HashSet<>();
        for (JsonNode l : d0.path("billingLines")) {
            int lid = l.path("id").asInt();
            if (remove.contains(lid)) continue;
            ObjectNode r = lineReq(l);
            JsonNode u = upd.get(lid);
            if (u != null) {
                Iterator<Map.Entry<String, JsonNode>> it = u.fields();
                while (it.hasNext()) {
                    var e = it.next();
                    if (e.getKey().equals("id") || e.getKey().equals("k") || e.getKey().equals("feeName")) continue;
                    if (!LINE_FIELDS.contains(e.getKey())) { c.notes.add("update 键接口不收: " + e.getKey()); continue; }
                    r.set(e.getKey(), resolve(e.getValue()));
                }
            }
            kept.add(lineKey(r));
            bl.add(r);
        }
        // 只加行的操作重跑会重复插行(接口无重复行校验):目标行已在就停
        for (JsonNode a : lines.path("add")) {
            ObjectNode r = addLine(c, a);
            if (!kept.add(lineKey(r))) { c.fail("目标行已存在(疑已应用或重复): " + lineKey(r)); return null; }
            bl.add(r);
        }
        return bl;
    }

    ObjectNode addLine(Ctx c, JsonNode a) {
        ObjectNode r = m.createObjectNode();
        for (String f : LINE_FIELDS) r.set(f, f.equals("id") ? NullNode.instance : a.has(f) ? resolve(a.get(f)) : NullNode.instance);
        if (a.hasNonNull("note")) c.droppedNote++;
        if (a.hasNonNull("taxRate")) c.droppedTaxRate++;
        return r;
    }

    /** $占位符(建单元时 saveAs 的 id)递归替换;未解析的占位符直接报错。 */
    JsonNode resolve(JsonNode v) {
        if (v == null) return NullNode.instance;
        if (v.isTextual() && v.asText().startsWith("$")) {
            JsonNode rv = vars.get(v.asText());
            if (rv == null) throw new IllegalStateException("占位符未解析: " + v.asText());
            return rv;
        }
        if (v.isArray()) {
            ArrayNode a = m.createArrayNode();
            v.forEach(x -> a.add(resolve(x)));
            return a;
        }
        return v;
    }

    void applySet(Ctx c, ObjectNode body, JsonNode set) throws Exception {
        Iterator<Map.Entry<String, JsonNode>> it = set.fields();
        while (it.hasNext()) {
            var e = it.next();
            JsonNode v = resolve(e.getValue());
            // toWire:rentFree = JSON.stringify(数组) —— 紧凑格式
            if (e.getKey().equals("rentFree") && v.isTextual()) v = m.getNodeFactory().textNode(m.writeValueAsString(m.readTree(v.asText())));
            body.set(e.getKey(), v);
        }
    }

    /** append.{remark,termText}:接在运行时 GET 回来的现值后面(' | ' 分隔),不写字面量。 */
    boolean applyAppend(Ctx c, ObjectNode body, JsonNode append) {
        Iterator<Map.Entry<String, JsonNode>> it = append.fields();
        while (it.hasNext()) {
            var e = it.next();
            String cur = body.path(e.getKey()).asText("");
            String v = cur.isBlank() ? e.getValue().asText() : cur + " | " + e.getValue().asText();
            if (v.length() > 255) { c.fail(e.getKey() + " 追加后 " + v.length() + " 字 > 255"); return false; }
            body.put(e.getKey(), v);
        }
        return true;
    }

    /** 线上执行前拿它比:计费行 feeKey:area:unitPrice:areaShared 排序拼接 + rentArea + 起止。 */
    static String sig(JsonNode d) {
        List<String> ls = new ArrayList<>();
        for (JsonNode l : d.path("billingLines"))
            ls.add(l.path("feeKey").asText() + ":" + n(l.get("area")) + ":" + n(l.get("unitPrice")) + ":" + n(l.get("areaShared")));
        ls.sort(null);
        JsonNode ct = d.path("contract");
        return "lines=" + String.join(";", ls) + "|rentArea=" + n(ct.get("rentArea"))
            + "|start=" + txt(ct.get("startDate")) + "|end=" + txt(ct.get("endDate"));
    }

    /** 规范化全量快照:合同全部可写字段+链字段、附加单元、每行全部 LINE_FIELDS(去 id)+source+绑定;数值去尾零、行按内容排序。 */
    ObjectNode snapshot(JsonNode d) {
        ObjectNode s = m.createObjectNode();
        ObjectNode ct = s.putObject("contract");
        JsonNode c = d.path("contract");
        List<String> fs = new ArrayList<>(REQ_FIELDS);
        fs.addAll(List.of("parentContractId", "linkType", "kind"));
        for (String f : fs) ct.put(f, norm(c.get(f)));
        s.put("extraUnitIds", sortedIds(d.path("extraUnitIds")));
        List<String> ls = new ArrayList<>();
        for (JsonNode l : d.path("billingLines")) {
            StringBuilder b = new StringBuilder();
            for (String f : LINE_FIELDS) if (!f.equals("id") && !f.equals("unitIds")) b.append(f).append('=').append(norm(l.get(f))).append(';');
            b.append("source=").append(norm(l.get("source"))).append(";unitIds=").append(sortedIds(l.path("unitIds")));
            ls.add(b.toString());
        }
        ls.sort(null);
        ArrayNode a = s.putArray("lines");
        ls.forEach(a::add);
        return s;
    }

    static String sortedIds(JsonNode arr) {
        List<Integer> x = new ArrayList<>();
        arr.forEach(v -> x.add(v.asInt()));
        x.sort(null);
        return x.toString();
    }

    static String norm(JsonNode v) {
        BigDecimal b = num(v);
        return b != null ? b.stripTrailingZeros().toPlainString() : isNull(v) ? "-" : v.isTextual() ? v.asText() : v.toString();
    }

    static String n(JsonNode v) {
        BigDecimal b = num(v);
        return b == null ? (isNull(v) ? "-" : v.asText()) : b.stripTrailingZeros().toPlainString();
    }

    static String txt(JsonNode v) { return isNull(v) ? "-" : v.asText(); }

    // ─── 前置(硬门) / 期望核对 ─────────────────────────────────

    String storedStatus(int id) {
        return jdbc.queryForObject("SELECT status FROM contract WHERE id=?", String.class, id);
    }

    /** 硬门:pre 里能机核的键逐个比,任一不符返回 false(调用方不发写请求)。说明性键记 preUnchecked。 */
    boolean checkPre(Ctx c, JsonNode d0, int id) throws Exception {
        JsonNode pre = c.op.path("pre");
        boolean nested = pre.has("contract");
        comparePre(c, nested ? pre.get("contract") : pre, d0, id, "");
        if (nested) {
            Iterator<Map.Entry<String, JsonNode>> it = pre.fields();
            while (it.hasNext()) {
                var e = it.next();
                if (e.getKey().equals("contract") || e.getKey().equals("lines")) continue;
                Matcher mt = OTHER_CONTRACT.matcher(e.getKey());   // 例 "zbn23(474)":另一份合同的现值
                if (mt.matches() && e.getValue().isObject()) {
                    int oid = Integer.parseInt(mt.group(1));
                    R g = call("GET", "/api/contracts/" + oid, null);
                    if (!g.ok()) { c.preMismatch.add(e.getKey() + ": GET → " + g.code()); continue; }
                    comparePre(c, e.getValue(), g.data(), oid, e.getKey() + ".");
                } else c.preUnchecked.add(e.getKey());
            }
        }
        JsonNode pl = pre.path("lines");
        if (pl.isObject()) {
            Map<Integer, JsonNode> byId = new HashMap<>();
            for (JsonNode l : d0.path("billingLines")) byId.put(l.path("id").asInt(), l);
            Iterator<Map.Entry<String, JsonNode>> li = pl.fields();
            while (li.hasNext()) {
                var e = li.next();
                JsonNode l;
                if (e.getKey().matches("\\d+")) l = byId.get(Integer.parseInt(e.getKey()));
                else { List<JsonNode> hit = keyed(d0, e.getKey()); l = hit.size() == 1 ? hit.get(0) : null; }
                if (l == null) { c.preMismatch.add("line#" + e.getKey() + " 不存在或不唯一"); continue; }
                Iterator<Map.Entry<String, JsonNode>> fi = e.getValue().fields();
                while (fi.hasNext()) {
                    var f = fi.next();
                    if (!l.has(f.getKey())) { c.preUnchecked.add("line#" + e.getKey() + "." + f.getKey()); continue; }
                    if (!same(f.getValue(), l.get(f.getKey())))
                        c.preMismatch.add("line#" + e.getKey() + "." + f.getKey() + ": 期望 " + f.getValue() + " 实际 " + l.get(f.getKey()));
                }
            }
        }
        return c.preMismatch.isEmpty();
    }

    void comparePre(Ctx c, JsonNode pc, JsonNode d, int id, String prefix) {
        JsonNode ct = d.path("contract");
        Iterator<Map.Entry<String, JsonNode>> it = pc.fields();
        while (it.hasNext()) {
            var e = it.next();
            String k = e.getKey();
            JsonNode exp = e.getValue(), act;
            if (k.equals("lines")) continue;
            if (k.startsWith("status")) act = m.getNodeFactory().textNode(storedStatus(id));
            else if (k.equals("lineCount")) act = m.getNodeFactory().numberNode(d.path("billingLines").size());
            else if (k.equals("extraUnitIds")) act = d.path("extraUnitIds");
            else if (k.equals("lineIds")) {
                ArrayNode ids = m.createArrayNode();
                for (JsonNode l : d.path("billingLines")) ids.add(l.path("id").asInt());
                act = ids;
            } else if (k.equals("lineKeys")) {   // 行键多重集(行 id 会重编,phase2 起按键核)
                List<String> want = new ArrayList<>(), got = new ArrayList<>();
                exp.forEach(x -> want.add(x.asText()));
                d.path("billingLines").forEach(l -> got.add(lineKey(l)));
                want.sort(null); got.sort(null);
                if (!want.equals(got)) c.preMismatch.add(prefix + "lineKeys: 期望 " + want + " 实际 " + got);
                continue;
            } else if (ct.has(k)) act = ct.get(k);
            else { c.preUnchecked.add(prefix + k); continue; }   // 描述性键(中文说明等)
            if (!same(exp, act)) c.preMismatch.add(prefix + k + ": 期望 " + exp + " 实际 " + act);
        }
    }

    void checkExpect(Ctx c, JsonNode putResp, JsonNode after, int id) {
        JsonNode ct = after.path("contract");
        Iterator<Map.Entry<String, JsonNode>> it = c.op.path("expect").fields();
        while (it.hasNext()) {
            var e = it.next();
            String k = e.getKey();
            JsonNode exp = e.getValue(), act;
            if (exp.isTextual() && exp.asText().startsWith("$") && vars.containsKey(exp.asText())) exp = vars.get(exp.asText());
            if (k.equals("lineCount")) act = m.getNodeFactory().numberNode(after.path("billingLines").size());
            else if (k.equals("warnings")) act = putResp.path("warnings");
            else if (k.startsWith("status(")) act = m.getNodeFactory().textNode(storedStatus(id));
            else if (ct.has(k)) act = ct.get(k);
            else { c.expectUnchecked.add(k); continue; }
            if (!same(exp, act)) c.expectMismatch.add(k + ": 期望 " + exp + " 实际 " + act);
        }
        if (!c.expectMismatch.isEmpty()) c.fail("expect 不符: " + c.expectMismatch);
    }

    static boolean isNull(JsonNode v) {
        return v == null || v.isNull() || v.isMissingNode() || (v.isTextual() && v.asText().equals("null"));
    }

    static BigDecimal num(JsonNode v) {
        if (isNull(v)) return null;
        if (v.isNumber()) return v.decimalValue();
        if (!v.isTextual()) return null;
        String s = v.asText().trim();
        if (!s.matches("-?\\d+(\\.\\d+)?")) return null;
        return new BigDecimal(s);
    }

    /** 宽松相等:null 族互等;数值按大小比(不看标度);数组逐项(单元 id 类整数数组先排序);其余比文本。 */
    static boolean same(JsonNode a, JsonNode b) {
        if (isNull(a) || isNull(b)) return isNull(a) && isNull(b);
        if (a.isArray() || b.isArray()) {
            if (!a.isArray() || !b.isArray() || a.size() != b.size()) return false;
            List<JsonNode> x = new ArrayList<>(), y = new ArrayList<>();
            a.forEach(x::add); b.forEach(y::add);
            if (x.stream().allMatch(JsonNode::isNumber) && y.stream().allMatch(JsonNode::isNumber)) {
                x.sort((p, q) -> p.decimalValue().compareTo(q.decimalValue()));
                y.sort((p, q) -> p.decimalValue().compareTo(q.decimalValue()));
            }
            for (int i = 0; i < x.size(); i++) if (!same(x.get(i), y.get(i))) return false;
            return true;
        }
        if (a.isObject() || b.isObject()) return a.equals(b);
        BigDecimal p = num(a), q = num(b);
        if (p != null && q != null) return p.compareTo(q) == 0;
        return a.asText().equals(b.asText());
    }

    // ─── contract.renew ────────────────────────────────────────

    /** 续签/递增段:POST /api/contracts/{旧}/renew(contractNo/起止/linkType)→ PUT 新合同:set/append、按键改行,
     *  每行 unitIds 取旧合同同键行(续签接口不抄行绑定与附加单元),extraUnitIds 照抄旧合同。
     *  pre 核旧合同;旧合同已有后继就停(再续会分叉,链是严格单链)。新合同号已在:父指针须是旧合同,
     *  remark 含特征串判已应用,否则只补 PUT。expect 核新合同,另核 linkType、父指针、旧合同存储态
     *  (新一期已起租 → renewed,没起租 → 不变,2026-07-28 裁定);这三样不符就停在 PUT 之前。 */
    void renewContract(Ctx c) throws Exception {
        JsonNode t = c.op.path("target"), b = c.op.path("body");
        Integer oldId = contractId(c, t, "fromContractId", "fromContractNo");
        if (oldId == null) return;
        if (c.op.hasNonNull("requires")) c.preUnchecked.add("requires " + c.op.path("requires").asText() + "(runner 跑本分支代码,不核版本)");
        String no = t.path("contractNo").asText();
        Integer newId = null;
        List<Integer> kids = new ArrayList<>();
        for (JsonNode x : call("GET", "/api/contracts", null).data()) {
            if (no.equals(x.path("contractNo").asText())) newId = x.path("id").asInt();
            else if (x.path("parentContractId").asInt(-1) == oldId) kids.add(x.path("id").asInt());
        }
        R og = call("GET", "/api/contracts/" + oldId, null);
        if (!og.ok()) { c.fail("GET 旧合同 " + oldId + " → " + og.code() + " " + og.msg()); return; }
        JsonNode old = og.data();
        String mk = marker(c.op);
        if (newId != null) {
            JsonNode nc = call("GET", "/api/contracts/" + newId, null).data().path("contract");
            if (nc.path("parentContractId").asInt(-1) != oldId) { c.fail("合同号 " + no + " 已存在(id=" + newId + ")但父指针是 " + nc.path("parentContractId") + " 不是 " + oldId); return; }
            if (mk != null && nc.path("remark").asText("").contains(mk)) { c.applied("新合同已在且 remark 含特征串,判已应用,跳过: " + mk); return; }
            c.notes.add("新合同已在(id=" + newId + "),只补 PUT");
        } else {
            if (!kids.isEmpty()) c.preMismatch.add("旧合同 " + oldId + " 已有后继 " + kids + ",再续会分叉");
            if (!checkPre(c, old, oldId)) { c.fail("前置不符,未发请求"); return; }
            String oldBefore = storedStatus(oldId);
            ObjectNode rb = m.createObjectNode().put("contractNo", no);
            for (String f : List.of("startDate", "endDate", "signDate", "linkType")) rb.set(f, b.has(f) ? b.get(f) : NullNode.instance);
            String rp = "/api/contracts/" + oldId + "/renew";
            R p = call("POST", rp, rb);
            ObjectNode after = m.createObjectNode();
            after.set("old", call("GET", "/api/contracts/" + oldId, null).data());
            if (p.ok()) after.set("new", call("GET", "/api/contracts/" + p.data().path("id").asInt(), null).data());
            record(c, "POST", rp, rb, sig(old), snapshot(old), p, after, null);
            if (!p.ok()) { c.fail("POST " + rp + " → http " + p.http() + " code " + p.code() + " " + p.msg()); return; }
            newId = p.data().path("id").asInt();
            c.notes.add("新合同 id=" + newId);
            String wantLt = b.hasNonNull("linkType") ? b.path("linkType").asText() : "renew";
            if (!wantLt.equals(p.data().path("linkType").asText())) c.expectMismatch.add("linkType: 期望 " + wantLt + " 实际 " + p.data().path("linkType"));
            if (p.data().path("parentContractId").asInt(-1) != oldId) c.expectMismatch.add("parentContractId: 期望 " + oldId + " 实际 " + p.data().path("parentContractId"));
            String start = b.path("startDate").asText(null);
            String wantOld = start == null || !java.time.LocalDate.parse(start).isAfter(java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai")))
                ? "renewed" : oldBefore;
            if (!wantOld.equals(storedStatus(oldId))) c.expectMismatch.add("旧合同 status: 期望 " + wantOld + " 实际 " + storedStatus(oldId));
            if (!c.expectMismatch.isEmpty()) { c.fail("续签回包不符,没发 PUT: " + c.expectMismatch); return; }
        }
        String path = "/api/contracts/" + newId;
        JsonNode d0 = call("GET", path, null).data();
        ObjectNode body = fullReq(d0, true);
        applySet(c, body, c.op.path("set"));
        if (!applyAppend(c, body, c.op.path("append"))) return;
        ArrayNode bl = patchLines(c, d0, c.op.path("lines"));
        if (bl == null) return;
        Map<String, java.util.ArrayDeque<JsonNode>> binds = new HashMap<>();
        for (JsonNode l : old.path("billingLines"))
            binds.computeIfAbsent(lineKey(l), k -> new java.util.ArrayDeque<>()).add(l.path("unitIds").isArray() ? l.get("unitIds") : m.createArrayNode());
        for (JsonNode l : bl) {
            java.util.ArrayDeque<JsonNode> q = binds.get(lineKey(l));
            ((ObjectNode) l).set("unitIds", q == null || q.isEmpty() ? m.createArrayNode() : q.poll());
        }
        body.set("billingLines", bl);
        body.set("extraUnitIds", old.path("extraUnitIds").isArray() ? old.get("extraUnitIds") : m.createArrayNode());
        R pu = call("PUT", path, body);
        JsonNode after = call("GET", path, null).data();
        record(c, "PUT", path, body, sig(d0), snapshot(d0), pu, after, null);
        if (!pu.ok()) { c.fail("PUT " + path + " → http " + pu.http() + " code " + pu.code() + " " + pu.msg()); return; }
        checkExpect(c, pu.data(), after, newId);
    }

    // ─── contract.create / delete ──────────────────────────────

    void createContract(Ctx c) throws Exception {
        String no = c.op.path("target").path("contractNo").asText();
        R list = call("GET", "/api/contracts", null);
        for (JsonNode x : list.data())
            if (no.equals(x.path("contractNo").asText())) { c.applied("合同号已存在,判已应用,跳过: " + no + " id=" + x.path("id")); return; }
        ObjectNode body = m.createObjectNode();
        applySet(c, body, c.op.path("set"));
        if (!c.op.path("set").has("billingLines")) {
            ArrayNode add = m.createArrayNode();
            for (JsonNode a : c.op.path("lines").path("add")) add.add(addLine(c, a));
            body.set("billingLines", add.isEmpty() ? NullNode.instance : add);
        }
        R p = call("POST", "/api/contracts", body);
        JsonNode after = p.ok() ? call("GET", "/api/contracts/" + p.data().path("id").asInt(), null).data() : null;
        record(c, "POST", "/api/contracts", body, "absent:" + no, null, p, after, null);
        if (!p.ok()) { c.fail("POST → http " + p.http() + " code " + p.code() + " " + p.msg()); return; }
        c.notes.add("新合同 id=" + p.data().path("id").asInt());
        checkExpect(c, p.data(), after, p.data().path("id").asInt());
    }

    /** 删合同的硬门:tenantId 对、0 行、0 附加单元、没有 meter_assign 钉住、引用它的单全是 draft/void。 */
    void deleteContract(Ctx c) throws Exception {
        int id = c.op.path("target").path("contractId").asInt();
        String path = "/api/contracts/" + id;
        R g = call("GET", path, null);
        if (g.http() == 404 || g.code() == 404) { c.applied("合同已不存在,判已应用"); return; }
        if (!g.ok()) { c.fail("GET " + path + " → " + g.code() + " " + g.msg()); return; }
        JsonNode d = g.data();
        int tid = c.op.path("target").path("tenantId").asInt();
        if (d.path("contract").path("tenantId").asInt() != tid) c.preMismatch.add("tenantId: 期望 " + tid + " 实际 " + d.path("contract").path("tenantId"));
        if (!d.path("billingLines").isEmpty()) c.preMismatch.add("计费行 " + d.path("billingLines").size() + " 条");
        if (!d.path("extraUnitIds").isEmpty()) c.preMismatch.add("附加单元 " + d.path("extraUnitIds"));
        int pinned = jdbc.queryForObject("SELECT COUNT(*) FROM meter_assign WHERE contract_id=?", Integer.class, id);
        if (pinned > 0) c.preMismatch.add("meter_assign 钉住 " + pinned + " 行");
        List<Map<String, Object>> bills = jdbc.queryForList("SELECT b.status, COUNT(*) n FROM bill_notice_line l JOIN bill_notice b ON b.id=l.notice_id "
            + "WHERE l.contract_id=? GROUP BY b.status", id);
        c.notes.add("引用它的单行: " + bills);
        for (Map<String, Object> b : bills)
            if (!Set.of("draft", "void").contains(String.valueOf(b.get("status")))) c.preMismatch.add("被 " + b.get("status") + " 单引用 " + b.get("n") + " 行");
        if (!c.preMismatch.isEmpty()) { c.fail("前置不符,未发请求"); return; }
        R del = call("DELETE", path, null);
        R a = call("GET", path, null);
        record(c, "DELETE", path, null, sig(d), snapshot(d), del, a.body(), null);
        if (!del.ok()) c.fail("DELETE → http " + del.http() + " code " + del.code() + " " + del.msg());
    }

    // ─── tenant.patch / delete ─────────────────────────────────

    void patchTenant(Ctx c) throws Exception {
        String path = "/api/tenants/" + c.op.path("target").path("tenantId").asInt();
        R g = call("GET", path, null);
        if (!g.ok()) { c.fail("GET " + path + " → " + g.code() + " " + g.msg()); return; }
        JsonNode t = g.data().path("tenant");
        String marker = c.op.path("append").path("remark").asText(null);
        boolean aliasesDone = !c.op.path("set").has("aliases") || same(c.op.path("set").path("aliases"), t.path("aliases"));
        if (aliasesDone && (marker == null || t.path("remark").asText("").contains(marker))) { c.applied("别名与备注已是目标值,跳过"); return; }
        Iterator<Map.Entry<String, JsonNode>> pi = c.op.path("pre").fields();
        while (pi.hasNext()) {
            var e = pi.next();
            if (!same(e.getValue(), t.path(e.getKey()))) c.preMismatch.add(e.getKey() + ": 期望 " + e.getValue() + " 实际 " + t.path(e.getKey()));
        }
        if (!c.preMismatch.isEmpty()) { c.fail("前置不符,未发请求"); return; }
        ObjectNode body = m.createObjectNode();
        for (String f : List.of("companyName", "businessType", "contactName", "contactPhone", "categoryId", "parentId",
                "phase", "since", "remark", "status", "aliases"))
            body.set(f, t.has(f) ? t.get(f) : NullNode.instance);
        applySet(c, body, c.op.path("set"));
        if (!applyAppend(c, body, c.op.path("append"))) return;
        R p = call("PUT", path, body);
        JsonNode after = call("GET", path, null).data();
        record(c, "PUT", path, body, "tenant:" + t.path("companyName").asText() + "|aliases=" + txt(t.get("aliases")), t, p, after, null);
        if (!p.ok()) c.fail("PUT → http " + p.http() + " code " + p.code() + " " + p.msg());
    }

    /** 删租户的硬门:引用它的各表逐个计数,非 0 就停(TenantService.delete 会把 s10/recon 置空、级联删映射与备注覆盖)。 */
    void deleteTenant(Ctx c) throws Exception {
        int tid = c.op.path("target").path("tenantId").asInt();
        String path = "/api/tenants/" + tid;
        R g = call("GET", path, null);
        if (g.http() == 404 || g.code() == 404) { c.applied("租户已不存在,判已应用"); return; }
        if (!g.ok()) { c.fail("GET " + path + " → " + g.code() + " " + g.msg()); return; }
        Map<String, Integer> refs = new LinkedHashMap<>();
        for (String tb : TENANT_REF_TABLES)
            refs.put(tb, jdbc.queryForObject("SELECT COUNT(*) FROM " + tb + " WHERE tenant_id=?", Integer.class, tid));
        refs.put("tenant(parent_id)", jdbc.queryForObject("SELECT COUNT(*) FROM tenant WHERE parent_id=?", Integer.class, tid));
        c.notes.add("引用计数: " + refs);
        refs.forEach((k, v) -> { if (v > 0) c.preMismatch.add(k + " 还有 " + v + " 行"); });
        if (!c.preMismatch.isEmpty()) { c.fail("前置不符,未发请求"); return; }
        R d = call("DELETE", path, null);
        record(c, "DELETE", path, null, "tenant:" + g.data().path("tenant").path("companyName").asText(), g.data(), d, call("GET", path, null).body(), null);
        if (!d.ok()) c.fail("DELETE → http " + d.http() + " code " + d.code() + " " + d.msg());
    }

    // ─── meter.assign ─────────────────────────────────────────

    void meterAssign(Ctx c) throws Exception {
        JsonNode body = c.op.path("body");
        int row = c.op.path("target").path("assignRowId").asInt();
        JsonNode pre = c.op.path("pre").path("meter_assign#" + row);
        Map<String, Object> cur = jdbc.queryForMap("SELECT meter_id, from_ym, tenant_id FROM meter_assign WHERE id=?", row);
        int want = body.path("patch").path("tenantId").asInt();
        if (((Number) cur.get("tenant_id")).intValue() == want) { c.applied("meter_assign#" + row + " 已挂 " + want); return; }
        if (((Number) cur.get("meter_id")).intValue() != pre.path("meterId").asInt()
            || !pre.path("fromYm").asText().equals(cur.get("from_ym")) || ((Number) cur.get("tenant_id")).intValue() != pre.path("tenantId").asInt()) {
            c.preMismatch.add("meter_assign#" + row + ": 期望 " + pre + " 实际 " + cur);
            c.fail("前置不符,未发请求");
            return;
        }
        R r = call("PUT", "/api/meters/assign", body);
        record(c, "PUT", "/api/meters/assign", body, "meter_assign#" + row + "=" + cur, null, r,
            m.valueToTree(jdbc.queryForMap("SELECT meter_id, from_ym, tenant_id, tenant_name FROM meter_assign WHERE id=?", row)), null);
        if (!r.ok()) c.fail("PUT → http " + r.http() + " code " + r.code() + " " + r.msg());
    }

    // ─── other:建单元 / 收款映射 / 重生成 ──────────────────────

    void other(Ctx c) throws Exception {
        JsonNode body = c.op.path("body");
        String path = body.path("path").asText();
        if (body.has("calls")) { regenerate(c); return; }
        if (path.equals("/api/bills/paymap")) { paymap(c); return; }
        if (path.matches("/api/buildings/\\d+/units")) { createUnit(c); return; }
        c.fail("不认识的 other: " + body);
    }

    void createUnit(Ctx c) throws Exception {
        JsonNode body = c.op.path("body");
        String path = body.path("path").asText();
        String saveAs = c.op.path("target").path("saveAs").asText();
        R p = call("POST", path, body.path("json"));
        record(c, "POST", path, body.path("json"), null, null, p, null, null);
        if (p.ok()) { vars.put(saveAs, p.data().path("id")); c.notes.add(saveAs + "=" + p.data().path("id")); return; }
        if (p.code() != 409) { c.fail("POST → http " + p.http() + " code " + p.code() + " " + p.msg()); return; }
        // 已存在:取已有单元 id,不重建
        String bpath = path.substring(0, path.lastIndexOf("/units"));
        for (JsonNode u : call("GET", bpath, null).data().path("units"))
            if (u.path("floor").asInt() == body.path("json").path("floor").asInt()
                && u.path("unitNo").asText().equals(body.path("json").path("unitNo").asText())) {
                vars.put(saveAs, u.path("id"));
                c.applied("单元已存在,沿用 " + saveAs + "=" + u.path("id"));
                return;
            }
        c.fail("409 但找不到已有单元: " + p.msg());
    }

    /** upsert 接口:默认不覆盖已有值(脚本 ON DUPLICATE KEY 保留旧值);带 overwrite.expectCompanyId 的只在现值等于它时改。 */
    void paymap(Ctx c) throws Exception {
        JsonNode j = c.op.path("body").path("json");
        int tid = j.path("tenantId").asInt();
        String fk = j.path("feeKey").asText();
        int want = j.path("companyId").asInt();
        JsonNode cur = findPaymap(tid, fk);
        JsonNode ow = c.op.path("overwrite");
        if (cur != null) {
            int have = cur.path("companyId").asInt();
            if (have == want) { c.applied("(" + tid + "," + fk + ") 已是 " + want); return; }
            if (ow.isMissingNode()) {
                c.status = "skipped";
                c.notes.add("(" + tid + "," + fk + ") 已存在 companyId=" + have + ",不覆盖");
                return;
            }
            if (have != ow.path("expectCompanyId").asInt()) {
                c.preMismatch.add("(" + tid + "," + fk + ") 期望现值 " + ow.path("expectCompanyId") + " 实际 " + have);
                c.fail("前置不符,未发请求");
                return;
            }
        } else if (!ow.isMissingNode()) {
            c.preMismatch.add("(" + tid + "," + fk + ") 期望现值 " + ow.path("expectCompanyId") + " 实际不存在");
            c.fail("前置不符,未发请求");
            return;
        }
        R p = call("PUT", "/api/bills/paymap", j);
        JsonNode now = findPaymap(tid, fk);
        record(c, "PUT", "/api/bills/paymap", j, "paymap:(" + tid + "," + fk + ")=" + (cur == null ? "absent" : cur.path("companyId").asText()),
            cur, p, now, null);
        if (!p.ok()) c.fail("PUT → http " + p.http() + " code " + p.code() + " " + p.msg());
        else if (now == null || now.path("companyId").asInt() != want) c.fail("写后 GET 不是 " + want + ": " + now);
    }

    JsonNode findPaymap(int tid, String fk) throws Exception {
        for (JsonNode x : call("GET", "/api/bills/paymap", null).data())
            if (x.path("tenantId").asInt() == tid && fk.equals(x.path("feeKey").asText())) return x;
        return null;
    }

    /** 重生成:月份 = target.ym ∪ 待删租户有单的月(逐月只读 GET 查,不做全量重生成);先导出这些月的通知单基线(R19);
     *  任何一个月失败立刻停(后面的删租户随 stopOnFail 不跑)。 */
    void regenerate(Ctx c) throws Exception {
        Set<String> months = new TreeSet<>();
        c.op.path("target").path("ym").forEach(x -> months.add(x.asText()));
        Set<Integer> gone = new HashSet<>();   // 本文件里要删的租户:它们的单必须在重生成后挪走
        for (JsonNode o : currentOps)
            if (o.path("op").asText().equals("tenant.delete")) gone.add(o.path("target").path("tenantId").asInt());
        R ms = call("GET", "/api/bill-notices/months", null);
        for (JsonNode x : ms.data()) {
            R l = call("GET", "/api/bill-notices?ym=" + x.asText(), null);
            for (JsonNode n : l.data()) if (gone.contains(n.path("tenantId").asInt())) {
                months.add(x.asText());
                c.notes.add(x.asText() + " 有待删租户 " + n.path("tenantId") + " 的单 status=" + n.path("status").asText());
            }
        }
        c.notes.add("重生成月份: " + months);
        for (String ym : months) {
            R l = call("GET", "/api/bill-notices?ym=" + ym, null);
            record(c, "GET", "/api/bill-notices?ym=" + ym, null, null, null, l, null, "baseline");
        }
        for (String ym : months) {
            for (String p : List.of("/api/alloc/generate?ym=" + ym, "/api/bill-notices/generate?ym=" + ym)) {
                R r = call("POST", p, null);
                record(c, "POST", p, null, null, null, r, null, null);
                if (!r.ok()) { c.fail("POST " + p + " → http " + r.http() + " code " + r.code() + " " + r.msg() + "(整体停止)"); return; }
            }
        }
    }
}
