package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
class LedgerApiIT extends AbstractMysqlIT {

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

    // MockHttpServletResponse.getContentAsString() defaults to ISO-8859-1; decode bytes as UTF-8
    // so seeded 中文 (company names / notes) compare correctly.
    private static String utf8(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    // ── company CRUD ──────────────────────────────────────────
    @Test
    void companies_listSeededThree_withDerivedShort() throws Exception {
        String body = utf8(mvc.perform(get("/api/companies").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.length()", greaterThanOrEqualTo(3)))
                .andReturn());
        List<String> names  = JsonPath.read(body, "$.data[*].name");
        List<String> shorts = JsonPath.read(body, "$.data[*].short");   // JSON wire name is "short"
        assertThat(names).contains("园区租赁管理公司", "园区综合服务公司", "园区水电管理公司");
        assertThat(shorts).contains("租赁", "综合", "水电");
    }

    @Test
    void company_create_rename_delete_roundTrip() throws Exception {
        // create
        String created = mvc.perform(post("/api/companies").header("Authorization", auth())
                .contentType("application/json").content("{\"name\":\"园区测试服务公司\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.short").value("测试"))
                .andReturn().getResponse().getContentAsString();
        int id = JsonPath.read(created, "$.data.id");

        // rename
        mvc.perform(put("/api/companies/" + id).header("Authorization", auth())
                .contentType("application/json").content("{\"name\":\"园区改名物业公司\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.name").value("园区改名物业公司"))
                .andExpect(jsonPath("$.data.short").value("改名"));

        // delete (no ledger rows) → ok
        mvc.perform(delete("/api/companies/" + id).header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
    }

    @Test
    void company_createDuplicateName_returns409InBody() throws Exception {
        mvc.perform(post("/api/companies").header("Authorization", auth())
                .contentType("application/json").content("{\"name\":\"园区租赁管理公司\"}"))
                .andExpect(status().isOk())          // BizException → HTTP 200, code in body
                .andExpect(jsonPath("$.code").value(409));
    }

    // 删共享种子(公司1 含台账+报表数据),@Transactional 回滚隔离,不污染其他用例
    @Test
    @Transactional
    void company_deleteWithData_cascadesLedgerAndReports() throws Exception {
        mvc.perform(delete("/api/companies/1").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
        // 公司消失,其台账/报表读接口回 404(数据已级联清除)
        String body = utf8(mvc.perform(get("/api/companies").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        List<Integer> ids = JsonPath.read(body, "$.data[*].id");
        assertThat(ids).doesNotContain(1);
        mvc.perform(get("/api/ledger/companies/1/overview").param("year", "2026")
                .header("Authorization", auth()))
                .andExpect(jsonPath("$.code").value(404));
    }

    // ── 年份门 ────────────────────────────────────────────────
    @Test
    void years_returnsSeededYearWithMonthCounts() throws Exception {
        String body = mvc.perform(get("/api/ledger/companies/1/years").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        List<Integer> years = JsonPath.read(body, "$.data[*].year");
        List<Integer> months = JsonPath.read(body, "$.data[*].months");
        assertThat(years).isNotEmpty();
        assertThat(months).allMatch(m -> m >= 1 && m <= 12);
    }

    // ── ledger overview / month ───────────────────────────────
    @Test
    void overview_shapeAndCurrentMonth() throws Exception {
        mvc.perform(get("/api/ledger/companies/1/overview").param("year", "2026")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.companyName").value("园区租赁管理公司"))
                .andExpect(jsonPath("$.data.year").value(2026))
                .andExpect(jsonPath("$.data.monthsWithData").value(5))
                .andExpect(jsonPath("$.data.activeTenants").value(13))
                .andExpect(jsonPath("$.data.months.length()").value(12))
                .andExpect(jsonPath("$.data.ytdRecv").value(greaterThanOrEqualTo(1.0)))
                // month 5 is the max month with data → current; month 6 empty
                .andExpect(jsonPath("$.data.months[4].month").value(5))
                .andExpect(jsonPath("$.data.months[4].status").value("current"))
                .andExpect(jsonPath("$.data.months[0].status").value("done"))
                .andExpect(jsonPath("$.data.months[5].status").value("empty"));
    }

    @Test
    void month_returnsStoredRowsOnly() throws Exception {
        // 只回存储行(不再补零全部在租租户);V5 种子给公司1 每月存了 13 行(tenant 1-13)
        String body = mvc.perform(get("/api/ledger/companies/1/months/2026/5")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.month").value(5))
                .andExpect(jsonPath("$.data.prevMonth").value(4))
                .andExpect(jsonPath("$.data.rows.length()").value(13)) // stored rows(seed), not padding
                .andReturn().getResponse().getContentAsString();
        List<Integer> tenantIds = JsonPath.read(body, "$.data.rows[*].tenantId");
        assertThat(tenantIds).doesNotContain(14); // retired tenant has no stored row
        // every stored row exposes derived totalReceivable + balanceEnd
        List<Object> recv = JsonPath.read(body, "$.data.rows[*].totalReceivable");
        List<Object> end  = JsonPath.read(body, "$.data.rows[*].balanceEnd");
        assertThat(recv).hasSize(13);
        assertThat(end).hasSize(13);
        // footer present with derived totals
        assertThat((Object) JsonPath.read(body, "$.data.footer.totalReceivable")).isNotNull();
    }

    // ── save round-trip ───────────────────────────────────────
    @Test
    void save_roundTrip_persistsAndRecomputesDerived() throws Exception {
        // write a single tenant row into a clean future month (2026/9, no seed there)
        String saveBody = "{\"rows\":[{\"tenantId\":1,\"balancePrev\":1000,\"factoryRent\":50000,"
                + "\"totalCollected\":40000,\"note\":\"集成测试\"}]}";
        mvc.perform(put("/api/ledger/companies/1/months/2026/9").header("Authorization", auth())
                .contentType("application/json").content(saveBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.rows.length()").value(1)); // stored only

        // read back: tenant 1 has the saved values + derived totals (唯一存储行)
        String body = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/9")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andReturn());
        Number recv = JsonPath.read(body, "$.data.rows[0].totalReceivable");
        Number end  = JsonPath.read(body, "$.data.rows[0].balanceEnd");
        String note = JsonPath.read(body, "$.data.rows[0].note");
        assertThat(recv.doubleValue()).isEqualTo(50000.0);          // sum of fees
        assertThat(end.doubleValue()).isEqualTo(11000.0);           // 1000 + 50000 - 40000
        assertThat(note).isEqualTo("集成测试");

        // blank that row → deleted → month has no stored rows
        mvc.perform(put("/api/ledger/companies/1/months/2026/9").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantId\":1}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.rows.length()").value(0));
    }

    // ── copy-from-prev ────────────────────────────────────────
    @Test
    void copyFromPrev_carriesBalanceForward() throws Exception {
        // month 5 has seeded data; copy into clean month 10 (prev=9 is empty → expect 409),
        // so instead seed month 10 from month 5 by first copying 5→… we use month 6 (prev 5 has data).
        String body = utf8(mvc.perform(post("/api/ledger/companies/1/months/2026/6/copy-from-prev")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.month").value(6))
                .andReturn());
        // copied rows: collected reset to 0, so balanceEnd = balancePrev + recv > 0 for paying tenants (tenant 1 = rows[0])
        Number recv1 = JsonPath.read(body, "$.data.rows[0].totalReceivable");
        Number coll1 = JsonPath.read(body, "$.data.rows[0].totalCollected");
        assertThat(recv1.doubleValue()).isGreaterThan(0.0);
        assertThat(coll1.doubleValue()).isEqualTo(0.0); // collection reset on copy

        // clean up so re-runs stay deterministic: blank all rows for month 6
        mvc.perform(put("/api/ledger/companies/1/months/2026/6").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantId\":1},{\"tenantId\":2},{\"tenantId\":3},{\"tenantId\":4},"
                        + "{\"tenantId\":5},{\"tenantId\":6},{\"tenantId\":7},{\"tenantId\":8},{\"tenantId\":9},"
                        + "{\"tenantId\":10},{\"tenantId\":11},{\"tenantId\":12},{\"tenantId\":13}]}"))
                .andExpect(status().isOk());
    }

    @Test
    void copyFromPrev_prevMonthEmpty_returns409InBody() throws Exception {
        // month 11: prev (10) has no data → conflict
        mvc.perform(post("/api/ledger/companies/1/months/2026/11/copy-from-prev")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409));
    }

    // ── import:列级定向 upsert(balancePrev/totalCollected/note + null不覆盖/0清零) ──
    @Test
    void import_balancePrevCollectedNote_roundTripWithDerived() throws Exception {
        // 创显样例「成吉」行:9 个费用 + 上月结余/本月收款/备注,导入干净未来月 2026/7
        String importBody = "{\"rows\":[{\"tenantName\":\"中誉机械重工\","
                + "\"factoryRent\":12588.80,\"factoryInfraMaint\":892.80,"
                + "\"elevatorMaint\":159,\"transformerMaint\":159,\"officeOtherFee\":0,"
                + "\"standardElectricity\":464.98,\"electricityMaint\":305.73,"
                + "\"standardWater\":48.80,\"waterMaint\":8.87,"
                + "\"balancePrev\":102.94,\"totalCollected\":14627.98,\"note\":\"电梯费用未支付\"}]}";
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "7")
                .header("Authorization", auth())
                .contentType("application/json").content(importBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.skipped").value(0));

        String body = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/7")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(1))
                .andReturn());
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].balancePrev")).doubleValue()).isEqualTo(102.94);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].totalCollected")).doubleValue()).isEqualTo(14627.98);
        assertThat((String) JsonPath.read(body, "$.data.rows[0].note")).isEqualTo("电梯费用未支付");
        // totalReceivable = 21 费用和;balanceEnd = balancePrev + 应收 - 收款
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].totalReceivable")).doubleValue()).isEqualTo(14627.98);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].balanceEnd")).doubleValue()).isEqualTo(102.94);

        // 清理:blank 该行让重跑确定性
        mvc.perform(put("/api/ledger/companies/1/months/2026/7").header("Authorization", auth())
                .contentType("application/json").content("{\"rows\":[{\"tenantId\":1}]}"))
                .andExpect(status().isOk());
    }

