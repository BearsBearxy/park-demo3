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

// 计费参数中心(S21-PARAM-CENTER-SPEC §5/§6):读侧(站在账期的生效行/人话/区间/命中链/状态条)+ 写侧(PUT/改错/删版本/历史/重算/旧端点)。
// 读侧断言靠种子(V65 池/V97 口径版本链),但**对象 id 一律现查**(JdbcTemplate):种子库的池 id 与 dev 差 1(V70 按 dev id 硬编码
// 改名 → 种子库里「招商中心净电」的月参挂在别名的池上),按名断言会假红;楼栋按名查(V65/V97 都按名落行)。
// @Transactional 回滚;写路径月份用 2099-04 / 2099-10 / 2099-11 槽。
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

    /** PUT /api/params → 200 + code 0 → 返回行 */
    private Map<String, Object> putRow(String json, String ym) throws Exception {
        var req = put("/api/params").header("Authorization", auth()).contentType("application/json").content(json);
        if (ym != null) req = req.param("ym", ym);
        String b = body(mvc.perform(req).andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0)));
        return JsonPath.read(b, "$.data");
    }

    /** PUT /api/params → 业务错 HTTP 200 + code 400 */
    private void put400(String json) throws Exception {
        mvc.perform(put("/api/params").header("Authorization", auth()).contentType("application/json").content(json))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(400));
    }

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

    // ══════════ 写侧 ══════════

    // ── ①② month 行仅当月命中 / from 行前滚;返回行站在 ym;户级例外命中链到全园;改错原地 + 上级作用域改错 400;历史 ──
    @Test
    void put_month_from_correction_history() throws Exception {
        String b = "building:" + buildingId("一期 B座");
        // ① month 行:2099-04 命中,2099-05 不命中(ym 参数直接站在次月看)
        Map<String, Object> r = putRow("{\"key\":\"loss_adj_qty\",\"scope\":\"" + b + "\",\"acctMonth\":\"2099-04\",\"mode\":\"month\",\"value\":-8000,\"note\":\"IT-D5\"}", null);
        assertEquals(-8000.0, num(r.get("value")));
        assertEquals("month", r.get("mode"));
        assertEquals("仅 2099-04", r.get("rangeText"));
        assertEquals(true, r.get("hasMonthRow"));
        assertNotNull(r.get("rowId"));
        assertEquals("IT-D5", r.get("note"));
        Map<String, Object> next = putRow("{\"key\":\"loss_adj_qty\",\"scope\":\"" + b + "\",\"acctMonth\":\"2099-04\",\"mode\":\"month\",\"value\":-8000}", "2099-05");
        assertNotEquals(-8000.0, next.get("value") == null ? null : num(next.get("value")));
        assertEquals(false, next.get("hasMonthRow"));
        assertEquals(-8000.0, num(one(rows("2099-04", "p1"), "loss_adj_qty", b).get("value")));
        // ② from 行(mode 缺省=注册表 from):2099-04 起 → 2099-06 命中,区间「2099-04 起长期」
        Map<String, Object> f = putRow("{\"key\":\"loss_adj_rate\",\"scope\":\"" + b + "\",\"acctMonth\":\"2099-04\",\"value\":0.005}", "2099-06");
        assertEquals(0.005, num(f.get("value")));
        assertEquals("from", f.get("mode"));
        assertEquals("2099-04 起长期", f.get("rangeText"));
        // 户级例外:命中链 户 → 全园(全园 0.16 长期);tenant 不存在也可写(与旧价目端点同)
        Map<String, Object> t = putRow("{\"key\":\"mgmt_fee\",\"scope\":\"tenant:999999\",\"acctMonth\":\"\",\"value\":0.15}", "2099-06");
        List<?> chain = (List<?>) t.get("sourceChain");
        assertTrue(chain.size() >= 2, chain.toString());
        assertEquals("已删租户#999999（户）:0.15 元/度", chain.get(0));
        assertEquals("全园:0.16 元/度", chain.get(chain.size() - 1));
        assertEquals("constant", t.get("group"));   // group=键主场;户级行归 ④ 由前端按 scope 判(paramCenterLogic.groupRows)
        // ③ 改错:站在 2099-06 命中 2099-04 起的 from 行 → 原地改 0.006,不新增版本;上级作用域继承值改错 → 400
        Map<String, Object> c = putRow("{\"key\":\"loss_adj_rate\",\"scope\":\"" + b + "\",\"acctMonth\":\"2099-06\",\"value\":0.006,\"correction\":true}", "2099-06");
        assertEquals(0.006, num(c.get("value")));
        assertEquals("2099-04", c.get("acctMonth"));
        assertEquals("2099-04 起长期", c.get("rangeText"));
        put400("{\"key\":\"loss_denom_cable\",\"scope\":\"building:" + buildingId("二期 三车间") + "\",\"acctMonth\":\"2099-04\",\"value\":0,\"correction\":true}");
        // ⑥ 历史:2099-04 版本只一条且已改成 0.006(改错不新增版本;B座另有种子 2024-02 起的 0.003 版本与其 migrate 日志)
        //    该版本的日志 2 条(倒序:改错 old 0.005→new 0.006 在前,首建 old null 在后)
        String h = body(mvc.perform(get("/api/params/history").param("key", "loss_adj_rate").param("scope", b).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0)));
        List<Map<String, Object>> versions = JsonPath.read(h, "$.data.versions");
        List<Map<String, Object>> v04 = versions.stream().filter(v -> "2099-04".equals(v.get("acctMonth"))).toList();
        assertEquals(1, v04.size(), versions.toString());
        assertEquals(0.006, num(v04.get(0).get("value")));
        assertEquals("2099-04 起长期", v04.get(0).get("rangeText"));
        List<Map<String, Object>> changes = JsonPath.read(h, "$.data.changes");
        List<Map<String, Object>> c04 = changes.stream().filter(x -> "2099-04".equals(x.get("acctMonth"))).toList();
        assertEquals(2, c04.size(), changes.toString());
        assertEquals("set", c04.get(0).get("action"));
        assertEquals(0.005, num(c04.get(0).get("oldValue")));
        assertEquals(0.006, num(c04.get(0).get("newValue")));
        assertEquals("改错", c04.get(0).get("note"));
        assertEquals("admin", c04.get(0).get("actor"));
        assertEquals("一期 B座", c04.get(0).get("scopeLabel"));
        assertNull(c04.get(1).get("oldValue"));
        assertEquals(0.005, num(c04.get(1).get("newValue")));
    }

    // ── ④ 注册表门:退役键 / 未注册键 / 作用域形态不允许 / 月变键缺月 → 400 ──
    @Test
    void put_registryGate_400() throws Exception {
        String b = "building:" + buildingId("一期 B座");
        put400("{\"key\":\"loss_g_adj\",\"scope\":\"" + b + "\",\"value\":-1}");
        put400("{\"key\":\"no_such_key\",\"scope\":\"\",\"value\":1}");
        put400("{\"key\":\"loss_variant\",\"scope\":\"p1\",\"value\":1}");
        put400("{\"key\":\"elec_peak\",\"scope\":\"\",\"value\":1.2}");
        put400("{\"key\":\"loss_adj_qty\",\"scope\":\"" + b + "\",\"acctMonth\":\"\",\"mode\":\"month\",\"value\":1}");
        // 值域:枚举不在字典 / 布尔非 0|1 / 引用型非整数 → 400
        put400("{\"key\":\"loss_variant\",\"scope\":\"" + b + "\",\"value\":5}");
        put400("{\"key\":\"loss_recon\",\"scope\":\"" + b + "\",\"value\":2}");
        put400("{\"key\":\"loss_head\",\"scope\":\"" + b + "\",\"value\":1.5}");
        // 校验错 HTTP 400:scope 形态非法 / 月份格式
        mvc.perform(put("/api/params").header("Authorization", auth()).contentType("application/json")
                .content("{\"key\":\"water\",\"scope\":\"p9\",\"value\":1}")).andExpect(status().isBadRequest());
        mvc.perform(put("/api/params").header("Authorization", auth()).contentType("application/json")
                .content("{\"key\":\"water\",\"scope\":\"\",\"acctMonth\":\"2099/01\",\"value\":1}")).andExpect(status().isBadRequest());
    }

    // ── ⑤⑦ 重算 → 状态条与快照一致 → 删被使用版本 400 / 未使用版本可删 → 再改参 stale → 变更记录含 recalc ──
    @Test
    void recalc_status_deleteUsedVersion() throws Exception {
        String ym = "2099-10";
        for (String k : List.of("elec_commercial", "elec_sharp", "elec_peak", "elec_flat", "elec_valley"))
            putRow("{\"key\":\"" + k + "\",\"scope\":\"\",\"acctMonth\":\"" + ym + "\",\"value\":1.0}", null);
        String pool = "rule:" + jdbc.queryForObject("select r.id from alloc_rule r where r.zone='p1' and r.method='direct' and not exists"
                + " (select 1 from alloc_cfg c where c.scope=concat('rule:', r.id) and c.cfg_key='extra_qty' and c.acct_month='') order by r.id limit 1", Integer.class);
        putRow("{\"key\":\"extra_qty\",\"scope\":\"" + pool + "\",\"acctMonth\":\"" + ym + "\",\"value\":-100}", null);
        mvc.perform(get("/api/params/status").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.data.priceOk").value(5))
                .andExpect(jsonPath("$.data.stale").value(false))          // 未生成过 → 无快照可过期
                .andExpect(jsonPath("$.data.pendingChanges").value(6));
        String rc = body(mvc.perform(post("/api/params/recalc").param("ym", ym).header("Authorization", auth()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0)));
        int pools = jdbc.queryForObject("select count(*) from alloc_pool_result where ym=?", Integer.class, ym);
        int units = jdbc.queryForObject("select count(*) from alloc_loss_result where ym=?", Integer.class, ym);
        assertTrue(pools > 0);
        assertEquals(pools, (int) JsonPath.read(rc, "$.data.pools"));
        assertEquals(units, (int) JsonPath.read(rc, "$.data.lossUnits"));
        assertEquals(0, (int) JsonPath.read(rc, "$.data.skippedConfirmed"));
        mvc.perform(get("/api/params/status").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.data.stale").value(false))
                .andExpect(jsonPath("$.data.pendingChanges").value(0))
                .andExpect(jsonPath("$.data.poolSnapshotAt").isNotEmpty());
        // 删被 2099-10 使用的月行 → 400;2099-11 月行未被使用 → 可删,回读值空
        put400("{\"key\":\"extra_qty\",\"scope\":\"" + pool + "\",\"acctMonth\":\"" + ym + "\",\"value\":null}");
        putRow("{\"key\":\"extra_qty\",\"scope\":\"" + pool + "\",\"acctMonth\":\"2099-11\",\"value\":-50}", null);
        Map<String, Object> gone = putRow("{\"key\":\"extra_qty\",\"scope\":\"" + pool + "\",\"acctMonth\":\"2099-11\",\"value\":null}", null);
        assertNull(gone.get("value"));
        assertEquals(false, gone.get("hasMonthRow"));
        // 重算后再改本月参数 → stale + 待重算 1 项;变更记录含 recalc 与本次 set,倒序
        Thread.sleep(1100);   // ts / generated_at 都是 DATETIME(0):同一秒内的改动分不出先后,判据是「严格晚于快照那一秒」
        putRow("{\"key\":\"extra_qty\",\"scope\":\"" + pool + "\",\"acctMonth\":\"" + ym + "\",\"value\":-120}", null);
        mvc.perform(get("/api/params/status").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.data.stale").value(true))
                .andExpect(jsonPath("$.data.pendingChanges").value(1));
        String ch = body(mvc.perform(get("/api/params/changes").param("ym", ym).header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0)));
        List<Map<String, Object>> changes = JsonPath.read(ch, "$.data");
        assertEquals("set", changes.get(0).get("action"));
        assertEquals(-120.0, num(changes.get(0).get("newValue")));
        assertEquals(1, changes.stream().filter(c -> "recalc".equals(c.get("action")) && ym.equals(c.get("ym"))).count());
        assertTrue(changes.stream().noneMatch(c -> "migrate".equals(c.get("action"))));
        // 2099-11 的 set/delete 不影响 2099-10 的记录
        assertTrue(changes.stream().noneMatch(c -> "2099-11".equals(c.get("acctMonth"))));
    }

    // ── ⑧ 旧端点 PUT /api/price-cfg、PUT /api/alloc/cfg 仍可写且走同一日志;/alloc/cfg 带月缺省 month ──
    @Test
    void legacyEndpoints_writeThroughParamService() throws Exception {
        mvc.perform(put("/api/price-cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"\",\"cfgKey\":\"water\",\"acctMonth\":\"2099-04\",\"value\":4.2}"))
                .andExpect(jsonPath("$.code").value(0));
        String h = body(mvc.perform(get("/api/params/history").param("key", "water").param("scope", "").header("Authorization", auth())));
        List<Map<String, Object>> ch = JsonPath.read(h, "$.data.changes");
        assertEquals("set", ch.get(0).get("action"));
        assertEquals("2099-04", ch.get(0).get("acctMonth"));
        assertEquals("from", ch.get(0).get("mode"));
        assertEquals(4.2, num(ch.get(0).get("newValue")));
        Map<String, Object> w = one(rows("2099-05", "all"), "water", "");
        assertEquals("4.2 元/吨", w.get("valueText"));
        assertEquals("2099-04 起长期", w.get("rangeText"));
        String b = "building:" + buildingId("一期 B座");
        mvc.perform(put("/api/alloc/cfg").header("Authorization", auth()).contentType("application/json")
                .content("{\"scope\":\"" + b + "\",\"cfgKey\":\"loss_adj_qty\",\"acctMonth\":\"2099-11\",\"value\":-1}"))
                .andExpect(jsonPath("$.code").value(0));
        Map<String, Object> a = one(rows("2099-11", "all"), "loss_adj_qty", b);
        assertEquals("仅 2099-11", a.get("rangeText"));
        assertEquals(true, a.get("hasMonthRow"));
        String h2 = body(mvc.perform(get("/api/params/history").param("key", "loss_adj_qty").param("scope", b).header("Authorization", auth())));
        List<Map<String, Object>> ch2 = JsonPath.read(h2, "$.data.changes");
        assertEquals("month", ch2.get(0).get("mode"));
        assertEquals(-1.0, num(ch2.get(0).get("newValue")));
    }
}
