package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.entity.S10Record;
import com.park.demo3.mapper.S10RecordMapper;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * GET /api/bills?year&month — 该期全部公司账单行(台账×租户×公司)。
 * 写入(子租户 + 台账行)统一 @Transactional 回滚:共享单例容器,不污染种子,断言只锚定 V5 种子与自建数据,无顺序依赖。
 */
@AutoConfigureMockMvc
@Transactional
class BillsApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired S10RecordMapper s10;
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

    // MockHttpServletResponse.getContentAsString() 默认 ISO-8859-1;按 UTF-8 解码使中文比对正确
    private static String utf8(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    @Test
    void bills_returnsRowsAcrossCompanies_parentNamePassedThrough_derivedMatchesLedger() throws Exception {
        // 1) 建子租户挂到租户1(中誉机械重工),验证 parentId/parentName 透传
        String created = utf8(mvc.perform(post("/api/tenants").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"companyName\":\"IT账单宿舍\",\"businessType\":\"精密机械\",\"parentId\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn());
        int childId = JsonPath.read(created, "$.data.id");

        // 2) 给子租户在公司1 / 2026-05(V5 种子有数据期)写一行台账
        mvc.perform(put("/api/ledger/companies/1/months/2026/5").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantId\":" + childId + ",\"balancePrev\":1000,"
                        + "\"factoryRent\":50000,\"totalCollected\":40000}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));

        // 3) bills 返回该期全部公司行:公司1 种子 13 行 + 自建 1 行,且公司 2/3 也在(跨公司)
        String body = utf8(mvc.perform(get("/api/bills")
                .param("year", "2026").param("month", "5")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()", greaterThanOrEqualTo(14)))
                .andReturn());
        List<String> companyNames = JsonPath.read(body, "$.data[*].companyName");
        assertThat(new HashSet<>(companyNames))
                .contains("园区租赁管理公司", "园区综合服务公司", "园区水电管理公司");

        // 子租户行:parentName 正确透传;派生复用 LedgerService.recalc → 与台账口径全等
        List<Map<String, Object>> mine = JsonPath.read(body, "$.data[?(@.tenantId==" + childId + ")]");
        assertThat(mine).hasSize(1);
        Map<String, Object> row = mine.get(0);
        assertThat(row.get("companyId")).isEqualTo(1);
        assertThat(row.get("companyName")).isEqualTo("园区租赁管理公司");
        assertThat(row.get("tenantName")).isEqualTo("IT账单宿舍");
        assertThat(row.get("parentId")).isEqualTo(1);
        assertThat(row.get("parentName")).isEqualTo("中誉机械重工");
        assertThat(((Number) row.get("factoryRent")).doubleValue()).isEqualTo(50000.0);
        assertThat(((Number) row.get("balancePrev")).doubleValue()).isEqualTo(1000.0);
        assertThat(((Number) row.get("totalCollected")).doubleValue()).isEqualTo(40000.0);
        assertThat(((Number) row.get("totalReceivable")).doubleValue()).isEqualTo(50000.0); // 21 费用和
        assertThat(((Number) row.get("balanceEnd")).doubleValue()).isEqualTo(11000.0);      // 1000+50000-40000

        // 主租户(种子,无 parent)→ parentName 为 null
        List<Object> parentOfTenant1 = JsonPath.read(body,
                "$.data[?(@.tenantId==1 && @.companyId==1)].parentName");
        assertThat(parentOfTenant1).containsExactly((Object) null);
    }

    @Test
    void bills_emptyPeriod_returnsEmptyArray() throws Exception {
        // 2098-01:无任何测试/种子写入的干净远期槽 → 空数组,不 404
        mvc.perform(get("/api/bills").param("year", "2098").param("month", "1")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    @Test
    void bills_badMonth_returnsHttp400() throws Exception {
        mvc.perform(get("/api/bills").param("year", "2026").param("month", "13")
                .header("Authorization", auth()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
    }

    // ── GET /api/bills/s10:附表10 应收口径工资条明细 ──

    @Test
    void s10_dataPeriod_rowsAndAnchorColumnMatchDirectQuery() throws Exception {
        // 直查 s10_record(V18 种子 2025-01 有数据),API 行数/锚点列须与之全等
        List<S10Record> direct = s10.selectByMonth("2025-01");
        assertThat(direct).isNotEmpty();

        String body = utf8(mvc.perform(get("/api/bills/s10")
                .param("year", "2025").param("month", "1")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn());
        assertThat((Integer) JsonPath.read(body, "$.data.length()")).isEqualTo(direct.size());

        // 首行身份字段(直查与 API 同一排序:tenant_id 升序 + id 次级)
        S10Record d0 = direct.get(0);
        assertThat((String) JsonPath.read(body, "$.data[0].tenantName")).isEqualTo(d0.getTenantName());
        assertThat((Integer) JsonPath.read(body, "$.data[0].phase")).isEqualTo(d0.getPhase());

        // 锚点列 factoryRent:全期逐行求和与直查全等(null 归 0 同服务口径)
        BigDecimal directSum = direct.stream()
                .map(r -> r.getFactoryRent() == null ? BigDecimal.ZERO : r.getFactoryRent())
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        List<Number> apiCol = JsonPath.read(body, "$.data[*].factoryRent");
        double apiSum = apiCol.stream().mapToDouble(Number::doubleValue).sum();
        assertThat(apiSum).isEqualTo(directSum.doubleValue());
    }

    @Test
    void s10_emptyPeriod_returnsEmptyArray() throws Exception {
        mvc.perform(get("/api/bills/s10").param("year", "2098").param("month", "1")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    @Test
    void s10_badMonth_returnsHttp400() throws Exception {
        mvc.perform(get("/api/bills/s10").param("year", "2026").param("month", "13")
                .header("Authorization", auth()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    void bills_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/bills").param("year", "2026").param("month", "5"))
                .andExpect(status().isUnauthorized());
    }

    // ── 收款公司指引 paymap(V34 表 + V35 种子 + GET/PUT)──

    @Test
    void paymap_seedDerivedFromLedgerHistory_anchorsAndS10OnlyColumnsUnseeded() throws Exception {
        // V5 种子费用组按公司分治(company1=租金/company2=管理/company3=水电)→ 租户1 各列唯一记账公司,默认映射确定
        String body = utf8(mvc.perform(get("/api/bills/paymap").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()", greaterThanOrEqualTo(1)))
                .andReturn());
        List<Integer> rent = JsonPath.read(body, "$.data[?(@.tenantId==1 && @.feeKey=='factoryRent')].companyId");
        assertThat(rent).containsExactly(1);    // 厂房租金:租户1 历史只记在公司1
        List<Integer> elec = JsonPath.read(body, "$.data[?(@.tenantId==1 && @.feeKey=='elecStd')].companyId");
        assertThat(elec).containsExactly(3);    // 基准电费:租户1 历史只记在公司3
        // s10 独有列(台账无对应列,如 officeRent)不种默认 → 全表无该 feeKey 行
        List<Object> officeRows = JsonPath.read(body, "$.data[?(@.feeKey=='officeRent')]");
        assertThat(officeRows).isEmpty();
    }

    @Test
    void paymap_putUpsert_updateAndInsertPaths_thenVisibleInGet() throws Exception {
        // update 路径:改已种行(租户1 factoryRent 种子=公司1 → 改公司3)
        mvc.perform(put("/api/bills/paymap").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"tenantId\":1,\"feeKey\":\"factoryRent\",\"companyId\":3}"))
                .andExpect(status().isOk());
        // insert 路径:landRent 系 s10 独有列,种子必空 → 首次 PUT 走插入
        mvc.perform(put("/api/bills/paymap").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"tenantId\":1,\"feeKey\":\"landRent\",\"companyId\":2}"))
                .andExpect(status().isOk());

        String body = utf8(mvc.perform(get("/api/bills/paymap").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        List<Integer> rent = JsonPath.read(body, "$.data[?(@.tenantId==1 && @.feeKey=='factoryRent')].companyId");
        assertThat(rent).containsExactly(3);
        List<Integer> land = JsonPath.read(body, "$.data[?(@.tenantId==1 && @.feeKey=='landRent')].companyId");
        assertThat(land).containsExactly(2);
    }

    @Test
    void paymap_putInvalidFeeKeyOrMissingRefs_rejectedWithChineseMessage() throws Exception {
        // feeKey 不在附表10 25 colId 集合 → 信封 code 400 + 中文文案(业务错误按约定 HTTP 200)
        mvc.perform(put("/api/bills/paymap").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"tenantId\":1,\"feeKey\":\"notAFee\",\"companyId\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("附表10费用列")));
        // 租户/公司不存在 → 404
        mvc.perform(put("/api/bills/paymap").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"tenantId\":999999,\"feeKey\":\"factoryRent\",\"companyId\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
        mvc.perform(put("/api/bills/paymap").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"tenantId\":1,\"feeKey\":\"factoryRent\",\"companyId\":999999}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(404));
    }

    @Test
    void paymap_viewerPut_returns403() throws Exception {
        String vBody = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"viewer\",\"password\":\"viewer123\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String vToken = JsonPath.read(vBody, "$.data.token");
        mvc.perform(put("/api/bills/paymap").header("Authorization", "Bearer " + vToken)
                .contentType("application/json")
                .content("{\"tenantId\":1,\"feeKey\":\"factoryRent\",\"companyId\":2}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(403));
    }
}