    @Test
    void import_allBlankRow_skippedWithNamedError() throws Exception {
        // 全空行(费用/结余/收款/备注全无)且该租户本月无既有行 → 记名跳过
        String res = utf8(mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "7")
                .header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"锐通电子\"}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(0))
                .andExpect(jsonPath("$.data.skipped").value(1))
                .andReturn());
        assertThat((String) JsonPath.read(res, "$.data.errors[0].label")).isEqualTo("锐通电子");
        assertThat((String) JsonPath.read(res, "$.data.errors[0].reason")).contains("跳过");
    }

    @Test
    void import_balancePrevOnly_notSkipped() throws Exception {
        // 创显样例「戎合」行:只有上月结余(如 249 万挂账),绝不能被全零防线跳过
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "7")
                .header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"康泽生物\",\"balancePrev\":2499022.41}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.skipped").value(0));

        String body = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/7")
                .header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        List<Integer> ids = JsonPath.read(body, "$.data.rows[*].tenantId");
        int idx = ids.indexOf(3);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[" + idx + "].balancePrev")).doubleValue())
                .isEqualTo(2499022.41);

        mvc.perform(put("/api/ledger/companies/1/months/2026/7").header("Authorization", auth())
                .contentType("application/json").content("{\"rows\":[{\"tenantId\":3}]}"))
                .andExpect(status().isOk());
    }

    @Test
    void import_duplicateTenantRows_lastWinsSingleRow() throws Exception {
        // 同一文件同租户名两行:第二行走 update(不再重复 insert 撞 uk_ledger 整笔 500 回滚)
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "7")
                .header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":["
                        + "{\"tenantName\":\"新元材料\",\"factoryRent\":100},"
                        + "{\"tenantName\":\"新元材料\",\"factoryRent\":200}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(2));

        String body = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/7")
                .header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        List<Integer> ids = JsonPath.read(body, "$.data.rows[*].tenantId");
        assertThat(ids).containsOnlyOnce(4); // 库里该租户本月仅一行
        assertThat(((Number) JsonPath.read(body, "$.data.rows[" + ids.indexOf(4) + "].factoryRent")).doubleValue())
                .isEqualTo(200.0); // 值 = 第二行

        mvc.perform(put("/api/ledger/companies/1/months/2026/7").header("Authorization", auth())
                .contentType("application/json").content("{\"rows\":[{\"tenantId\":4}]}"))
                .andExpect(status().isOk());
    }

    @Test
    void import_nullKeepsExisting_zeroClears() throws Exception {
        // 既有行 factoryRent=5(干净未来月 2026/8)
        mvc.perform(put("/api/ledger/companies/1/months/2026/8").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantId\":1,\"factoryRent\":5}]}"))
                .andExpect(status().isOk());

        // 导入行 factoryRent 缺省(null=文件没这列)、shopRent=3 → factoryRent 不被覆盖
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "8")
                .header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"中誉机械重工\",\"shopRent\":3}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1));
        String body = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/8")
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].factoryRent")).doubleValue()).isEqualTo(5.0);
        assertThat(((Number) JsonPath.read(body, "$.data.rows[0].shopRent")).doubleValue()).isEqualTo(3.0);

        // 再导 factoryRent=0(文件里是「-」)→ 显式清零
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "8")
                .header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"中誉机械重工\",\"factoryRent\":0}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1));
        String body2 = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/8")
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
        assertThat(((Number) JsonPath.read(body2, "$.data.rows[0].factoryRent")).doubleValue()).isEqualTo(0.0);

        mvc.perform(put("/api/ledger/companies/1/months/2026/8").header("Authorization", auth())
                .contentType("application/json").content("{\"rows\":[{\"tenantId\":1}]}"))
                .andExpect(status().isOk());
    }

    // ── auth ──────────────────────────────────────────────────
    @Test
    void overview_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/ledger/companies/1/overview").param("year", "2026"))
                .andExpect(status().isUnauthorized());
    }
}
