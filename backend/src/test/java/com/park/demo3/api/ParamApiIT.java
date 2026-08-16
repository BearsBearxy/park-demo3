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
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 计费参数中心(S21-PARAM-CENTER-SPEC §5/§6):读侧(站在账期的生效行/人话/区间/命中链/状态条)(写侧用例见 Task 8)。
// 读侧断言靠种子(V65 池/V97 口径版本链),但**对象 id 一律现查**(JdbcTemplate):种子库的池 id 与 dev 差 1(V70 按 dev id 硬编码
// 改名 → 种子库里「招商中心净电」的月参挂在别名的池上),按名断言会假红;楼栋按名查(V65/V97 都按名落行)。
// @Transactional 回滚;状态条探针月用 2099-04(本类只读)。
@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class ParamApiIT extends AbstractMysqlIT {

    // 页面禁词(spec §5.2/§8.4,与前端 forbiddenText 同一正则):作用域名/值文案/区间文案不得出现字段值与内部标识
    static final Pattern FORBIDDEN = Pattern.compile("(p1|p2|dorm|building:|rule:|meter:|tenant:|默认·所有月份)");

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

    private String body(org.springframework.test.web.servlet.ResultActions ra) throws Exception {
        return new String(ra.andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private List<Map<String, Object>> rows(String ym, String zone) throws Exception {
        String b = body(mvc.perform(get("/api/params").param("ym", ym).param("zone", zone).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0)));
        return JsonPath.read(b, "$.data");
    }

    private static Map<String, Object> one(List<Map<String, Object>> rows, String key, String scope) {
        return rows.stream().filter(r -> key.equals(r.get("key")) && scope.equals(r.get("scope")))
                .findFirst().orElseThrow(() -> new AssertionError("无此行: " + key + " @ " + scope));
    }

    private static double num(Object o) { return ((Number) o).doubleValue(); }

    private int buildingId(String name) {
        return jdbc.queryForObject("select id from building where name=? order by id limit 1", Integer.class, name);
    }

    // ══════════ 读侧 ══════════

    // ── ① 栋级口径:B座 2024-02 命中 2023-11 起的纯公摊版本;人话与区间;命中链首项=本栋;二期栋级「分母含铝缆」继承期级版本 ──
    @Test
    void list_lossVariant_versionChain_humanText() throws Exception {
        String bScope = "building:" + buildingId("一期 B座");
        Map<String, Object> b = one(rows("2024-02", "all"), "loss_variant", bScope);
        assertEquals("rule", b.get("group"));
        assertEquals("一期 B座", b.get("scopeLabel"));
        assertEquals(1.0, num(b.get("value")));
        assertTrue(String.valueOf(b.get("valueText")).contains("纯公摊"), b.toString());
        assertEquals("from", b.get("mode"));
        assertEquals("2023-11", b.get("acctMonth"));
        assertEquals("2023-11 起长期", b.get("rangeText"));
        assertNotNull(b.get("rowId"));   // 命中行就在本栋 → 可「改错」
        List<?> chain = (List<?>) b.get("sourceChain");
        assertEquals(1, chain.size());
        assertTrue(String.valueOf(chain.get(0)).startsWith("一期 B座:"), chain.toString());
        // 2023-10 站在初始版本(净额式),区间右端由 2023-11 版本推出
        Map<String, Object> b10 = one(rows("2023-10", "all"), "loss_variant", bScope);
        assertEquals(0.0, num(b10.get("value")));
        assertEquals("初始版本 ~ 2023-10", b10.get("rangeText"));
        assertTrue(String.valueOf(b10.get("valueText")).contains("正常核算"));
        // 二期期级「分母含铝缆」版本链(V97):2023-08 含铝缆(初始版本 ~ 2023-09),2023-10 起不含
        Map<String, Object> cable = one(rows("2023-08", "p2"), "loss_denom_cable", "p2");
        assertEquals("分母 = 总表 + 铝缆", cable.get("valueText"));
        assertEquals("初始版本 ~ 2023-09", cable.get("rangeText"));
        assertNotNull(cable.get("rowId"));
        Map<String, Object> cable24 = one(rows("2024-02", "p2"), "loss_denom_cable", "p2");
        assertEquals("分母 = 总表", cable24.get("valueText"));
        assertEquals("2023-10 起长期", cable24.get("rangeText"));
        // 二期栋级(三车间,V65 铝缆表挂栋)无自有行 → 继承期级;命中链来自「二期」;不可原地改错
        String c3 = "building:" + buildingId("二期 三车间");
        Map<String, Object> inh = one(rows("2023-08", "p2"), "loss_denom_cable", c3);
        assertEquals("分母 = 总表 + 铝缆", inh.get("valueText"));
        assertEquals("初始版本 ~ 2023-09", inh.get("rangeText"));
        assertNull(inh.get("rowId"));
        assertEquals(List.of("二期:分母 = 总表 + 铝缆"), inh.get("sourceChain"));
        assertEquals("二期 三车间", inh.get("scopeLabel"));
    }

    // ── ②③ 池月参:招商中心净电 2024-02 扣度 −670「仅 2024-02」;2023-08 无行显空(默认扣度已归 0);基数键池只读分母行 ──
    @Test
    void list_poolExtraQty_monthRow_and_emptyDefault() throws Exception {
        String zs = jdbc.queryForObject("select scope from alloc_cfg where cfg_key='extra_qty' and acct_month='2024-02'"
                + " and cfg_value=-670 order by id limit 1", String.class);
        Map<String, Object> r = one(rows("2024-02", "all"), "extra_qty", zs);
        assertEquals("monthly", r.get("group"));
        assertEquals(-670.0, num(r.get("value")));
        assertEquals("month", r.get("mode"));
        assertEquals("仅 2024-02", r.get("rangeText"));
        assertEquals(true, r.get("hasMonthRow"));
        assertEquals("-670 度", r.get("valueText"));
        assertTrue(String.valueOf(r.get("scopeLabel")).endsWith("（池）"), r.toString());
        Map<String, Object> r08 = one(rows("2023-08", "all"), "extra_qty", zs);
        assertNull(r08.get("value"));
        assertEquals("", r08.get("valueText"));
        assertEquals("", r08.get("rangeText"));
        assertEquals(false, r08.get("hasMonthRow"));
        assertNull(r08.get("mode"));
        // V97 补的 2023-12 −1470 月行(按 book_key 定位;种子库无该键时为空 → 只在有行时断言)
        List<String> dec = jdbc.queryForList("select scope from alloc_cfg where cfg_key='extra_qty' and acct_month='2023-12'", String.class);
        if (!dec.isEmpty()) assertEquals(-1470.0, num(one(rows("2023-12", "all"), "extra_qty", dec.get(0)).get("value")));
        // 基数键池(A东侧货梯 base_key=elevator_area_base):不出可编辑分母行,改只读「分母 = … （价目参数）」并按版本链取值
        String elev = "rule:" + jdbc.queryForObject("select id from alloc_rule where base_key='elevator_area_base' and zone='p1' order by id limit 1", Integer.class);
        Map<String, Object> e = one(rows("2024-02", "p1"), "coefficient", elev);
        assertEquals(false, e.get("editable"));
        assertTrue(String.valueOf(e.get("valueText")).startsWith("分母 = A座电梯面积基数 12487.04"), e.toString());
        assertEquals("2024-02 起长期", e.get("rangeText"));
        Map<String, Object> e08 = one(rows("2023-08", "p1"), "coefficient", elev);
        assertTrue(String.valueOf(e08.get("valueText")).contains("14818.35"), e08.toString());
        assertEquals("初始版本 ~ 2023-08", e08.get("rangeText"));
    }

    // ── ④ 人话:全部行 label/valueText/scopeLabel/rangeText/sourceChain 无字段值与内部标识;zone 过滤只出该期对象 ──
    @Test
    void list_noInternalIds_zoneFilter() throws Exception {
        Map<Integer, String> ruleZone = new java.util.HashMap<>();
        for (Map<String, Object> m : jdbc.queryForList("select id, zone from alloc_rule"))
            ruleZone.put(((Number) m.get("id")).intValue(), (String) m.get("zone"));
        for (String zone : List.of("all", "p1", "p2", "dorm")) {
            List<Map<String, Object>> all = rows("2024-02", zone);
            assertFalse(all.isEmpty());
            for (Map<String, Object> r : all) {
                for (String f : List.of("label", "valueText", "scopeLabel", "rangeText"))
                    assertFalse(FORBIDDEN.matcher(String.valueOf(r.get(f))).find(), f + " 含禁词: " + r);
                for (Object c : (List<?>) r.get("sourceChain"))
                    assertFalse(FORBIDDEN.matcher(String.valueOf(c)).find(), "sourceChain 含禁词: " + r);
                assertTrue(List.of("monthly", "constant", "rule", "tenant").contains(r.get("group")), r.toString());
                String s = (String) r.get("scope");
                if (!"all".equals(zone)) {
                    if (s.equals("p1") || s.equals("p2") || s.equals("dorm")) assertEquals(zone, s, r.toString());
                    if (s.startsWith("rule:")) assertEquals(zone, ruleZone.get(Integer.parseInt(s.substring(5))), r.toString());
                }
            }
        }
        // 全园视图:栋级口径键对每个损耗栋都出行(即使无行);全园常数含 mgmt_fee 全园 0.16 长期
        List<Map<String, Object>> all = rows("2024-02", "all");
        assertTrue(all.stream().anyMatch(r -> "loss_variant".equals(r.get("key")) && "一期 A座".equals(r.get("scopeLabel"))), "A座 loss_variant 应出行");
        assertTrue(all.stream().anyMatch(r -> "loss_variant".equals(r.get("key")) && "二期 三车间".equals(r.get("scopeLabel"))), "三车间 loss_variant 应出行");
        Map<String, Object> mgmt = one(all, "mgmt_fee", "");
        assertEquals("constant", mgmt.get("group"));
        assertEquals("全园", mgmt.get("scopeLabel"));
        assertEquals("0.16 元/度", mgmt.get("valueText"));
        assertEquals("长期（初始版本）", mgmt.get("rangeText"));
        // 电价键 2024-02:全园月行 → 「仅 2024-02」+ hasMonthRow + 月核对项
        Map<String, Object> peak = one(rows("2024-02", "p1"), "elec_peak", "");
        assertEquals("仅 2024-02", peak.get("rangeText"));
        assertEquals(true, peak.get("hasMonthRow"));
        assertEquals(true, peak.get("monthlyCheck"));
    }

    // ── ⑤ 状态条:2024-02 电价 6/6;种子未生成月 → 快照空、不 stale;校验错 HTTP 400 ──
    @Test
    void status_priceOk_snapshotAbsent() throws Exception {
        mvc.perform(get("/api/params/status").param("ym", "2024-02").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.priceOk").value(6))
                .andExpect(jsonPath("$.data.priceTotal").value(6));
        mvc.perform(get("/api/params/status").param("ym", "2099-04").header("Authorization", auth()))
                .andExpect(jsonPath("$.data.priceOk").value(0))
                .andExpect(jsonPath("$.data.stale").value(false))
                .andExpect(jsonPath("$.data.poolSnapshotAt").isEmpty());
        mvc.perform(get("/api/params").param("ym", "2024-2").header("Authorization", auth()))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/params").param("ym", "2024-02").param("zone", "p9").header("Authorization", auth()))
                .andExpect(status().isBadRequest());
    }
}
