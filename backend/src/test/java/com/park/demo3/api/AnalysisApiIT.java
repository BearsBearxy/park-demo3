package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// P3 分析层只读聚合端点 IT:经既有写 API 造数 → 断言 slim 聚合形状与派生数字。
// 断言只锚定本类造的唯一名行,不依赖种子/其它 IT 的库状态(同容器跨类共享)。
@AutoConfigureMockMvc
class AnalysisApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login")
                .contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
    }

    private String auth() { return "Bearer " + token; }

    private static String utf8(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private String getOk(String url) throws Exception {
        return utf8(mvc.perform(get(url).header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn());
    }

    // ── s10 slim:elec=basic+std+maint;water=std+maint;total=25列Σ ──
    @Test
    void s10TenantMonths_slimDerivation() throws Exception {
        mvc.perform(post("/api/s10").header("Authorization", auth())
                .contentType("application/json")
                .content("""
                    {"tenantName":"分析IT租户S10","phase":2,"acctMonth":"2025-03","profile":"factory",
                     "factoryRent":1000.00,"elecBasic":10.50,"elecStd":20.25,"elecMaint":3.25,
                     "waterStd":7.00,"waterMaint":1.50}
                    """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        String body = getOk("/api/analysis/s10-tenant-months");
        List<Map<String, Object>> rows = JsonPath.read(body,
                "$.data[?(@.tenantName=='分析IT租户S10' && @.acctMonth=='2025-03')]");
        assertThat(rows).hasSize(1);
        Map<String, Object> r = rows.get(0);
        assertThat(((Number) r.get("phase")).intValue()).isEqualTo(2);
        assertThat(((Number) r.get("elec")).doubleValue()).isEqualTo(34.00);   // 10.50+20.25+3.25
        assertThat(((Number) r.get("water")).doubleValue()).isEqualTo(8.50);   // 7.00+1.50
        assertThat(((Number) r.get("total")).doubleValue()).isEqualTo(1042.50); // 1000+34+8.5
    }

    // ── 台账 slim:receivable=21费Σ;balanceEnd=prev+recv−coll;公司/租户名 join ──
    @Test
    void ledgerTenantMonths_slimDerivation() throws Exception {
        String cBody = utf8(mvc.perform(post("/api/companies").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"name\":\"分析IT公司\"}"))
                .andExpect(status().isOk()).andReturn());
        int companyId = JsonPath.read(cBody, "$.data.id");

        String tBody = utf8(mvc.perform(post("/api/tenants").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"companyName\":\"分析IT台账租户\",\"businessType\":\"综合\"}"))
                .andExpect(status().isOk()).andReturn());
        int tenantId = JsonPath.read(tBody, "$.data.id");

        mvc.perform(put("/api/ledger/companies/" + companyId + "/months/2025/4")
                .header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantId\":" + tenantId
                        + ",\"balancePrev\":50.00,\"factoryRent\":1200.00,\"standardWater\":30.00,"
                        + "\"totalCollected\":1000.00}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        String body = getOk("/api/analysis/ledger-tenant-months");
        List<Map<String, Object>> rows = JsonPath.read(body,
                "$.data[?(@.tenantName=='分析IT台账租户' && @.year==2025 && @.month==4)]");
        assertThat(rows).hasSize(1);
        Map<String, Object> r = rows.get(0);
        assertThat(r.get("companyName")).isEqualTo("分析IT公司");
        assertThat(((Number) r.get("receivable")).doubleValue()).isEqualTo(1230.00);  // 1200+30
        assertThat(((Number) r.get("collected")).doubleValue()).isEqualTo(1000.00);
        assertThat(((Number) r.get("balanceEnd")).doubleValue()).isEqualTo(280.00);   // 50+1230−1000
    }

    // ── months:并集含造数月份;8 个源键齐全 ──
    @Test
    void months_unionAndSourceKeys() throws Exception {
        // 依赖本类其它用例造的 s10/台账数据不可靠(方法级顺序),这里独立造一条 s10
        mvc.perform(post("/api/s10").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"tenantName\":\"分析IT月份探针\",\"phase\":1,\"acctMonth\":\"2025-08\","
                        + "\"profile\":\"office\",\"officeRent\":1.00}"))
                .andExpect(status().isOk());

        String body = getOk("/api/analysis/months");
        List<String> months = JsonPath.read(body, "$.data.months[*]");
        assertThat(months).contains("2025-08");
        assertThat(months).isSorted();
        Map<String, List<String>> sources = JsonPath.read(body, "$.data.sources");
        assertThat(sources.keySet()).containsExactly(
                "pnl", "s10", "ledger", "pv", "elec", "charging", "office", "report");
        assertThat(sources.get("s10")).contains("2025-08");
    }

    @Test
    void withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/analysis/months")).andExpect(status().isUnauthorized());
    }
}
