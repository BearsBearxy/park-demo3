package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 催缴单派生引擎(S4-BILL-NOTICE-SPEC §4/§5 + BILL-DERIVE-SPEC §2):判定树分支/取价审计链/
// 容量费按天折/paymap 拆单/宿舍段拆 dorm 单/幂等与 issued 跳过/offbook/负用量/未归属降级/读数批删 409 守卫。
// @Transactional 回滚;月份槽独占 2090-01..2090-12 + 2091-03/04/05 + 2092-02..2092-06(S13 损耗base形态;
// 月份无 13/14,租金用例 t13/t14 顺延;2091-01=AllocApiIT、2091-02=AllocPoolContributionsIT、
// 2092-01/2092-12=ContractFullImportApiIT 已占)+ 2093-02(S15 拆场地比例剔宿舍行)+ 2093-05(S20 交付状态流;
// 2093-01=AllocPoolContributionsIT 已占),每用例一槽(generate 先删本 ym 全部 draft,共槽互删);
// 断言只圈自建数据(种子合同 2028 年前到期、种子表无 2090 读数,槽内 generated 计数=本用例数据,可精确断言)。
// is_dorm_room/offbook 系 V89 新列,实体未必已挂字段 → 直落 JDBC(同事务同连接,引擎 mapper 读得到)。
// 公摊行用例刻意不做:贡献一致性归 AllocPoolContributionsIT,引擎侧集成留 S4-3 真数月验收。
@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class BillNoticeApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
    }

    private String auth() { return "Bearer " + token; }

    // ── helpers:自建数据 ──

    private String postOk(String url, String body) throws Exception {
        return new String(mvc.perform(post(url).header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private int postId(String url, String body) throws Exception {
        return JsonPath.read(postOk(url, body), "$.data.id");
    }

    private int createTenant(String name) throws Exception {
        return postId("/api/tenants", "{\"companyName\":\"" + name + "\",\"businessType\":\"IT\"}");
    }

    private int building() throws Exception {
        String body = mvc.perform(get("/api/buildings").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8);
        return JsonPath.<List<Integer>>read(body, "$.data[*].id").get(0);
    }

    private int contract(int tenantId, String start, String end, String kva) throws Exception {
        return postId("/api/contracts", "{\"contractNo\":\"IT-BN-" + System.nanoTime() + "\","
                + "\"tenantId\":" + tenantId + ",\"buildingId\":" + building() + ","
                + "\"startDate\":\"" + start + "\",\"endDate\":\"" + end + "\","
                + (kva == null ? "" : "\"kva\":" + kva + ",")
                + "\"rentArea\":100,\"monthlyRent\":1000,\"deposit\":0,\"status\":\"active\"}");
    }

    private int createMeter(String kind, String zone, String name, Integer tenantId) throws Exception {
        return postId("/api/meters", "{\"kind\":\"" + kind + "\",\"zone\":\"" + zone
                + "\",\"name\":\"" + name + "\",\"ownership\":\"tenant\""
                + (tenantId == null ? "" : ",\"tenantId\":" + tenantId) + "}");
    }

    private void bind(int meterId, int contractId) throws Exception {
        mvc.perform(put("/api/meters/" + meterId + "/bind").header("Authorization", auth())
                .contentType("application/json").content("{\"contractId\":" + contractId + "}"))
                .andExpect(jsonPath("$.code").value(0));
    }

    private void reading(int meterId, String ym, String fields) throws Exception {
        postOk("/api/meters/readings",
                "{\"meterId\":" + meterId + ",\"ym\":\"" + ym + "\"," + fields + "}");
    }

    private void price(String cfgKey, String ym, String value) throws Exception {
        mvc.perform(put("/api/price-cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"\",\"cfgKey\":\"" + cfgKey + "\",\"acctMonth\":\"" + ym + "\",\"value\":" + value + "}"))
                .andExpect(jsonPath("$.code").value(0));
    }

    private void priceScoped(String scope, String cfgKey, String value) throws Exception {
        mvc.perform(put("/api/price-cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"" + scope + "\",\"cfgKey\":\"" + cfgKey
                        + "\",\"acctMonth\":\"\",\"value\":" + value + "}"))
                .andExpect(jsonPath("$.code").value(0));
    }

    // 直造池:rule(direct 法=整额归户)+ 受益人 + 当月快照;poolContributions 有快照才吐行
    private int pool(String name, String feeKey, int buildingId, int tenantId, String ym, String cost) {
        jdbc.update("INSERT INTO alloc_rule(zone,name,method,fee_key,building_id) VALUES('p2',?,'direct',?,?)",
                name, feeKey, buildingId);
        Integer rid = jdbc.queryForObject("SELECT MAX(id) FROM alloc_rule", Integer.class);
        jdbc.update("INSERT INTO alloc_rule_member(rule_id,tenant_id,acct_month) VALUES(?,?,'')", rid, tenantId);
        jdbc.update("INSERT INTO alloc_pool_result(ym,rule_id,qty_total,cost_amount,generated_at) "
                + "VALUES(?,?,0,?,NOW())", ym, rid, new java.math.BigDecimal(cost));
        return rid;
    }

    // 月变电价 6 键(缺当月版本 resolve=null;常数键 capacity_fee/water/mgmt_fee 等走 V60 全园种子)
    private void monthlyPrices(String ym) throws Exception {
        price("elec_sharp", ym, "1.5");
        price("elec_peak", ym, "1.2");
        price("elec_flat", ym, "0.7");
        price("elec_valley", ym, "0.3");
        price("elec_commercial", ym, "0.8");
        price("elec_resident", ym, "0.6");
    }

    private void paymap(int tenantId, String feeKey, int companyId) throws Exception {
        mvc.perform(put("/api/bills/paymap").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"tenantId\":" + tenantId + ",\"feeKey\":\"" + feeKey + "\",\"companyId\":" + companyId + "}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
    }

    // ── helpers:引擎端点(API 契约) ──

    private String generate(String ym) throws Exception {
        return postOk("/api/bill-notices/generate?ym=" + ym, "{}");
    }

    private String list(String ym) throws Exception {
        return new String(mvc.perform(get("/api/bill-notices").param("ym", ym)
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private List<Map<String, Object>> notices(String ym, int tenantId) throws Exception {
        return JsonPath.read(list(ym), "$.data[?(@.tenantId==" + tenantId + ")]");
    }

    private int soleNoticeId(String ym, int tenantId) throws Exception {
        List<Map<String, Object>> rows = notices(ym, tenantId);
        assertThat(rows).hasSize(1);
        return ((Number) rows.get(0).get("id")).intValue();
    }

    private String detail(int id) throws Exception {
        return new String(mvc.perform(get("/api/bill-notices/" + id).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private List<Map<String, Object>> feeLines(String detailBody, String feeKey) {
        return JsonPath.read(detailBody, "$.data.lines[?(@.feeKey=='" + feeKey + "')]");
    }

    private List<Map<String, Object>> segLines(String detailBody, String seg) {
        return JsonPath.read(detailBody, "$.data.lines[?(@.seg=='" + seg + "')]");
    }

    private static Map<String, Object> one(List<Map<String, Object>> rows) {
        assertThat(rows).hasSize(1);
        return rows.get(0);
    }

    private static double d(Object o) { return ((Number) o).doubleValue(); }

    // ── t1 分时表:4 段行+mgmt 行;尖段 price_snap=峰价(sharp_as_peak_ratio=0);审计链齐。
    //    S4-3 E3(定案 2026-08-05):分时表管理费基数=Σ段用量(源册口径,常与总示数差分位),
    //    故意造 总示数1010≠Σ段1000,断言 mgmt 按 1000 计。 ──
    @Test
    void t1_touMeter_fourSegLines_mgmt_auditChain() throws Exception {
        String ym = "2090-01";
        monthlyPrices(ym);
        int t = createTenant("IT出账分时户");
        int c = contract(t, "2089-01-01", "2099-12-31", null);
        int m = createMeter("elec", "p1", "IT出账分时电表", t);
        bind(m, c);
        reading(m, ym, "\"prevTotal\":0,\"currTotal\":1010,"
                + "\"prevSharp\":0,\"currSharp\":100,\"prevPeak\":0,\"currPeak\":200,"
                + "\"prevFlat\":0,\"currFlat\":300,\"prevValley\":0,\"currValley\":400");

        String gen = generate(ym);
        assertThat((int) JsonPath.read(gen, "$.data.generated")).isEqualTo(1);

        String body = detail(soleNoticeId(ym, t));
        assertThat(feeLines(body, "elec")).hasSize(4);
        Map<String, Object> sharp = one(segLines(body, "sharp"));
        assertThat(d(sharp.get("priceSnap"))).isEqualTo(1.2);   // ratio=0 ⇒ 实收峰价快照
        assertThat(d(sharp.get("qty"))).isEqualTo(100.0);
        assertThat(d(sharp.get("amount"))).isEqualTo(120.0);
        Map<String, Object> peak = one(segLines(body, "peak"));
        assertThat(d(peak.get("amount"))).isEqualTo(240.0);
        assertThat(peak.get("ruleBranch")).isEqualTo("tou");
        assertThat(peak.get("priceKey")).isEqualTo("elec_peak");
        assertThat(peak.get("priceScope")).isEqualTo("");
        assertThat(peak.get("priceMonth")).isEqualTo(ym);
        assertThat(peak.get("contractId")).isEqualTo(c);        // 绑定快照进行
        assertThat(d(one(segLines(body, "flat")).get("amount"))).isEqualTo(210.0);
        assertThat(d(one(segLines(body, "valley")).get("amount"))).isEqualTo(120.0);
        Map<String, Object> mgmt = one(feeLines(body, "mgmt_fee"));
        assertThat(d(mgmt.get("qty"))).isEqualTo(1000.0);   // E3:Σ段=1000,非总示数 1010
        assertThat(d(mgmt.get("priceSnap"))).isEqualTo(0.16);
        assertThat(d(mgmt.get("amount"))).isEqualTo(160.0);
        assertThat((String) mgmt.get("note")).contains("Σ段");
        Number total = JsonPath.read(body, "$.data.totalAmount");
        assertThat(total.doubleValue()).isEqualTo(850.0);
    }

    // ── t2 宿舍房间表:居民价+mgmt 0.16;水 3.85(dorm scope)+管网 0;ruleBranch='resident' ──
    @Test
    void t2_dormRoom_residentPrice_water385_pipeZero() throws Exception {
        String ym = "2090-02";
        monthlyPrices(ym);
        int t = createTenant("IT出账宿舍户");
        int c = contract(t, "2089-01-01", "2099-12-31", null);
        int e = createMeter("elec", "dorm", "IT出账宿舍电", t);
        int w = createMeter("water", "dorm", "IT出账宿舍水", t);
        jdbc.update("UPDATE meter SET is_dorm_room=1 WHERE id IN (?,?)", e, w);
        bind(e, c); bind(w, c);
        reading(e, ym, "\"prevTotal\":0,\"currTotal\":100");
        reading(w, ym, "\"prevTotal\":0,\"currTotal\":20");

        generate(ym);
        String body = detail(soleNoticeId(ym, t));
        Map<String, Object> elec = one(feeLines(body, "elec"));
        assertThat(elec.get("ruleBranch")).isEqualTo("resident");
        assertThat(d(elec.get("priceSnap"))).isEqualTo(0.6);
        assertThat(d(elec.get("amount"))).isEqualTo(60.0);
        Map<String, Object> mgmt = one(feeLines(body, "mgmt_fee"));
        assertThat(d(mgmt.get("priceSnap"))).isEqualTo(0.16);
        assertThat(d(mgmt.get("amount"))).isEqualTo(16.0);
        Map<String, Object> water = one(feeLines(body, "water"));
        assertThat(water.get("ruleBranch")).isEqualTo("resident");
        assertThat(d(water.get("priceSnap"))).isEqualTo(3.85);
        assertThat(water.get("priceScope")).isEqualTo("dorm");
        assertThat(d(water.get("amount"))).isEqualTo(77.0);
        // 管网费 dorm scope 天然 0:出行则金额必为 0(费率 0 不出行也合规)
        for (Map<String, Object> pipe : feeLines(body, "water_pipe"))
            assertThat(d(pipe.get("amount"))).isEqualTo(0.0);
    }

    // ── t3 普通电表:商业价+mgmt_fee_commercial 0.32;水 3.95+管网 0.5 ──
    @Test
    void t3_commercialMeter_032Mgmt() throws Exception {
        String ym = "2090-03";
        monthlyPrices(ym);
        int t = createTenant("IT出账商业户");
        int c = contract(t, "2089-01-01", "2099-12-31", null);
        int e = createMeter("elec", "p1", "IT出账商业电", t);
        int w = createMeter("water", "p1", "IT出账商业水", t);
        bind(e, c); bind(w, c);
        reading(e, ym, "\"prevTotal\":0,\"currTotal\":100");
        reading(w, ym, "\"prevTotal\":0,\"currTotal\":10");

        generate(ym);
        String body = detail(soleNoticeId(ym, t));
        Map<String, Object> elec = one(feeLines(body, "elec"));
        assertThat(elec.get("ruleBranch")).isEqualTo("commercial");
        assertThat(d(elec.get("priceSnap"))).isEqualTo(0.8);
        assertThat(d(elec.get("amount"))).isEqualTo(80.0);
        Map<String, Object> mgmt = one(feeLines(body, "mgmt_fee"));
        assertThat(d(mgmt.get("priceSnap"))).isEqualTo(0.32);
        assertThat(d(mgmt.get("amount"))).isEqualTo(32.0);
        assertThat(d(one(feeLines(body, "water")).get("amount"))).isEqualTo(39.5);
        assertThat(d(one(feeLines(body, "water_pipe")).get("amount"))).isEqualTo(5.0);
    }

    // ── t4 elec_package 户级包干:全部用量单行 tenant_override,不出 mgmt 行 ──
    @Test
    void t4_elecPackage_singleLine_noMgmt() throws Exception {
        String ym = "2090-04";
        monthlyPrices(ym);
        int t = createTenant("IT出账包干户");
        int c = contract(t, "2089-01-01", "2099-12-31", null);
        int m = createMeter("elec", "p1", "IT出账包干电", t);
        bind(m, c);
        // 分时读数也被户级包干压过(§2.4 ⑥:例外价压过分时读数)
        reading(m, ym, "\"prevTotal\":0,\"currTotal\":1000,"
                + "\"prevPeak\":0,\"currPeak\":600,\"prevFlat\":0,\"currFlat\":400");
        mvc.perform(put("/api/price-cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"tenant:" + t + "\",\"cfgKey\":\"elec_package\",\"value\":1.0}"))
                .andExpect(jsonPath("$.code").value(0));

        generate(ym);
        List<Map<String, Object>> rows = notices(ym, t);
        assertThat(rows).hasSize(1);
        assertThat(((Number) rows.get(0).get("lineCount")).intValue()).isEqualTo(1);
        String body = detail(((Number) rows.get(0).get("id")).intValue());
        Map<String, Object> line = one(feeLines(body, "elec"));
        assertThat(line.get("ruleBranch")).isEqualTo("tenant_override");
        assertThat(line.get("priceScope")).isEqualTo("tenant:" + t);
        assertThat(d(line.get("qty"))).isEqualTo(1000.0);
        assertThat(d(line.get("amount"))).isEqualTo(1000.0);
        assertThat(feeLines(body, "mgmt_fee")).isEmpty();
    }

    // ── t5 容量费=kva×22.6(V60 全园种子);起租月中按天折(闭区间天数/当月天数) ──
    @Test
    void t5_capacityFee_kva_midMonthProrate() throws Exception {
        String ym = "2090-05";
        monthlyPrices(ym);
        int full = createTenant("IT出账容量整月户");
        contract(full, "2089-01-01", "2099-12-31", "10");
        int mid = createTenant("IT出账容量月中户");
        contract(mid, "2090-05-16", "2099-12-31", "10");

        String gen = generate(ym);
        assertThat((int) JsonPath.read(gen, "$.data.generated")).isEqualTo(2);
        // 整月:10×22.6=226.00
        String bodyFull = detail(soleNoticeId(ym, full));
        assertThat(d(one(feeLines(bodyFull, "capacity")).get("amount"))).isEqualTo(226.0);
        // 月中起租:5 月 31 天,16..31 共 16 天在租 → 226×16/31=116.65
        String bodyMid = detail(soleNoticeId(ym, mid));
        assertThat(d(one(feeLines(bodyMid, "capacity")).get("amount"))).isCloseTo(116.65, within(0.01));
    }

    // ── t6 paymap 两公司→同户拆两张单;is_dorm_room 段整段进 noticeKind='dorm' 单(收款取 dormRent 映射) ──
    @Test
    void t6_paymapSplit_dormSegmentOwnNotice() throws Exception {
        String ym = "2090-06";
        monthlyPrices(ym);
        int t = createTenant("IT出账拆单户");
        int c = contract(t, "2089-01-01", "2099-12-31", null);
        int e = createMeter("elec", "p1", "IT出账拆单电", t);
        int w = createMeter("water", "p1", "IT出账拆单水", t);
        int dr = createMeter("elec", "dorm", "IT出账拆单宿舍电", t);
        jdbc.update("UPDATE meter SET is_dorm_room=1 WHERE id=?", dr);
        bind(e, c); bind(w, c); bind(dr, c);
        reading(e, ym, "\"prevTotal\":0,\"currTotal\":100");   // 商业 80 + mgmt 32 → 公司1
        reading(w, ym, "\"prevTotal\":0,\"currTotal\":10");    // 水 39.5 + 管网 5 → 公司3
        reading(dr, ym, "\"prevTotal\":0,\"currTotal\":50");   // 居民 30 + mgmt 8 → dorm 单/公司2(宿舍段无损耗行,2024-02 实证)
        paymap(t, "elecStd", 1);
        paymap(t, "waterStd", 3);
        paymap(t, "dormRent", 2);

        generate(ym);
        List<Map<String, Object>> rows = notices(ym, t);
        assertThat(rows).hasSize(3);
        List<Map<String, Object>> dorm = JsonPath.read(list(ym),
                "$.data[?(@.tenantId==" + t + " && @.noticeKind=='dorm')]");
        assertThat(dorm).hasSize(1);
        assertThat(((Number) dorm.get(0).get("payCompanyId")).intValue()).isEqualTo(2);
        assertThat(d(dorm.get(0).get("totalAmount"))).isEqualTo(38.0);
        List<Map<String, Object>> co1 = JsonPath.read(list(ym),
                "$.data[?(@.tenantId==" + t + " && @.payCompanyId==1)]");
        assertThat(d(one(co1).get("totalAmount"))).isEqualTo(112.0);   // 80+32(mgmt elecMaint 查无→兜底 elecStd)
        List<Map<String, Object>> co3 = JsonPath.read(list(ym),
                "$.data[?(@.tenantId==" + t + " && @.payCompanyId==3)]");
        assertThat(d(one(co3).get("totalAmount"))).isEqualTo(44.5);    // 39.5+5(water_pipe 兜底 waterStd)
    }

    // ── t7 幂等:二次 generate 单数行数不变;issue 后重生成该户跳过且 warned≥1;void 可撤 ──
    @Test
    void t7_idempotent_issuedSkipped_thenVoid() throws Exception {
        String ym = "2090-07";
        monthlyPrices(ym);
        int t = createTenant("IT出账幂等户");
        int c = contract(t, "2089-01-01", "2099-12-31", null);
        int m = createMeter("elec", "p1", "IT出账幂等电", t);
        bind(m, c);
        reading(m, ym, "\"prevTotal\":0,\"currTotal\":100");

        String g1 = generate(ym);
        int generated = JsonPath.read(g1, "$.data.generated");
        int lines = JsonPath.read(g1, "$.data.lines");
        assertThat(generated).isEqualTo(1);
        int id1 = soleNoticeId(ym, t);
        // 二跑:先删 draft 再插,单数行数不变(id 允许变,单仍唯一)
        String g2 = generate(ym);
        assertThat((int) JsonPath.read(g2, "$.data.generated")).isEqualTo(generated);
        assertThat((int) JsonPath.read(g2, "$.data.lines")).isEqualTo(lines);
        int id2 = soleNoticeId(ym, t);

        postOk("/api/bill-notices/" + id2 + "/issue", "{}");
        String g3 = generate(ym);
        assertThat((int) JsonPath.read(g3, "$.data.warned")).isGreaterThanOrEqualTo(1);
        List<Map<String, Object>> rows = notices(ym, t);   // issued 不被覆盖,户内仍唯一
        assertThat(rows).hasSize(1);
        assertThat(((Number) rows.get(0).get("id")).intValue()).isEqualTo(id2);
        assertThat(rows.get(0).get("status")).isEqualTo("issued");

        postOk("/api/bill-notices/" + id2 + "/void", "{}");
        assertThat(one(notices(ym, t)).get("status")).isEqualTo("void");
    }

    // ── t8 offbook 户→全部单 noticeKind='offbook';负用量→行 amount<0 且单头 warn 含「负」 ──
    @Test
    void t8_offbook_negativeUsage_warn() throws Exception {
        String ym = "2090-08";
        monthlyPrices(ym);
        int t = createTenant("IT出账账外户");
        int c = contract(t, "2089-01-01", "2099-12-31", null);
        int m = createMeter("elec", "p1", "IT出账账外电", t);
        jdbc.update("UPDATE tenant SET offbook=1 WHERE id=?", t);
        bind(m, c);
        reading(m, ym, "\"prevTotal\":100,\"currTotal\":50");   // 读数回退 → 用量 -50

        generate(ym);
        List<Map<String, Object>> rows = notices(ym, t);
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).get("noticeKind")).isEqualTo("offbook");
        assertThat(d(rows.get(0).get("totalAmount"))).isLessThan(0.0);
        assertThat((String) rows.get(0).get("warn")).contains("负");
        String body = detail(((Number) rows.get(0).get("id")).intValue());
        assertThat(d(one(feeLines(body, "elec")).get("amount"))).isLessThan(0.0);
    }

    // ── t9 未绑合同表(仅 tenant_id,家族无合同)→降级出单+warn 含「未归属」,行 contractId 空 ──
    @Test
    void t9_unboundMeter_degradedNotice_warn() throws Exception {
        String ym = "2090-09";
        monthlyPrices(ym);
        int t = createTenant("IT出账无合同户");
        int m = createMeter("elec", "p1", "IT出账无合同电", t);
        reading(m, ym, "\"prevTotal\":0,\"currTotal\":100");

        String gen = generate(ym);
        assertThat((int) JsonPath.read(gen, "$.data.warned")).isGreaterThanOrEqualTo(1);
        List<Map<String, Object>> rows = notices(ym, t);
        assertThat(rows).hasSize(1);
        assertThat((String) rows.get(0).get("warn")).contains("未归属");
        String body = detail(((Number) rows.get(0).get("id")).intValue());
        Map<String, Object> line = one(feeLines(body, "elec"));
        assertThat(line.get("contractId")).isNull();
        assertThat(d(line.get("amount"))).isEqualTo(80.0);
    }

    // ── t10 有单月份读数批删→409(防「读数删了单还在」;S4-BILL-NOTICE-SPEC §8 守卫) ──
    @Test
    void t10_batchDeleteReadings_withNotices_409() throws Exception {
        String ym = "2090-10";
        monthlyPrices(ym);
        int t = createTenant("IT出账删守户");
        int c = contract(t, "2089-01-01", "2099-12-31", null);
        int m = createMeter("elec", "p1", "IT出账删守电", t);
        bind(m, c);
        reading(m, ym, "\"prevTotal\":0,\"currTotal\":100");
        generate(ym);

        mvc.perform(delete("/api/meters/readings").param("ym", ym)
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(409));
    }

    // ── helpers:租金派生用(S5 刀2)——带计费行/免租期/可缺日期的合同 ──
    private int contractLines(int tenantId, String start, String end, String rentFree, String linesJson)
            throws Exception {
        return postId("/api/contracts", "{\"contractNo\":\"IT-BN-" + System.nanoTime() + "\","
                + "\"tenantId\":" + tenantId + ",\"buildingId\":" + building() + ","
                + (start == null ? "" : "\"startDate\":\"" + start + "\",\"endDate\":\"" + end + "\",")
                + (rentFree == null ? "" : "\"rentFree\":\"" + rentFree.replace("\"", "\\\"") + "\",")
                + "\"deposit\":0,\"status\":\"active\",\"billingLines\":" + linesJson + "}");
    }

    private static final String FACTORY_LINES =   // rent_factory 100㎡×10=1000.00 + mgmt 100㎡×2=200.00
            "[{\"propertyType\":\"factory\",\"location\":\"A座101\",\"feeKey\":\"rent_factory\",\"area\":100,\"unitPrice\":10},"
            + "{\"propertyType\":\"factory\",\"location\":\"A座101\",\"feeKey\":\"mgmt\",\"area\":100,\"unitPrice\":2}]";

    // ── t11 整月租金:rent 行 2 条 1000.00/200.00,feeGroup='rent',premise=行 location,
    //    拆单按 (property_type,fee_key)→colId 查 paymap(factoryRent/factoryMgmtFee 两公司两张单) ──
    @Test
    void t11_rentFullMonth_twoLines_paymapByRentCol() throws Exception {
        String ym = "2090-11";
        int t = createTenant("IT租金整月户");
        int c = contractLines(t, "2089-01-01", "2099-12-31", null, FACTORY_LINES);
        paymap(t, "factoryRent", 1);
        paymap(t, "factoryMgmtFee", 2);

        String gen = generate(ym);
        assertThat((int) JsonPath.read(gen, "$.data.generated")).isEqualTo(2);
        assertThat(notices(ym, t)).hasSize(2);
        // 公司1 单=厂房租金 1000.00
        List<Map<String, Object>> co1 = JsonPath.read(list(ym),
                "$.data[?(@.tenantId==" + t + " && @.payCompanyId==1)]");
        assertThat(d(one(co1).get("totalAmount"))).isEqualTo(1000.0);
        String body1 = detail(((Number) co1.get(0).get("id")).intValue());
        Map<String, Object> rent = one(feeLines(body1, "rent_factory"));
        assertThat(d(rent.get("amount"))).isEqualTo(1000.0);
        assertThat(rent.get("feeGroup")).isEqualTo("rent");
        assertThat(rent.get("premise")).isEqualTo("A座101");
        assertThat(rent.get("ruleBranch")).isEqualTo("rent");
        assertThat(rent.get("contractId")).isEqualTo(c);
        assertThat(d(rent.get("qty"))).isEqualTo(100.0);        // 建筑面积
        assertThat(d(rent.get("priceSnap"))).isEqualTo(10.0);   // 单价
        assertThat(rent.get("note")).isNull();                  // 整月不出折算式
        // 公司2 单=厂房企业管理服务费 200.00(免租期不扣 mgmt 场景之外的基线)
        List<Map<String, Object>> co2 = JsonPath.read(list(ym),
                "$.data[?(@.tenantId==" + t + " && @.payCompanyId==2)]");
        assertThat(d(one(co2).get("totalAmount"))).isEqualTo(200.0);
        Map<String, Object> mgmt = one(feeLines(detail(((Number) co2.get(0).get("id")).intValue()), "mgmt"));
        assertThat(d(mgmt.get("amount"))).isEqualTo(200.0);
        assertThat(mgmt.get("feeGroup")).isEqualTo("rent");
    }

    // ── t12 按天折:2090-12-06 起租,12 月 31 天在租 26 天 → 1000×26/31=838.71,note 含「÷31×26」 ──
    @Test
    void t12_rentMidMonthProrate_noteFormula() throws Exception {
        String ym = "2090-12";
        int t = createTenant("IT租金按天折户");
        contractLines(t, "2090-12-06", "2099-12-31", null,
                "[{\"propertyType\":\"factory\",\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":100,\"unitPrice\":10}]");

        generate(ym);
        String body = detail(soleNoticeId(ym, t));
        Map<String, Object> rent = one(feeLines(body, "rent_factory"));
        assertThat(d(rent.get("amount"))).isCloseTo(838.71, within(0.001));
        assertThat((String) rent.get("note")).contains("÷31×26");
    }

    // ── t13 免租期覆盖整月:rent 行 0.00(出行不吞),mgmt 行照收 200.00(免租仅扣 rent_*) ──
    @Test
    void t13_rentFreeWholeMonth_rentZero_mgmtKept() throws Exception {
        String ym = "2091-03";
        int t = createTenant("IT租金免租户");
        contractLines(t, "2089-01-01", "2099-12-31",
                "[{\"start\":\"2091-03-01\",\"end\":\"2091-03-31\"}]", FACTORY_LINES);

        generate(ym);
        String body = detail(soleNoticeId(ym, t));
        Map<String, Object> rent = one(feeLines(body, "rent_factory"));
        assertThat(d(rent.get("amount"))).isEqualTo(0.0);
        assertThat((String) rent.get("note")).contains("免租扣");
        assertThat(d(one(feeLines(body, "mgmt")).get("amount"))).isEqualTo(200.0);
    }

    // ── t14 缺起止日期:整户 warn「缺起止日期」且无 rent 行;水电行照出(表绑该合同) ──
    @Test
    void t14_rentDateMissing_warnNoRentLines() throws Exception {
        String ym = "2091-04";
        monthlyPrices(ym);
        int t = createTenant("IT租金缺日期户");
        int c = contractLines(t, null, null, null,
                "[{\"propertyType\":\"factory\",\"location\":\"主\",\"feeKey\":\"rent_factory\",\"area\":100,\"unitPrice\":10}]");
        int m = createMeter("elec", "p1", "IT租金缺日期电", t);
        bind(m, c);
        reading(m, ym, "\"prevTotal\":0,\"currTotal\":100");

        generate(ym);
        List<Map<String, Object>> rows = notices(ym, t);
        assertThat(rows).hasSize(1);
        assertThat((String) rows.get(0).get("warn")).contains("缺起止日期");
        String body = detail(((Number) rows.get(0).get("id")).intValue());
        assertThat(feeLines(body, "rent_factory")).isEmpty();
        assertThat(d(one(feeLines(body, "elec")).get("amount"))).isEqualTo(80.0);
    }

    private static Map<String, Object> elecOfMeter(String detailBody, int meterId) {
        return one(JsonPath.read(detailBody,
                "$.data.lines[?(@.meterId==" + meterId + " && @.feeKey=='elec')]"));
    }

    // ── t16 S6 场地标签按表定位(S6-PREMISE-BY-METER-SPEC §2):表行 premise 跟表走,不跟合同走。槽 2091-05。
    //    A 户逐间计费行:表名带房号→命中取该间原文;房号不在清单(D3 借表/挂错合同)→回退合同长串+按表短 warn。
    //    B 户 A 类合并录入(一条 location 列三间)→ §2.3 合成单间。
    //    C 户 6 条计费行 → §2.5 premise_text 超 5 项收敛「等N处」(防 255 硬截切出半截房号)。
    //    金额一分不动:本用例只断言标签列。 ──
    @Test
    void t16_premiseByMeter_pinRoom_synthesize_fallbackWarn_textCap() throws Exception {
        String ym = "2091-05";
        monthlyPrices(ym);
        // A:逐间 location(B 类拼接的正解形态)
        int ta = createTenant("IT场地逐间户");
        int ca = contractLines(ta, "2089-01-01", "2099-12-31", null,
                "[{\"propertyType\":\"factory\",\"location\":\"A座309室\",\"feeKey\":\"rent_factory\",\"area\":10,\"unitPrice\":1},"
                + "{\"propertyType\":\"factory\",\"location\":\"A座310室\",\"feeKey\":\"rent_factory\",\"area\":10,\"unitPrice\":1},"
                + "{\"propertyType\":\"factory\",\"location\":\"A座311室\",\"feeKey\":\"rent_factory\",\"area\":10,\"unitPrice\":1}]");
        int hit = createMeter("elec", "p1", "IT场地电309", ta);    // name 带房号 → 命中 A座309室
        int miss = createMeter("elec", "p1", "IT场地电999", ta);   // 房号不在本合同清单 → 回退
        bind(hit, ca); bind(miss, ca);
        reading(hit, ym, "\"prevTotal\":0,\"currTotal\":100");
        reading(miss, ym, "\"prevTotal\":0,\"currTotal\":100");
        // B:一条 location 列三间
        int tb = createTenant("IT场地合并户");
        int cb = contractLines(tb, "2089-01-01", "2099-12-31", null,
                "[{\"propertyType\":\"factory\",\"location\":\"二期10号楼（三车间）602、603、604单元\","
                + "\"feeKey\":\"rent_factory\",\"area\":10,\"unitPrice\":1}]");
        int mb = createMeter("elec", "p1", "IT场地电603", tb);
        bind(mb, cb);
        reading(mb, ym, "\"prevTotal\":0,\"currTotal\":100");
        // C:6 条计费行(无表),只验 premise_text 收敛
        int tc = createTenant("IT场地多项户");
        StringBuilder six = new StringBuilder("[");
        for (int i = 101; i <= 106; i++)
            six.append(i > 101 ? "," : "").append("{\"propertyType\":\"factory\",\"location\":\"A座")
               .append(i).append("\",\"feeKey\":\"rent_factory\",\"area\":10,\"unitPrice\":1}");
        contractLines(tc, "2089-01-01", "2099-12-31", null, six.append("]").toString());

        generate(ym);

        // ① 唯一命中 → 该间原文(与公摊行同源,前端 byPremise 才配得上)
        String bodyA = detail(soleNoticeId(ym, ta));
        assertThat(elecOfMeter(bodyA, hit).get("premise")).isEqualTo("A座309室");
        // ② 零命中 → 回退今天的长串(不猜)+ 按表短 warn
        assertThat(elecOfMeter(bodyA, miss).get("premise")).isEqualTo("A座309室、A座310室、A座311室");
        assertThat((String) one(notices(ym, ta)).get("warn")).contains("场地未定:IT场地电999");
        // ③ A 类合并串 → 合成单间
        assertThat(elecOfMeter(detail(soleNoticeId(ym, tb)), mb).get("premise"))
                .isEqualTo("二期10号楼（三车间）603单元");
        // ④ premise_text 超 5 项 → 前 5 项 + 等N处
        assertThat(one(notices(ym, tc)).get("premiseText"))
                .isEqualTo("A座101,A座102,A座103,A座104,A座105,等6处");
    }

    // ── t17 刀C 损耗零基数残渣行:链内一条 premise 为空的零额公摊行(splitShare 拆不出场地=原样保留)
    //    会给 byPremise 多开一个 chainBase=0 的桶,引擎照桶补一条 premise 空、base_snap 0、金额 0.00 的
    //    损耗行(真数三户:中科华贸/方凯鑫/刘彪)。断言:只出 1 条损耗行,且金额一分不动。槽 2091-06。
    //    造链:新栋隔离损耗组(总表 C=1000,户表 900 度绑合同)→ 率=−(900−1000)/1000=0.1;
    //    p2 price_loss 走 V47 种子;损耗金额=场地电费 900×0.8=720.00 × 0.1 = 72.00。
    //    零额行=挂本栋的 direct 电梯池(应分摊 0.00),池楼栋≠合同楼栋 → splitShare 候选空,premise 留空。 ──
    @Test
    void t17_lossZeroBaseBucket_dropped_amountUnchanged() throws Exception {
        String ym = "2091-06";
        monthlyPrices(ym);
        int bid = postId("/api/buildings", "{\"name\":\"IT损耗零基数栋" + System.nanoTime()
                + "\",\"phase\":2,\"floorCount\":1,\"perFloor\":1,\"totalArea\":100,\"rentableArea\":100}");
        int t = createTenant("IT损耗零基数户");
        int c = contractLines(t, "2089-01-01", "2099-12-31", null,
                "[{\"propertyType\":\"factory\",\"location\":\"IT损耗A区\",\"feeKey\":\"rent_factory\",\"area\":10,\"unitPrice\":1}]");
        int head = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT损耗总表\","
                + "\"ownership\":\"infra\",\"buildingId\":" + bid + "}");
        int mA = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT损耗户表甲\","
                + "\"ownership\":\"tenant\",\"tenantId\":" + t + ",\"buildingId\":" + bid + "}");
        bind(mA, c);
        reading(head, ym, "\"prevTotal\":0,\"currTotal\":1000");
        reading(mA, ym, "\"prevTotal\":0,\"currTotal\":900");
        // 链内零额公摊行:池挂新栋(进链),受益人=本户,应分摊 0.00;池快照非空 poolContributions 才吐损耗链
        jdbc.update("INSERT INTO alloc_rule(zone,name,method,fee_key,building_id) "
                + "VALUES('p2','IT损耗零额电梯池','direct','share_elec_elevator',?)", bid);
        Integer rid = jdbc.queryForObject("SELECT MAX(id) FROM alloc_rule", Integer.class);
        jdbc.update("INSERT INTO alloc_rule_member(rule_id,tenant_id,acct_month) VALUES(?,?,'')", rid, t);
        jdbc.update("INSERT INTO alloc_pool_result(ym,rule_id,qty_total,cost_amount,generated_at) "
                + "VALUES(?,?,0,0,NOW())", ym, rid);

        generate(ym);
        String body = detail(soleNoticeId(ym, t));
        // 输入形态:电费 720.00(损耗基数来源,防两侧同错)+ premise 空的零额公摊行
        assertThat(d(elecOfMeter(body, mA).get("amount"))).isEqualTo(720.0);
        Map<String, Object> share = one(feeLines(body, "share_elec_elevator"));
        assertThat(share.get("premise")).isNull();
        assertThat(d(share.get("amount"))).isEqualTo(0.0);
        // 出口:损耗行只此一条(零基数桶不落),金额=720.00×0.1
        Map<String, Object> loss = one(feeLines(body, "share_elec_loss"));
        assertThat(loss.get("premise")).isEqualTo("IT损耗A区");
        assertThat(d(loss.get("baseSnap"))).isEqualTo(720.0);
        assertThat(d(loss.get("amount"))).isEqualTo(72.0);
    }

    // ── t18 孵化协议固定收取(包干):户级 share_elec_fixed / share_water_fixed 命中 → 楼层公共/消防照明/
    //    电梯/路灯四类电公摊行与绿化水公摊行整户不落,各改落一条固定额行;电包干行沿用
    //    fee_key='share_elec_floor' 并回挂该户楼层池 → E2 损耗基数白名单自动把包干额算进去。
    //    源册锚点(一期2024年2月水电费.xlsx sheet「联塑精铟」K5/K6/K7):
    //      户内电费 43.80 + 公共用电分摊(包干)232 = 275.80,×损耗率 0.0616 = 16.99 逐格全等。
    //    照这三个数造链:新栋隔离损耗组,总表 10000 度、本户表 43.80 度、陪跑户表 9340.20 度
    //    → Σ分表 9384 → 率 =(10000−9384)/10000 = 0.0616;本户电价走 elec_package 1.0 元/度。槽 2091-09。
    @Test
    void t18_incubatorPackage_swallowsShareLines_lossBaseIncludesPackage() throws Exception {
        String ym = "2091-09";
        monthlyPrices(ym);
        int bid = postId("/api/buildings", "{\"name\":\"IT包干栋" + System.nanoTime()
                + "\",\"phase\":2,\"floorCount\":1,\"perFloor\":1,\"totalArea\":100,\"rentableArea\":100}");
        int t = createTenant("IT包干户");
        int c = contractLines(t, "2089-01-01", "2099-12-31", null,
                "[{\"propertyType\":\"factory\",\"location\":\"IT包干A区\",\"feeKey\":\"rent_factory\",\"area\":10,\"unitPrice\":1}]");
        int filler = createTenant("IT包干陪跑户");
        int cf = contractLines(filler, "2089-01-01", "2099-12-31", null,
                "[{\"propertyType\":\"factory\",\"location\":\"IT包干B区\",\"feeKey\":\"rent_factory\",\"area\":10,\"unitPrice\":1}]");
        int head = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT包干总表\","
                + "\"ownership\":\"infra\",\"buildingId\":" + bid + "}");
        int mT = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT包干户表\","
                + "\"ownership\":\"tenant\",\"tenantId\":" + t + ",\"buildingId\":" + bid + "}");
        int mF = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT包干陪跑表\","
                + "\"ownership\":\"tenant\",\"tenantId\":" + filler + ",\"buildingId\":" + bid + "}");
        bind(mT, c); bind(mF, cf);
        reading(head, ym, "\"prevTotal\":0,\"currTotal\":10000");
        reading(mT, ym, "\"prevTotal\":0,\"currTotal\":43.8");
        reading(mF, ym, "\"prevTotal\":0,\"currTotal\":9340.2");
        // 待吞的两个池:楼层公共 50.00(电侧)、绿化水公摊 8.00(水侧),受益人=本户
        int rFloor = pool("IT包干楼层池", "share_elec_floor", bid, t, ym, "50");
        int rGreen = pool("IT包干绿化水池", "share_green_water", bid, t, ym, "8");
        priceScoped("tenant:" + t, "elec_package", "1");
        priceScoped("tenant:" + t, "share_elec_fixed", "232");
        priceScoped("tenant:" + t, "share_water_fixed", "155");

        generate(ym);
        String body = detail(soleNoticeId(ym, t));
        // ① 户内电费 43.80(包干电价 1.0)——损耗基数的另一半,防两侧同错
        assertThat(d(elecOfMeter(body, mT).get("amount"))).isEqualTo(43.8);
        // ② 电包干:原 50.00 池行不落,改落一条 232.00,沿用 share_elec_floor 键并回挂该池
        Map<String, Object> pkg = one(feeLines(body, "share_elec_floor"));
        assertThat(d(pkg.get("amount"))).isEqualTo(232.0);
        assertThat(pkg.get("qty")).isNull();
        assertThat(pkg.get("priceKey")).isEqualTo("share_elec_fixed");
        assertThat(pkg.get("priceScope")).isEqualTo("tenant:" + t);
        assertThat(pkg.get("ruleBranch")).isEqualTo("fixed");
        assertThat(pkg.get("note")).isEqualTo("孵化协议固定收取");
        assertThat(((Number) pkg.get("poolRuleId")).intValue()).isEqualTo(rFloor);
        // ③ 水包干:原 8.00 绿化水行不落,改落 155.00 并回挂原池
        Map<String, Object> wpkg = one(feeLines(body, "share_green_water"));
        assertThat(d(wpkg.get("amount"))).isEqualTo(155.0);
        assertThat(wpkg.get("priceKey")).isEqualTo("share_water_fixed");
        assertThat(((Number) wpkg.get("poolRuleId")).intValue()).isEqualTo(rGreen);
        // ④ 源册锚点:损耗基数=43.80+232=275.80,×0.0616=16.99(联塑精铟 K7 逐格全等),且只此一条
        Map<String, Object> loss = one(feeLines(body, "share_elec_loss"));
        assertThat(d(loss.get("baseSnap"))).isEqualTo(275.8);
        assertThat(d(loss.get("amount"))).isEqualTo(16.99);
        // ⑤ §5.9 回填:被吞的池 allocated 记的是包干额(源册「公共电分摊明细」AE 列口径)
        assertThat(jdbc.queryForObject(
                "SELECT allocated_amount FROM alloc_pool_result WHERE ym=? AND rule_id=?",
                java.math.BigDecimal.class, ym, rFloor)).isEqualByComparingTo("232.00");
    }

    // ── S13 §6 损耗base形态 helpers:隔离损耗链(新栋,总表+户表)+挂本栋合同;
    //    flag 落 tenant_price_cfg(键不在价目白名单,JDBC 直插;引擎 resolveHit 只认 tenant: 作用域) ──
    private int contractB(int tenantId, int buildingId, String kva, String linesJson) throws Exception {
        return postId("/api/contracts", "{\"contractNo\":\"IT-BN-" + System.nanoTime() + "\","
                + "\"tenantId\":" + tenantId + ",\"buildingId\":" + buildingId + ","
                + "\"startDate\":\"2089-01-01\",\"endDate\":\"2099-12-31\","
                + (kva == null ? "" : "\"kva\":" + kva + ",")
                + "\"deposit\":0,\"status\":\"active\",\"billingLines\":" + linesJson + "}");
    }

    private void flag(int tenantId, String key, String value) {
        jdbc.update("INSERT INTO tenant_price_cfg(scope,cfg_key,acct_month,cfg_value) VALUES(?,?,'',?)",
                "tenant:" + tenantId, key, new java.math.BigDecimal(value));
    }

    // 造隔离链:总表 C=headTotal,户表 900 度绑本栋合同 → 率=(C−900−其余分表)/C;电价 elec_commercial 0.8
    // → 场地电费 900×0.8=720.00。返回 {tenantId, contractId, buildingId, meterId}。
    private int[] lossChain(String ym, String tag, String headTotal, String kva) throws Exception {
        int bid = postId("/api/buildings", "{\"name\":\"IT形态" + tag + "栋" + System.nanoTime()
                + "\",\"phase\":2,\"floorCount\":1,\"perFloor\":1,\"totalArea\":100,\"rentableArea\":100}");
        int t = createTenant("IT形态" + tag + "户");
        int c = contractB(t, bid, kva,
                "[{\"propertyType\":\"factory\",\"location\":\"IT形态" + tag + "区\",\"feeKey\":\"rent_factory\",\"area\":10,\"unitPrice\":1}]");
        int head = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT形态" + tag + "总表\","
                + "\"ownership\":\"infra\",\"buildingId\":" + bid + "}");
        int m = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT形态" + tag + "户表\","
                + "\"ownership\":\"tenant\",\"tenantId\":" + t + ",\"buildingId\":" + bid + "}");
        bind(m, c);
        reading(head, ym, "\"prevTotal\":0,\"currTotal\":" + headTotal);
        reading(m, ym, "\"prevTotal\":0,\"currTotal\":900");
        return new int[]{t, c, bid, m};
    }

    private Map<String, Object> lossLine(String ym, int tenantId) throws Exception {
        return one(feeLines(detail(soleNoticeId(ym, tenantId)), "share_elec_loss"));
    }

    // ── t30 形态A(两单标准形 33 户):base=B+链内电力管理费行。槽 2092-02。
    //    链率 0.1;电费 720.00+电梯池 50.00+mgmt 900×0.32=288.00 → base 1058×0.1=105.80(B 口径只有 77.00)──
    @Test
    void t30_lossFormA_mgmtInBase() throws Exception {
        String ym = "2092-02";
        monthlyPrices(ym);
        int[] ch = lossChain(ym, "A", "1000", null);
        pool("IT形态A电梯池", "share_elec_elevator", ch[2], ch[0], ym, "50");
        priceScoped("tenant:" + ch[0], "mgmt_fee_commercial", "0.32");
        flag(ch[0], "loss_base_form", "1");

        generate(ym);
        Map<String, Object> loss = lossLine(ym, ch[0]);
        assertThat(d(loss.get("baseSnap"))).isEqualTo(1058.0);
        assertThat(d(loss.get("amount"))).isEqualTo(105.8);
        assertThat((String) loss.get("note")).contains("base形态A");
    }

    // ── t31 形态C(星州,全册唯一):base=仅户电费+容量费,电梯/消防/管理全不进。槽 2092-03。
    //    kva=10×容量价 18=180.00 → base=720+180=900×0.1=90.00;电梯池 50.00 行照出但不进 base ──
    @Test
    void t31_lossFormC_capacityNotShare() throws Exception {
        String ym = "2092-03";
        monthlyPrices(ym);
        int[] ch = lossChain(ym, "C", "1000", "10");
        pool("IT形态C电梯池", "share_elec_elevator", ch[2], ch[0], ym, "50");
        priceScoped("tenant:" + ch[0], "capacity_fee", "18");
        flag(ch[0], "loss_base_form", "3");

        generate(ym);
        String body = detail(soleNoticeId(ym, ch[0]));
        assertThat(d(one(feeLines(body, "capacity")).get("amount"))).isEqualTo(180.0);
        assertThat(d(one(feeLines(body, "share_elec_elevator")).get("amount"))).isEqualTo(50.0);
        Map<String, Object> loss = one(feeLines(body, "share_elec_loss"));
        assertThat(d(loss.get("baseSnap"))).isEqualTo(900.0);
        assertThat(d(loss.get("amount"))).isEqualTo(90.0);
    }

    // ── t32 形态F(邓宇峰×三车间链):base=消防+管理费+户电费,不含电梯;键带链作用域
    //    loss_base_form_b{楼栋id}。槽 2092-04。base=720+消防30+mgmt288=1038×0.1=103.80 ──
    @Test
    void t32_lossFormF_noElevator_chainScopedKey() throws Exception {
        String ym = "2092-04";
        monthlyPrices(ym);
        int[] ch = lossChain(ym, "F", "1000", null);
        pool("IT形态F电梯池", "share_elec_elevator", ch[2], ch[0], ym, "50");
        pool("IT形态F消防池", "share_elec_fire", ch[2], ch[0], ym, "30");
        priceScoped("tenant:" + ch[0], "mgmt_fee_commercial", "0.32");
        flag(ch[0], "loss_base_form_b" + ch[2], "6");

        generate(ym);
        Map<String, Object> loss = lossLine(ym, ch[0]);
        assertThat(d(loss.get("baseSnap"))).isEqualTo(1038.0);
        assertThat(d(loss.get("amount"))).isEqualTo(103.8);
    }

    // ── t33 形态G(永龙):base=B+指定park表(S51反向有功)电费=度数×平段价;其管理费不收。槽 2092-05。
    //    park表 100 度入分表Σ:D=1000,C=1250 → 率 0.2;base=720+0+100×0.7=790×0.2=158.00 ──
    @Test
    void t33_lossFormG_parkMeterAmountAdded() throws Exception {
        String ym = "2092-05";
        monthlyPrices(ym);
        int[] ch = lossChain(ym, "G", "1250", null);
        int park = postId("/api/meters", "{\"kind\":\"elec\",\"zone\":\"p2\",\"name\":\"IT形态G反向有功\","
                + "\"ownership\":\"park\",\"buildingId\":" + ch[2] + "}");
        reading(park, ym, "\"prevTotal\":0,\"currTotal\":100");
        pool("IT形态G电梯池", "share_elec_elevator", ch[2], ch[0], ym, "0");   // 池快照非空才吐损耗链
        flag(ch[0], "loss_base_form", "7");
        flag(ch[0], "loss_base_park_meter", String.valueOf(park));

        generate(ym);
        Map<String, Object> loss = lossLine(ym, ch[0]);
        // S13-b:G 形与源册对齐后 base 含管理费(永龙 K 列铁证)=720+park70+mgmt288=1078
        assertThat(d(loss.get("baseSnap"))).isEqualTo(1078.0);
        assertThat(d(loss.get("amount"))).isEqualTo(215.6);
        assertThat((String) loss.get("note")).contains("base形态G");
    }

    // ── t34 形态B也吃二期园区级池(消防设施 0.015×面积,楼栋空):源册消防行打包园区面积项,
    //    损耗 base 含它(力灏 dev−源=−6.07=漏掉的 211.58×0.0287 实锚)。链归属按行合同楼栋判。槽 2092-06。
    //    base=720+园区级消防池 30=750×0.1=75.00(无 flag=默认B) ──
    @Test
    void t34_lossFormB_parkLevelFirePoolInBase() throws Exception {
        String ym = "2092-06";
        monthlyPrices(ym);
        int[] ch = lossChain(ym, "B", "1000", null);
        jdbc.update("INSERT INTO alloc_rule(zone,name,method,fee_key) "
                + "VALUES('p2','IT园区级消防设施池','direct','share_elec_fire')");
        Integer rid = jdbc.queryForObject("SELECT MAX(id) FROM alloc_rule", Integer.class);
        jdbc.update("INSERT INTO alloc_rule_member(rule_id,tenant_id,acct_month) VALUES(?,?,'')", rid, ch[0]);
        jdbc.update("INSERT INTO alloc_pool_result(ym,rule_id,qty_total,cost_amount,generated_at) "
                + "VALUES(?,?,0,30,NOW())", ym, rid);

        generate(ym);
        String body = detail(soleNoticeId(ym, ch[0]));
        // 园区级池行经 splitShare 落到本合同场地(链归属判定的前提)
        Map<String, Object> fire = one(feeLines(body, "share_elec_fire"));
        assertThat(fire.get("premise")).isEqualTo("IT形态B区");
        Map<String, Object> loss = one(feeLines(body, "share_elec_loss"));
        assertThat(d(loss.get("baseSnap"))).isEqualTo(750.0);
        assertThat(d(loss.get("amount"))).isEqualTo(75.0);
    }

    // ── t35 消防照抄实收(S13 拍板③,曹小芳/刘彪 L24+L99 合成价):fire_amount_fixed 命中 →
    //    该户全部 share_elec_fire 行整组替换为一条固定额行,且时点在 E2 之前:
    //    损耗 base 的消防分量=实收合成额(base=720+88.88=808.88×0.1=80.89)。槽 2092-07。──
    @Test
    void t35_fireAmountFixed_replacesFireRowsBeforeE2() throws Exception {
        String ym = "2092-07";
        monthlyPrices(ym);
        int[] ch = lossChain(ym, "B", "1000", null);
        jdbc.update("INSERT INTO alloc_rule(zone,name,method,fee_key) "
                + "VALUES('p2','IT照抄消防池','direct','share_elec_fire')");
        Integer rid = jdbc.queryForObject("SELECT MAX(id) FROM alloc_rule", Integer.class);
        jdbc.update("INSERT INTO alloc_rule_member(rule_id,tenant_id,acct_month) VALUES(?,?,'')", rid, ch[0]);
        jdbc.update("INSERT INTO alloc_pool_result(ym,rule_id,qty_total,cost_amount,generated_at) "
                + "VALUES(?,?,0,30,NOW())", ym, rid);
        flag(ch[0], "fire_amount_fixed", "88.88");

        generate(ym);
        String body = detail(soleNoticeId(ym, ch[0]));
        Map<String, Object> fire = one(feeLines(body, "share_elec_fire"));   // one=断言仅一条(30 元原行已被吞)
        assertThat(d(fire.get("amount"))).isEqualTo(88.88);
        assertThat((String) fire.get("note")).contains("照抄源册实收");
        Map<String, Object> loss = one(feeLines(body, "share_elec_loss"));
        assertThat(d(loss.get("baseSnap"))).isEqualTo(808.88);
        assertThat(d(loss.get("amount"))).isEqualTo(80.89);

        // 固定 0=免收(S13 陈书谨钢构):吞掉原公摊行、不落新行,损耗 base 回到无消防口径。
        // fire_amount_fixed 不在价目白名单(白名单不放宽,S7 铁律),API PUT 会 400 → 裸 jdbc 改值;
        // 但裸 jdbc 不 evict 价目缓存(volatile 全表快照),再 PUT 一条白名单内月价触发 evict
        // (prod 同类 SQL 手术靠重启后端失效,IT 里用这条等价路径)。
        jdbc.update("UPDATE tenant_price_cfg SET cfg_value=0 WHERE scope=? AND cfg_key='fire_amount_fixed'",
                "tenant:" + ch[0]);
        mvc.perform(put("/api/price-cfg").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"scope\":\"\",\"cfgKey\":\"water\",\"acctMonth\":\"" + ym + "\",\"value\":4.2}"))
                .andExpect(jsonPath("$.code").value(0));
        generate(ym);
        String body2 = detail(soleNoticeId(ym, ch[0]));
        assertThat(feeLines(body2, "share_elec_fire")).isEmpty();
        assertThat(d(one(feeLines(body2, "share_elec_loss")).get("baseSnap"))).isEqualTo(720.0);
    }

    // ── t36 ref 价目直供池(S13 §4 V64 加价档):method='ref' 池 cost=null 不入池合计,
    //    但挂显式层份成员时按 std×weight 直供户级行(482.12×0.5=241.06)。槽 2092-08。──
    @Test
    void t36_refPoolWithWeights_billsStdTimesWeight() throws Exception {
        String ym = "2092-08";
        monthlyPrices(ym);
        int[] ch = lossChain(ym, "B", "0", null);
        jdbc.update("INSERT INTO alloc_rule(zone,name,method,fee_key) "
                + "VALUES('p2','IT加价档电梯池','ref','share_elec_elevator')");
        Integer rid = jdbc.queryForObject("SELECT MAX(id) FROM alloc_rule", Integer.class);
        jdbc.update("INSERT INTO alloc_rule_member(rule_id,tenant_id,weight,acct_month) VALUES(?,?,0.5,'')", rid, ch[0]);
        jdbc.update("INSERT INTO alloc_pool_result(ym,rule_id,qty_total,std_value,generated_at) "
                + "VALUES(?,?,0,482.12,NOW())", ym, rid);

        generate(ym);
        String body = detail(soleNoticeId(ym, ch[0]));
        Map<String, Object> lift = one(feeLines(body, "share_elec_elevator"));
        assertThat(d(lift.get("amount"))).isEqualTo(241.06);
    }

    // ── t37 S15 §4 拆场地比例剔除宿舍行:rentAreaByContract 只Σ非宿舍租金行(property_type='dorm' 或
    //    fee_key='rent_dorm' 的行不入;宿舍场地拆行已有 dormRooms 专径)。同栋两合同(纯厂房 100㎡ /
    //    厂房 100㎡+宿舍 100㎡),楼栋级 share 池 300 元:污染口径按 100:200 拆 100/200,修后按 100:100 拆 150/150。
    //    (锚:邓宇峰双场地拆比被宿舍行面积 248.79㎡ 稀释同型)。槽 2093-02。──
    @Test
    void t37_splitShare_dormRowsExcludedFromRatio() throws Exception {
        String ym = "2093-02";
        int t = createTenant("IT宿舍拆比户");
        int cA = contractLines(t, "2093-01-01", "2095-12-31", null,
                "[{\"propertyType\":\"factory\",\"location\":\"IT厂A\",\"feeKey\":\"rent_factory\",\"area\":100,\"unitPrice\":10}]");
        int cB = contractLines(t, "2093-01-01", "2095-12-31", null,
                "[{\"propertyType\":\"factory\",\"location\":\"IT厂B\",\"feeKey\":\"rent_factory\",\"area\":100,\"unitPrice\":10},"
                + "{\"propertyType\":\"dorm\",\"location\":\"IT宿舍201\",\"feeKey\":\"rent_dorm\",\"area\":100,\"unitPrice\":5}]");
        pool("IT宿舍拆比池", "share_elec_light", building(), t, ym, "300");

        generate(ym);
        // 宿舍租金行拆 dorm 单 → 该户 combined 单里看 share 行
        List<Map<String, Object>> combined = JsonPath.read(list(ym),
                "$.data[?(@.tenantId==" + t + " && @.noticeKind=='combined')]");
        String body = detail(((Number) one(combined).get("id")).intValue());
        List<Map<String, Object>> rows = feeLines(body, "share_elec_light");
        assertThat(rows).hasSize(2);
        Map<Integer, Double> byContract = new java.util.HashMap<>();
        for (Map<String, Object> r : rows) byContract.put((Integer) r.get("contractId"), d(r.get("amount")));
        assertThat(byContract.get(cA)).isEqualTo(150.0);
        assertThat(byContract.get(cB)).isEqualTo(150.0);
    }

    // ── t15 detail 池名 join(S5 §3.2):share 行 poolName=alloc_rule.name,非公摊行 null。
    //    读侧纯 join,无需跑池引擎:JDBC 直造 notice+行(槽 2090-11,与 t11 各自回滚不相扰) ──
    @Test
    void t15_detail_sharePoolName_joined() throws Exception {
        int t = createTenant("IT池名户");
        jdbc.update("INSERT INTO alloc_rule(zone,name,method,fee_key) "
                + "VALUES('p1','IT电梯池','direct','share_elec_elevator')");
        Integer rid = jdbc.queryForObject("SELECT MAX(id) FROM alloc_rule", Integer.class);
        jdbc.update("INSERT INTO bill_notice(ym,tenant_id,notice_kind,total_amount,prev_due,status,generated_at) "
                + "VALUES('2090-11',?,'combined',8,0,'draft',NOW())", t);
        Integer nid = jdbc.queryForObject("SELECT MAX(id) FROM bill_notice", Integer.class);
        jdbc.update("INSERT INTO bill_notice_line(notice_id,line_no,fee_key,pool_rule_id,amount,fee_group) "
                + "VALUES(?,1,'share_elec_elevator',?,5,'elec')", nid, rid);
        jdbc.update("INSERT INTO bill_notice_line(notice_id,line_no,fee_key,amount,fee_group) "
                + "VALUES(?,2,'elec',3,'elec')", nid);

        String body = detail(nid);
        Map<String, Object> share = one(feeLines(body, "share_elec_elevator"));
        assertThat(share.get("poolName")).isEqualTo("IT电梯池");
        assertThat(one(feeLines(body, "elec")).get("poolName")).isNull();
    }

    // ── 备注人工覆盖(V92)helpers ──

    private String notes(String ym, int tenantId) throws Exception {
        return new String(mvc.perform(get("/api/bill-notices/notes").param("ym", ym)
                .param("tenantId", String.valueOf(tenantId)).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private void putNote(String ym, int tenantId, int meterId, String note) throws Exception {
        mvc.perform(put("/api/bill-notices/notes").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"ym\":\"" + ym + "\",\"tenantId\":" + tenantId + ",\"feeKey\":\"elec\","
                        + "\"premiseKey\":\"\",\"meterKey\":\"" + meterId + "\",\"segKey\":\"\","
                        + "\"note\":\"" + note + "\"}"))
                .andExpect(jsonPath("$.code").value(0));
    }

    // ── t19 备注人工覆盖(V92):upsert→fetch→二次 upsert 仍一行→重生成后 override 存活且键仍挂得回
    //    新行(meter_id 稳定)→delete=恢复引擎默认。独立表挂业务键,先删后插重生成天然不丢。槽 2091-10 ──
    @Test
    void t19_noteOverride_upsertFetch_survivesRegenerate_delete() throws Exception {
        String ym = "2091-10";
        monthlyPrices(ym);
        int t = createTenant("IT备注覆盖户");
        int c = contract(t, "2089-01-01", "2099-12-31", null);
        int m = createMeter("elec", "p1", "IT备注覆盖电", t);
        bind(m, c);
        reading(m, ym, "\"prevTotal\":0,\"currTotal\":100");
        generate(ym);

        // upsert + fetch:普通行键=feeKey+premise(本例空)+meterId+seg(非分时空)
        putNote(ym, t, m, "手写备注一");
        List<Map<String, Object>> rows = JsonPath.read(notes(ym, t), "$.data");
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).get("note")).isEqualTo("手写备注一");
        assertThat(rows.get(0).get("meterKey")).isEqualTo(String.valueOf(m));
        // 二次 upsert 同键:仍一行,note 更新(uk_note_override 命中即改)
        putNote(ym, t, m, "手写备注二");
        rows = JsonPath.read(notes(ym, t), "$.data");
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).get("note")).isEqualTo("手写备注二");

        // 重生成(先删后插):override 存活,且新行同键(meter_id 稳定)——前端叠加仍能挂回
        generate(ym);
        rows = JsonPath.read(notes(ym, t), "$.data");
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).get("note")).isEqualTo("手写备注二");
        Map<String, Object> line = elecOfMeter(detail(soleNoticeId(ym, t)), m);
        assertThat(line.get("seg")).isNull();
        assertThat(line.get("premise")).isNull();   // 键三列与 override 空串键一致

        // delete=恢复引擎默认;幂等(再删不报错)
        mvc.perform(delete("/api/bill-notices/notes").header("Authorization", auth())
                .param("ym", ym).param("tenantId", String.valueOf(t))
                .param("feeKey", "elec").param("meterKey", String.valueOf(m)))
                .andExpect(jsonPath("$.code").value(0));
        assertThat(JsonPath.<List<?>>read(notes(ym, t), "$.data")).isEmpty();
        mvc.perform(delete("/api/bill-notices/notes").header("Authorization", auth())
                .param("ym", ym).param("tenantId", String.valueOf(t))
                .param("feeKey", "elec").param("meterKey", String.valueOf(m)))
                .andExpect(jsonPath("$.code").value(0));
    }

    // ── t20 备注覆盖权限:GET=已登录可读(viewer 200),写=admin(viewer PUT/DELETE 403;SecurityConfig 统一门) ──
    @Test
    void t20_noteOverride_viewerReadOnly() throws Exception {
        String vBody = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"viewer\",\"password\":\"viewer123\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String vAuth = "Bearer " + JsonPath.read(vBody, "$.data.token");
        mvc.perform(get("/api/bill-notices/notes").param("ym", "2091-10").param("tenantId", "1")
                .header("Authorization", vAuth))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
        mvc.perform(put("/api/bill-notices/notes").header("Authorization", vAuth)
                .contentType("application/json")
                .content("{\"ym\":\"2091-10\",\"tenantId\":1,\"feeKey\":\"elec\",\"note\":\"越权\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value(403));
        mvc.perform(delete("/api/bill-notices/notes").header("Authorization", vAuth)
                .param("ym", "2091-10").param("tenantId", "1").param("feeKey", "elec"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value(403));
    }

    // ── t21 交付状态流(S20 §1.3):draft→确认→(重生成跳过)→标记导出→(重生成仍跳过);
    //    已 void 单不参与流转。槽 2093-05。 ──
    @Test
    void t21_confirm_regenerateSkips_markExported() throws Exception {
        String ym = "2093-05";
        monthlyPrices(ym);
        int t = createTenant("IT交付状态户");
        int c = contract(t, "2089-01-01", "2099-12-31", null);
        int m = createMeter("elec", "p1", "IT交付状态电", t);
        bind(m, c);
        reading(m, ym, "\"prevTotal\":0,\"currTotal\":100");

        assertThat((int) JsonPath.read(generate(ym), "$.data.generated")).isEqualTo(1);
        int id = soleNoticeId(ym, t);
        assertThat(one(notices(ym, t)).get("status")).isEqualTo("draft");
        assertThat(one(notices(ym, t)).get("confirmedAt")).isNull();

        // 确认:draft→confirmed,落 confirmed_at
        String r1 = postOk("/api/bill-notices/confirm",
                "{\"ym\":\"" + ym + "\",\"tenantIds\":[" + t + "]}");
        assertThat((int) JsonPath.read(r1, "$.data.confirmed")).isEqualTo(1);
        assertThat((int) JsonPath.read(r1, "$.data.skipped")).isZero();
        Map<String, Object> row = one(notices(ym, t));
        assertThat(row.get("status")).isEqualTo("confirmed");
        assertThat(row.get("confirmedAt")).isNotNull();
        assertThat(row.get("exportedAt")).isNull();

        // 二次确认:非 draft 单只计 skipped
        String r2 = postOk("/api/bill-notices/confirm",
                "{\"ym\":\"" + ym + "\",\"tenantIds\":[" + t + "]}");
        assertThat((int) JsonPath.read(r2, "$.data.confirmed")).isZero();
        assertThat((int) JsonPath.read(r2, "$.data.skipped")).isEqualTo(1);

        // 重新生成:已确认户整户跳过,单 id 与状态不动(这是防静默覆盖的闸门)
        String g = generate(ym);
        assertThat((int) JsonPath.read(g, "$.data.skippedConfirmed")).isEqualTo(1);
        assertThat((int) JsonPath.read(g, "$.data.generated")).isZero();
        assertThat(((Number) one(notices(ym, t)).get("id")).intValue()).isEqualTo(id);
        assertThat(one(notices(ym, t)).get("status")).isEqualTo("confirmed");

        // 标记导出:confirmed→exported,落 exported_at;重生成仍跳过
        String e1 = postOk("/api/bill-notices/mark-exported",
                "{\"ym\":\"" + ym + "\",\"tenantIds\":[" + t + "]}");
        assertThat((int) JsonPath.read(e1, "$.data.marked")).isEqualTo(1);
        row = one(notices(ym, t));
        assertThat(row.get("status")).isEqualTo("exported");
        assertThat(row.get("exportedAt")).isNotNull();
        assertThat((int) JsonPath.read(generate(ym), "$.data.skippedConfirmed")).isEqualTo(1);

        // 作废后不再参与流转:确认只计 skipped,标记导出不改状态
        postOk("/api/bill-notices/" + id + "/void", "{}");
        String r3 = postOk("/api/bill-notices/confirm",
                "{\"ym\":\"" + ym + "\",\"tenantIds\":[" + t + "]}");
        assertThat((int) JsonPath.read(r3, "$.data.confirmed")).isZero();
        assertThat((int) JsonPath.read(r3, "$.data.skipped")).isEqualTo(1);
        assertThat((int) JsonPath.read(postOk("/api/bill-notices/mark-exported",
                "{\"ym\":\"" + ym + "\",\"tenantIds\":[" + t + "]}"), "$.data.marked")).isZero();
        assertThat(one(notices(ym, t)).get("status")).isEqualTo("void");
    }
}
