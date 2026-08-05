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
// @Transactional 回滚;月份槽独占 2090-01..2090-10,每用例一槽(generate 先删本 ym 全部 draft,共槽互删);
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
        reading(dr, ym, "\"prevTotal\":0,\"currTotal\":50");   // 居民 30 + mgmt 8 + 宿舍损耗 30×0.012=0.36(§3⑦) → dorm 单/公司2
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
        assertThat(d(dorm.get(0).get("totalAmount"))).isEqualTo(38.36);
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
}
