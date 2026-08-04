package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 表→合同绑定(S2-BIND-SPEC §5):五级规则/分桶/pending·placeholder/bind 写解绑/auto-link 幂等/usage-summary。
// @Transactional 回滚;2099 远期槽自造家族+合同+表,探针断言(按自建 id 过滤),无顺序依赖。
// meter 表无种子数据 → summary 计数即本用例自建数据,可精确断言。
@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class MeterBindingApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        token = JsonPath.read(body, "$.data.token");
    }

    private String auth() { return "Bearer " + token; }

    // ── helpers:自造数据 ──

    private int createTenant(String name, Integer parentId) throws Exception {
        String body = "{\"companyName\":\"" + name + "\",\"businessType\":\"电子信息\""
                + (parentId == null ? "" : ",\"parentId\":" + parentId) + "}";
        String res = mvc.perform(post("/api/tenants").header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        return JsonPath.read(res, "$.data.id");
    }

    private int createContract(int tenantId, int buildingId, String start, String end) throws Exception {
        StringBuilder sb = new StringBuilder("{\"contractNo\":\"IT-S2-").append(System.nanoTime()).append("\",");
        sb.append("\"tenantId\":").append(tenantId).append(",\"buildingId\":").append(buildingId).append(",");
        if (start != null) sb.append("\"startDate\":\"").append(start).append("\",");
        if (end != null) sb.append("\"endDate\":\"").append(end).append("\",");
        sb.append("\"rentArea\":100,\"monthlyRent\":1000,\"deposit\":0,\"status\":\"active\"}");
        String res = mvc.perform(post("/api/contracts").header("Authorization", auth())
                .contentType("application/json").content(sb.toString()))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        return JsonPath.read(res, "$.data.id");
    }

    /** ownership=tenant 的表;tenantId/buildingId/tenantName 可空 */
    private int createMeter(String kind, String name, Integer tenantId, Integer buildingId, String tenantName)
            throws Exception {
        return createMeterRaw(kind, name, tenantId, buildingId, tenantName, "tenant");
    }

    private int createMeterRaw(String kind, String name, Integer tenantId, Integer buildingId,
                               String tenantName, String ownership) throws Exception {
        StringBuilder sb = new StringBuilder("{\"kind\":\"").append(kind)
                .append("\",\"zone\":\"p1\",\"name\":\"").append(name)
                .append("\",\"ownership\":\"").append(ownership).append("\"");
        if (tenantId != null) sb.append(",\"tenantId\":").append(tenantId);
        if (buildingId != null) sb.append(",\"buildingId\":").append(buildingId);
        if (tenantName != null) sb.append(",\"tenantName\":\"").append(tenantName).append("\"");
        sb.append("}");
        String res = mvc.perform(post("/api/meters").header("Authorization", auth())
                .contentType("application/json").content(sb.toString()))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        return JsonPath.read(res, "$.data.id");
    }

    private void createReading(int meterId, String ym, String prev, String curr, String extra) throws Exception {
        StringBuilder sb = new StringBuilder("{\"meterId\":").append(meterId).append(",\"ym\":\"").append(ym).append("\"");
        if (prev != null) sb.append(",\"prevTotal\":").append(prev);
        if (curr != null) sb.append(",\"currTotal\":").append(curr);
        if (extra != null) sb.append(",").append(extra);
        sb.append("}");
        mvc.perform(post("/api/meters/readings").header("Authorization", auth())
                .contentType("application/json").content(sb.toString()))
                .andExpect(jsonPath("$.code").value(0));
    }

    private List<Integer> buildingIds() throws Exception {
        String body = mvc.perform(get("/api/buildings").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        return JsonPath.read(body, "$.data[*].id");
    }

    private String binding(String ym) throws Exception {
        return mvc.perform(get("/api/meters/binding").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
    }

    private Map<String, Object> row(String body, int meterId) {
        List<Map<String, Object>> rows = JsonPath.read(body, "$.data.rows[?(@.meterId==" + meterId + ")]");
        assertThat(rows).hasSize(1);
        return rows.get(0);
    }

    private void bind(int meterId, String contractIdJson) throws Exception {
        mvc.perform(put("/api/meters/" + meterId + "/bind").header("Authorization", auth())
                .contentType("application/json").content("{\"contractId\":" + contractIdJson + "}"))
                .andExpect(jsonPath("$.code").value(0));
    }

    // ── 家族放宽命中(子户合同+根户表)/override 优先/stale 警示/bind 写与解绑 ──
    @Test
    void familyAuto_overridePriority_staleWarn_bindUnbind() throws Exception {
        // ⚠missingReadings 是全库计数(种子表亦入账) → 断增量,不断绝对值
        int missing0 = JsonPath.read(binding("2099-08"), "$.data.summary.missingReadings");

        int root = createTenant("IT绑定根户", null);
        int child = createTenant("IT绑定子户", root);
        int b1 = buildingIds().get(0);
        int cid = createContract(child, b1, "2099-08-01", "2099-08-31");   // 合同挂子户
        int mid = createMeter("elec", "IT绑家族表", root, b1, "IT绑定根户"); // 表挂根户

        // 家族放宽:候选唯一 → auto;无读数 → hasReading=false,漏抄计 1
        String body = binding("2099-08");
        Map<String, Object> r = row(body, mid);
        assertThat(r.get("status")).isEqualTo("auto");
        assertThat(r.get("contractId")).isEqualTo(cid);
        assertThat(r.get("contractNo")).asString().startsWith("IT-S2-");
        assertThat(r.get("hasReading")).isEqualTo(false);
        assertThat((int) JsonPath.read(body, "$.data.summary.auto")).isEqualTo(1);
        assertThat((int) JsonPath.read(body, "$.data.summary.missingReadings") - missing0).isEqualTo(1);

        // 人工绑定 → override 优先于自动归属
        bind(mid, String.valueOf(cid));
        body = binding("2099-08");
        assertThat(row(body, mid).get("status")).isEqualTo("override");
        assertThat((int) JsonPath.read(body, "$.data.summary.override")).isEqualTo(1);

        // 不覆盖月:仍采用但标 override_stale,不静默失效
        body = binding("2099-01");
        r = row(body, mid);
        assertThat(r.get("status")).isEqualTo("override_stale");
        assertThat(r.get("contractId")).isEqualTo(cid);
        assertThat((int) JsonPath.read(body, "$.data.summary.overrideStale")).isEqualTo(1);

        // 解绑 → 回自动归属
        bind(mid, "null");
        assertThat(row(binding("2099-08"), mid).get("status")).isEqualTo("auto");

        // 守卫:合同不存在 404;表不存在 404
        mvc.perform(put("/api/meters/" + mid + "/bind").header("Authorization", auth())
                .contentType("application/json").content("{\"contractId\":99999999}"))
                .andExpect(jsonPath("$.code").value(404));
        mvc.perform(put("/api/meters/99999999/bind").header("Authorization", auth())
                .contentType("application/json").content("{\"contractId\":null}"))
                .andExpect(jsonPath("$.code").value(404));
    }

    // ── manual 分桶:date_missing(候选一键确认)/no_contract/auto_bld 对位唯一/bld_mismatch/ambiguous ──
    @Test
    void manualBuckets_autoBld_dateMissingConfirm() throws Exception {
        List<Integer> bids = buildingIds();
        int b1 = bids.get(0), b2 = bids.get(1);

        // date_missing:家族有合同但缺起止日期(不静默兜底,候选给出供一键确认)
        int t1 = createTenant("IT绑缺日期户", null);
        int c1 = createContract(t1, b1, null, null);
        int m1 = createMeter("elec", "IT绑缺日期表", t1, b1, "IT绑缺日期户");
        // no_contract:家族无合同
        int t2 = createTenant("IT绑无合同户", null);
        int m2 = createMeter("elec", "IT绑无合同表", t2, b1, "IT绑无合同户");
        // 多合同分居两栋:对位唯一 → auto_bld;表无楼栋 → 对位落空 bld_mismatch
        int t3 = createTenant("IT绑对位户", null);
        int c31 = createContract(t3, b1, "2099-08-01", "2100-12-31");
        createContract(t3, b2, "2099-08-01", "2100-12-31");
        int m3 = createMeter("elec", "IT绑对位表", t3, b1, "IT绑对位户");
        int m4 = createMeter("elec", "IT绑错位表", t3, null, "IT绑对位户");
        // 两合同同栋:对位后仍多条 → ambiguous
        int t4 = createTenant("IT绑多义户", null);
        createContract(t4, b1, "2099-08-01", "2100-12-31");
        createContract(t4, b1, "2099-08-01", "2100-12-31");
        int m5 = createMeter("elec", "IT绑多义表", t4, b1, "IT绑多义户");
        // 规则4修订(2026-08-04 仁恒形态):别栋在租×2 → 对位落空,但本栋有缺日期合同 →
        // date_missing+本栋候选(唯一→一键确认),不再被错栋在租合同遮蔽成 bld_mismatch
        int b3 = bids.get(2);
        int t6 = createTenant("IT仁恒形态户", null);
        createContract(t6, b1, "2099-08-01", "2100-12-31");
        createContract(t6, b2, "2099-08-01", "2100-12-31");
        // c6 带费项行:候选/绑定要显示「费项名·位置(含单元)」(2026-08-04 用户要求)
        String c6res = mvc.perform(post("/api/contracts").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"contractNo\":\"IT-S2-LOC1\",\"tenantId\":" + t6 + ",\"buildingId\":" + b3
                        + ",\"rentArea\":40,\"monthlyRent\":760,\"deposit\":0,\"status\":\"active\","
                        + "\"billingLines\":[{\"propertyType\":\"dorm\",\"location\":\"宿舍X座503室\","
                        + "\"feeKey\":\"rent_dorm\",\"area\":40,\"unitPrice\":19}]}"))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        int c6 = JsonPath.read(c6res, "$.data.id");
        int m6 = createMeter("water", "IT仁恒宿舍水", t6, b3, "IT仁恒形态户");

        String body = binding("2099-08");
        Map<String, Object> r1 = row(body, m1);
        assertThat(r1.get("status")).isEqualTo("manual");
        assertThat(r1.get("bucket")).isEqualTo("date_missing");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> cands = (List<Map<String, Object>>) r1.get("candidates");
        assertThat(cands).hasSize(1);   // 候选唯一 → UI 一键确认
        assertThat(cands.get(0).get("contractId")).isEqualTo(c1);
        assertThat(cands.get(0).get("buildingName")).isNotNull();

        Map<String, Object> r2 = row(body, m2);
        assertThat(r2.get("bucket")).isEqualTo("no_contract");
        assertThat((List<?>) r2.get("candidates")).isEmpty();

        Map<String, Object> r3 = row(body, m3);
        assertThat(r3.get("status")).isEqualTo("auto_bld");
        assertThat(r3.get("contractId")).isEqualTo(c31);

        Map<String, Object> r4 = row(body, m4);
        assertThat(r4.get("bucket")).isEqualTo("bld_mismatch");
        assertThat((List<?>) r4.get("candidates")).hasSize(2);   // 落空仍给全部候选供人工选

        assertThat(row(body, m5).get("bucket")).isEqualTo("ambiguous");

        Map<String, Object> r6 = row(body, m6);
        assertThat(r6.get("status")).isEqualTo("manual");
        assertThat(r6.get("bucket")).isEqualTo("date_missing");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> cands6 = (List<Map<String, Object>>) r6.get("candidates");
        assertThat(cands6).hasSize(1);   // 本栋缺日期合同浮出,错栋在租合同不再冒充候选
        assertThat(cands6.get(0).get("contractId")).isEqualTo(c6);
        // 费项位置标签:费项名去「租金」尾·位置原文(含单元)
        @SuppressWarnings("unchecked")
        List<String> locs6 = (List<String>) cands6.get(0).get("locations");
        assertThat(locs6).containsExactly("宿舍·宿舍X座503室");

        assertThat((int) JsonPath.read(body, "$.data.summary.autoBld")).isEqualTo(1);
        assertThat((int) JsonPath.read(body, "$.data.summary.auto")).isEqualTo(0);
        assertThat((int) JsonPath.read(body, "$.data.summary.manual.date_missing")).isEqualTo(2);
        assertThat((int) JsonPath.read(body, "$.data.summary.manual.no_contract")).isEqualTo(1);
        assertThat((int) JsonPath.read(body, "$.data.summary.manual.bld_mismatch")).isEqualTo(1);
        assertThat((int) JsonPath.read(body, "$.data.summary.manual.ambiguous")).isEqualTo(1);

        // date_missing 一键确认=写 override(缺日期无法断言覆盖,不标 stale)
        bind(m1, String.valueOf(c1));
        assertThat(row(binding("2099-08"), m1).get("status")).isEqualTo("override");
        // 绑定后 Row 也带费项位置标签
        bind(m6, String.valueOf(c6));
        @SuppressWarnings("unchecked")
        List<String> rowLocs6 = (List<String>) row(binding("2099-08"), m6).get("locations");
        assertThat(rowLocs6).containsExactly("宿舍·宿舍X座503室");
    }

    // ── pending/placeholder 分类 + auto-link-by-name 幂等;非 tenant 表不参与 ──
    @Test
    void pendingPlaceholder_autoLinkByName_idempotent() throws Exception {
        // ⚠summary.* 是全库计数,V65/V66 种子亦入账 → 只断言增量,不断言绝对值(共享容器铁律)
        String base = binding("2099-08");
        int pending0 = JsonPath.read(base, "$.data.summary.pending");
        int placeholder0 = JsonPath.read(base, "$.data.summary.placeholder");

        int tid = createTenant("IT绑名称精确公司", null);
        int p1 = createMeter("elec", "IT绑待核表", null, null, "IT绑名称精确公司");   // 精确唯一可挂
        int p2 = createMeter("elec", "IT绑待核无档", null, null, "IT绑无此公司");     // 无匹配
        int h1 = createMeter("elec", "IT绑占位横杠", null, null, "-");
        int h2 = createMeter("elec", "IT绑占位空括", null, null, "（空）");
        int h3 = createMeter("elec", "IT绑占位停用", null, null, "已停用");
        int h4 = createMeter("elec", "IT绑占位无名", null, null, null);
        int s1 = createMeterRaw("elec", "IT绑公摊表", null, null, null, "share");    // 非 tenant 不参与

        String body = binding("2099-08");
        assertThat((int) JsonPath.read(body, "$.data.summary.pending") - pending0).isEqualTo(2);
        assertThat((int) JsonPath.read(body, "$.data.summary.placeholder") - placeholder0).isEqualTo(4);
        assertThat(row(body, p1).get("status")).isEqualTo("pending");
        assertThat(row(body, h1).get("status")).isEqualTo("placeholder");
        assertThat(row(body, h2).get("status")).isEqualTo("placeholder");
        assertThat(row(body, h3).get("status")).isEqualTo("placeholder");
        assertThat(row(body, h4).get("status")).isEqualTo("placeholder");
        assertThat((List<?>) JsonPath.read(body, "$.data.rows[?(@.meterId==" + s1 + ")]")).isEmpty();

        // 首跑:1 挂上(p1),1 跳过(p2);占位表不参与
        mvc.perform(post("/api/meters/auto-link-by-name").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.linked").value(1))
                .andExpect(jsonPath("$.data.skipped").value(1));
        // p1 已挂 tenant_id → 不再 pending(该户无合同 → manual/no_contract);档案可见 tenantId
        body = binding("2099-08");
        assertThat((int) JsonPath.read(body, "$.data.summary.pending") - pending0).isEqualTo(1);
        Map<String, Object> r = row(body, p1);
        assertThat(r.get("status")).isEqualTo("manual");
        assertThat(r.get("bucket")).isEqualTo("no_contract");
        mvc.perform(get("/api/meters").param("kind", "elec").param("zone", "p1").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.name=='IT绑待核表')].tenantId").value(tid));
        // 幂等:重跑不重复挂
        mvc.perform(post("/api/meters/auto-link-by-name").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.linked").value(0))
                .andExpect(jsonPath("$.data.skipped").value(1));
    }

    // ── usage-summary:户×kind 聚合/分时段/漏抄计数;未挂租户的表不计入;binding.hasReading 联动 ──
    @Test
    void usageSummary_aggregation_missingCount() throws Exception {
        int u = createTenant("IT绑用量户", null);
        // ⚠全库计数基线(V65/V66 种子表无 2099 读数,恒计漏抄) → 断增量
        int missing0 = JsonPath.read(binding("2099-09"), "$.data.summary.missingReadings");
        int rows0 = JsonPath.read(mvc.perform(get("/api/meters/usage-summary").param("ym", "2099-09")
                .header("Authorization", auth())).andReturn().getResponse()
                .getContentAsString(java.nio.charset.StandardCharsets.UTF_8), "$.data.length()");

        int e1 = createMeter("elec", "IT绑用量电1", u, null, "IT绑用量户");
        createMeter("elec", "IT绑用量电2", u, null, "IT绑用量户");            // 无读数 → 漏抄
        int w1 = createMeter("water", "IT绑用量水", u, null, "IT绑用量户");
        int orphan = createMeter("elec", "IT绑用量游离", null, null, "IT绑游离公司");   // 未挂租户不计入
        createReading(e1, "2099-09", "0", "100", "\"prevSharp\":0,\"currSharp\":40");
        createReading(w1, "2099-09", "10", "30", null);
        createReading(orphan, "2099-09", "0", "999", null);

        String body = mvc.perform(get("/api/meters/usage-summary").param("ym", "2099-09")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat((int) JsonPath.read(body, "$.data.length()") - rows0).isEqualTo(2);   // 本用例新增两行(电/水)

        List<Map<String, Object>> elec = JsonPath.read(body,
                "$.data[?(@.tenantId==" + u + " && @.kind=='elec')]");
        assertThat(elec).hasSize(1);
        assertThat(elec.get(0).get("tenantName")).isEqualTo("IT绑用量户");
        assertThat(elec.get(0).get("meterCount")).isEqualTo(2);
        assertThat(elec.get(0).get("missingReadings")).isEqualTo(1);
        assertThat(((Number) elec.get(0).get("usageTotal")).doubleValue()).isEqualTo(100.0);
        assertThat(((Number) elec.get(0).get("usageSharp")).doubleValue()).isEqualTo(40.0);
        assertThat(elec.get(0).get("usagePeak")).isNull();   // 未抄时段不硬算

        List<Map<String, Object>> water = JsonPath.read(body,
                "$.data[?(@.tenantId==" + u + " && @.kind=='water')]");
        assertThat(water.get(0).get("meterCount")).isEqualTo(1);
        assertThat(water.get(0).get("missingReadings")).isEqualTo(0);
        assertThat(((Number) water.get(0).get("usageTotal")).doubleValue()).isEqualTo(20.0);

        // binding 联动:有读数表 hasReading=true;漏抄数=该月无可派生用量的租户表(仅电2)
        String bBody = binding("2099-09");
        assertThat(row(bBody, e1).get("hasReading")).isEqualTo(true);
        assertThat((int) JsonPath.read(bBody, "$.data.summary.missingReadings") - missing0).isEqualTo(1);
    }

    // ── suspect='shadow'(疑似重复建档)排除:binding 无行、usage-summary 只算非 shadow 表(同 AllocService 口径) ──
    @Test
    void shadowMeter_excludedFromBindingAndUsage() throws Exception {
        int t = createTenant("IT绑影子户", null);
        int real = createMeter("elec", "IT影子真表", t, null, "IT绑影子户");
        int shadow = createMeter("elec", "IT影子重复表", t, null, "IT绑影子户");
        createReading(real, "2093-06", "0", "100", null);
        createReading(shadow, "2093-06", "0", "77", null);
        // PUT 全量打标(MeterReq.suspect 三态,显式传 shadow)
        mvc.perform(put("/api/meters/" + shadow).header("Authorization", auth())
                .contentType("application/json")
                .content("{\"kind\":\"elec\",\"zone\":\"p1\",\"name\":\"IT影子重复表\",\"ownership\":\"tenant\","
                        + "\"tenantId\":" + t + ",\"tenantName\":\"IT绑影子户\",\"suspect\":\"shadow\"}"))
                .andExpect(jsonPath("$.code").value(0));

        // binding:shadow 表不出行,真表照常
        String body = binding("2093-06");
        assertThat((List<?>) JsonPath.read(body, "$.data.rows[?(@.meterId==" + shadow + ")]")).isEmpty();
        assertThat(row(body, real).get("hasReading")).isEqualTo(true);

        // usage-summary:该户电用量只算真表(100),meterCount=1
        String uBody = mvc.perform(get("/api/meters/usage-summary").param("ym", "2093-06")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        List<Map<String, Object>> elec = JsonPath.read(uBody,
                "$.data[?(@.tenantId==" + t + " && @.kind=='elec')]");
        assertThat(elec).hasSize(1);
        assertThat(elec.get(0).get("meterCount")).isEqualTo(1);
        assertThat(((Number) elec.get(0).get("usageTotal")).doubleValue()).isEqualTo(100.0);
    }
}
