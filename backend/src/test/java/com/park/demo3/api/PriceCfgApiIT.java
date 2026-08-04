package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.service.PriceCfgService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 价目管理 v2 版本链(PRICE-CFG-SPEC §3/§4/§7):全量读+updatedAt/V62 删键/常数键前滚/月变键不前滚/
// 月变键禁''行/copy 只复制月变键。@Transactional 回滚;写路径月份用 2099-XX 槽;探针模式禁顺序依赖断言。
@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class PriceCfgApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired PriceCfgService svc;
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

    private void putCfg(String json) throws Exception {
        mvc.perform(put("/api/price-cfg").header("Authorization", auth())
                .contentType("application/json").content(json))
                .andExpect(jsonPath("$.code").value(0));
    }

    // ── GET 整表全量:种子回读 + updatedAt 非空 + V62 已删五键不复现 ──
    @Test
    void listAll_seed_updatedAt_v62Purge() throws Exception {
        String body = mvc.perform(get("/api/price-cfg").header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data[?(@.cfgKey=='elec_peak'&&@.acctMonth=='2024-02')].value").value(1.20606875))
                .andExpect(jsonPath("$.data[?(@.scope=='dorm'&&@.cfgKey=='water'&&@.acctMonth=='')].value").value(3.85))
                .andExpect(jsonPath("$.data[?(@.scope==''&&@.cfgKey=='water'&&@.acctMonth=='')].value").value(3.95))
                // V62:月推输出键彻底移出价目簿
                .andExpect(jsonPath("$.data[?(@.cfgKey=='green_water')]").doesNotExist())
                .andExpect(jsonPath("$.data[?(@.cfgKey=='green_water_hi')]").doesNotExist())
                .andExpect(jsonPath("$.data[?(@.cfgKey=='lamp_sqm')]").doesNotExist())
                .andExpect(jsonPath("$.data[?(@.cfgKey=='fire_sqm')]").doesNotExist())
                .andExpect(jsonPath("$.data[?(@.cfgKey=='elevator_sqm')]").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        List<Object> ts = JsonPath.read(body, "$.data[?(@.cfgKey=='elec_peak'&&@.acctMonth=='2024-02')].updatedAt");
        assertEquals(1, ts.size());
        assertNotNull(ts.get(0));
    }

    // ── upsert 建行→同键更新单行不重复;tenant: scope 联租户表(已删显"已删租户#id") ──
    @Test
    void upsert_update_tenantName() throws Exception {
        putCfg("{\"scope\":\"\",\"cfgKey\":\"water\",\"acctMonth\":\"2099-01\",\"value\":4.2}");
        mvc.perform(get("/api/price-cfg").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.scope==''&&@.cfgKey=='water'&&@.acctMonth=='2099-01')].value").value(4.2));
        putCfg("{\"scope\":\"\",\"cfgKey\":\"water\",\"acctMonth\":\"2099-01\",\"value\":4.5,\"note\":\"IT更新\"}");
        mvc.perform(get("/api/price-cfg").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.scope==''&&@.cfgKey=='water'&&@.acctMonth=='2099-01'&&@.value==4.5)].note").value("IT更新"))
                .andExpect(jsonPath("$.data[?(@.scope==''&&@.cfgKey=='water'&&@.acctMonth=='2099-01'&&@.value==4.2)]").doesNotExist());
        // 户级初始版本行:不存在的租户 id 显"已删租户#id"
        putCfg("{\"scope\":\"tenant:999999\",\"cfgKey\":\"mgmt_fee\",\"value\":0.15}");
        mvc.perform(get("/api/price-cfg").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.scope=='tenant:999999'&&@.cfgKey=='mgmt_fee')].tenantName").value("已删租户#999999"));
    }

    // ── value=null 删该版本行:有行删、无行零操作 ──
    @Test
    void nullValue_deletesVersionRow() throws Exception {
        putCfg("{\"scope\":\"\",\"cfgKey\":\"water\",\"acctMonth\":\"2099-02\",\"value\":9.9}");
        mvc.perform(get("/api/price-cfg").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.scope==''&&@.cfgKey=='water'&&@.acctMonth=='2099-02')]").exists());
        putCfg("{\"scope\":\"\",\"cfgKey\":\"water\",\"acctMonth\":\"2099-02\"}");
        mvc.perform(get("/api/price-cfg").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.scope==''&&@.cfgKey=='water'&&@.acctMonth=='2099-02')]").doesNotExist())
                .andExpect(jsonPath("$.data[?(@.scope==''&&@.cfgKey=='water'&&@.acctMonth=='')].value").value(3.95));
        // 无行再删=零操作,仍 code 0
        putCfg("{\"scope\":\"\",\"cfgKey\":\"water\",\"acctMonth\":\"2099-02\"}");
    }

    // ── §3 版本链 resolve(@Autowired service 直测):常数键前滚,月变键不前滚,scope 级联首中即返 ──
    @Test
    void resolve_versionChain() throws Exception {
        // 常数键前滚:种子 '' 初始版本 3.95;2099-05 写新版本 → 2099-06 取新值,2099-04 仍旧值
        putCfg("{\"scope\":\"\",\"cfgKey\":\"water\",\"acctMonth\":\"2099-05\",\"value\":4.2}");
        assertEquals(0, svc.resolve("water", "2099-06", null, null).compareTo(new BigDecimal("4.2")));
        assertEquals(0, svc.resolve("water", "2099-04", null, null).compareTo(new BigDecimal("3.95")));
        // scope 级联:dorm 级命中(3.85)即返,不看全园更新版本;户级压过分区
        assertEquals(0, svc.resolve("water", "2099-06", null, "dorm").compareTo(new BigDecimal("3.85")));
        putCfg("{\"scope\":\"tenant:424242\",\"cfgKey\":\"water\",\"value\":4.45}");
        assertEquals(0, svc.resolve("water", "2099-06", 424242, "dorm").compareTo(new BigDecimal("4.45")));
        // 月变键不前滚:2099-05 写 elec_peak → 当月命中,2099-06 取 null(缺当月版本=派生门禁拦截)
        putCfg("{\"scope\":\"\",\"cfgKey\":\"elec_peak\",\"acctMonth\":\"2099-05\",\"value\":1.6}");
        assertEquals(0, svc.resolve("elec_peak", "2099-05", null, null).compareTo(new BigDecimal("1.6")));
        assertNull(svc.resolve("elec_peak", "2099-06", null, null));
        // 全链空 → null(elec_package 无任何行)
        assertNull(svc.resolve("elec_package", "2099-06", null, null));
    }

    // ── S4-0.1 resolveHit:命中行带 scope+版本生效月(出账 price_scope/price_month 审计链);查无=null 同 resolve ──
    @Test
    void resolveHit_scopeAndAcctMonth() throws Exception {
        // 常数键前滚:'' 链 2095-05 写新版本 → 2095-06 命中该版本行;2095-04 回落 '' 初始版本
        putCfg("{\"scope\":\"\",\"cfgKey\":\"water\",\"acctMonth\":\"2095-05\",\"value\":4.2}");
        PriceCfgService.PriceHit h = svc.resolveHit("water", "2095-06", null, null);
        assertEquals("", h.scope());
        assertEquals("2095-05", h.acctMonth());
        assertEquals(0, h.value().compareTo(new BigDecimal("4.2")));
        h = svc.resolveHit("water", "2095-04", null, null);
        assertEquals("", h.scope());
        assertEquals("", h.acctMonth());
        assertEquals(0, h.value().compareTo(new BigDecimal("3.95")));
        // zone 命中:dorm 种子初始版本 3.85,scope 级联不看全园行
        h = svc.resolveHit("water", "2095-06", null, "dorm");
        assertEquals("dorm", h.scope());
        assertEquals("", h.acctMonth());
        assertEquals(0, h.value().compareTo(new BigDecimal("3.85")));
        // tenant:{id} 压过分区
        putCfg("{\"scope\":\"tenant:424243\",\"cfgKey\":\"water\",\"value\":4.45}");
        h = svc.resolveHit("water", "2095-06", 424243, "dorm");
        assertEquals("tenant:424243", h.scope());
        assertEquals("", h.acctMonth());
        assertEquals(0, h.value().compareTo(new BigDecimal("4.45")));
        // 查无 → null(与 resolve 一致)
        assertNull(svc.resolveHit("elec_package", "2095-06", null, null));
    }

    // ── copy 只复制月变键且幂等:常数键月行不被复制;二跑 copied=0 ──
    @Test
    void copy_monthlyKeysOnly_idempotent() throws Exception {
        putCfg("{\"scope\":\"\",\"cfgKey\":\"elec_peak\",\"acctMonth\":\"2099-07\",\"value\":1.5}");
        putCfg("{\"scope\":\"dorm\",\"cfgKey\":\"elec_resident\",\"acctMonth\":\"2099-07\",\"value\":0.7}");
        putCfg("{\"scope\":\"\",\"cfgKey\":\"water\",\"acctMonth\":\"2099-07\",\"value\":9.9}");   // 常数键月行,不应被复制
        mvc.perform(post("/api/price-cfg/copy").header("Authorization", auth())
                .contentType("application/json").content("{\"fromYm\":\"2099-07\",\"toYm\":\"2099-08\"}"))
                .andExpect(jsonPath("$.data.copied").value(2))
                .andExpect(jsonPath("$.data.skipped").value(0));
        mvc.perform(get("/api/price-cfg").header("Authorization", auth()))
                .andExpect(jsonPath("$.data[?(@.scope==''&&@.cfgKey=='elec_peak'&&@.acctMonth=='2099-08')].value").value(1.5))
                .andExpect(jsonPath("$.data[?(@.scope=='dorm'&&@.cfgKey=='elec_resident'&&@.acctMonth=='2099-08')].value").value(0.7))
                .andExpect(jsonPath("$.data[?(@.scope==''&&@.cfgKey=='water'&&@.acctMonth=='2099-08')]").doesNotExist());
        mvc.perform(post("/api/price-cfg/copy").header("Authorization", auth())
                .contentType("application/json").content("{\"fromYm\":\"2099-07\",\"toYm\":\"2099-08\"}"))
                .andExpect(jsonPath("$.data.copied").value(0))
                .andExpect(jsonPath("$.data.skipped").value(2));
    }

    // ── 业务错=HTTP 200+body.code 400:白名单外 key / V62 已删键 / 月变键 acctMonth 空 ──
    @Test
    void bizErrors_code400() throws Exception {
        mvc.perform(put("/api/price-cfg").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"scope\":\"\",\"cfgKey\":\"no_such_key\",\"value\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
        // V62 已删键=白名单外
        mvc.perform(put("/api/price-cfg").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"scope\":\"p2\",\"cfgKey\":\"lamp_sqm\",\"value\":0.005}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
        // 月变键禁 '' 行:acctMonth 缺省/空串均 400
        mvc.perform(put("/api/price-cfg").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"scope\":\"\",\"cfgKey\":\"elec_peak\",\"value\":1.2}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
        mvc.perform(put("/api/price-cfg").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"scope\":\"\",\"cfgKey\":\"elec_flat\",\"acctMonth\":\"\",\"value\":0.7}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));
    }

    // ── 校验错=HTTP 400:scope 非法 / acctMonth 格式 / copy ym 格式 ──
    @Test
    void validationErrors_http400() throws Exception {
        mvc.perform(put("/api/price-cfg").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"scope\":\"p9\",\"cfgKey\":\"water\",\"value\":1}"))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/api/price-cfg").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"scope\":\"\",\"cfgKey\":\"water\",\"acctMonth\":\"2099/01\",\"value\":1}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/price-cfg/copy").header("Authorization", auth())
                .contentType("application/json").content("{\"fromYm\":\"2099-1\",\"toYm\":\"2099-04\"}"))
                .andExpect(status().isBadRequest());
    }
}
