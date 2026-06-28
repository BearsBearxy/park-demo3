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

    @Test
    void company_deleteWithLedgerData_returns409InBody() throws Exception {
        // company 1 (园区租赁管理公司) has seeded ledger rows → delete guarded
        mvc.perform(delete("/api/companies/1").header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409));
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
    void month_returns13RowsWithDerivedTotals() throws Exception {
        String body = mvc.perform(get("/api/ledger/companies/1/months/2026/5")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.month").value(5))
                .andExpect(jsonPath("$.data.prevMonth").value(4))
                .andExpect(jsonPath("$.data.rows.length()").value(13)) // sparse padded to all active
                .andReturn().getResponse().getContentAsString();
        List<Integer> tenantIds = JsonPath.read(body, "$.data.rows[*].tenantId");
        assertThat(tenantIds).doesNotContain(14); // retired tenant excluded
        // every row exposes derived totalReceivable + balanceEnd
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
                .andExpect(jsonPath("$.data.rows.length()").value(13));

        // read back: tenant 1 has the saved values + derived totals
        // tenant 1 = rows[0] (rows padded to all 13 active tenants, ordered by id)
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

        // blank that row → deleted, padded back to zero
        String reblank = utf8(mvc.perform(put("/api/ledger/companies/1/months/2026/9").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantId\":1}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn());
        assertThat(((Number) JsonPath.read(reblank, "$.data.rows[0].totalReceivable")).doubleValue()).isEqualTo(0.0);
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

    // ── auth ──────────────────────────────────────────────────
    @Test
    void overview_withoutToken_returns401() throws Exception {
        mvc.perform(get("/api/ledger/companies/1/overview").param("year", "2026"))
                .andExpect(status().isUnauthorized());
    }
}
