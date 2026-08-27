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

    /** 结转虚行(carried=true)是读层附赠,断言存储行时按它过滤。 */
    @SuppressWarnings("unchecked")
    private static List<java.util.Map<String, Object>> storedRows(String monthBody) {
        List<java.util.Map<String, Object>> rows = JsonPath.read(monthBody, "$.data.rows[*]");
        return rows.stream().filter(r -> !Boolean.TRUE.equals(r.get("carried"))).toList();
    }

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
        // RBAC-SPEC §5.6:名下有数据时**先拦一次**,把影响行数报出来,不带 force 删不掉
        mvc.perform(delete("/api/companies/1").header("Authorization", auth()))
                .andExpect(status().isOk())          // BizException → HTTP 200, code in body
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("月度台账")));
        // 确认后才连数据一起删
        mvc.perform(delete("/api/companies/1").param("force", "true").header("Authorization", auth()))
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

    // ── save round-trip(结余链 2026-08-25 改为**严格相邻**:2026-09 的上一自然月 08 无账 →
    //    09 是链起点,人工填的 balancePrev 就是期初,rechain 不得跨 6-8 月空洞去接 05 的期末。
    //    跨空洞前滚正是 docs/data-fix/prevfix_20260825.sql 那批坏数据的成因,这里端到端钉住) ──
    @Test
    void save_roundTrip_persistsAndRecomputesDerived() throws Exception {
        // write a single tenant row into a clean future month (2026/9, no seed there)
        String saveBody = "{\"rows\":[{\"tenantId\":1,\"balancePrev\":1000,\"factoryRent\":50000,"
                + "\"totalCollected\":40000,\"note\":\"集成测试\"}]}";
        String saved = utf8(mvc.perform(put("/api/ledger/companies/1/months/2026/9").header("Authorization", auth())
                .contentType("application/json").content(saveBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        assertThat(storedRows(saved)).hasSize(1);   // 存储行 1 条(其余为结转虚行)

        String body = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/9")
                .header("Authorization", auth()))
                .andExpect(status().isOk())
                .andReturn());
        java.util.Map<String, Object> r0 = storedRows(body).get(0);
        Number recv = (Number) r0.get("totalReceivable");
        Number prev = (Number) r0.get("balancePrev");
        Number end  = (Number) r0.get("balanceEnd");
        Boolean derived = (Boolean) r0.get("balancePrevDerived");
        String note = (String) r0.get("note");
        assertThat(recv.doubleValue()).isEqualTo(50000.0);                    // sum of fees
        assertThat(derived).isFalse();                                         // 上月(08)无账 → 链起点
        assertThat(prev.doubleValue()).isEqualTo(1000.0);                      // 人工期初原样保留
        assertThat(end.doubleValue()).isEqualTo(1000.0 + 50000.0 - 40000.0);
        assertThat(note).isEqualTo("集成测试");

        // blank that row → deleted → month has no stored rows(结转虚行是读层附赠,不算)
        String cleared = utf8(mvc.perform(put("/api/ledger/companies/1/months/2026/9").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantId\":1}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0)).andReturn());
        assertThat(storedRows(cleared)).isEmpty();
    }

    // ── save:相邻月 = 派生位(与上一个用例互为反面;两条一起把 2026-08-25 的严格相邻口径夹住) ──
    @Test
    void save_adjacentMonth_forcesBalancePrevFromChain() throws Exception {
        // 2026-06 的上一自然月 05 有种子 → 06 是派生位:人工填多少都被 05 的期末覆盖
        String may = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/5")
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
        List<Integer> mayIds = JsonPath.read(may, "$.data.rows[*].tenantId");
        double chainPrev = ((Number) JsonPath.read(may,
                "$.data.rows[" + mayIds.indexOf(1) + "].balanceEnd")).doubleValue();

        mvc.perform(put("/api/ledger/companies/1/months/2026/6").header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantId\":1,\"balancePrev\":1000,\"factoryRent\":50000,"
                        + "\"totalCollected\":40000}]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));

        String body = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/6")
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
        java.util.Map<String, Object> r0 = storedRows(body).get(0);      // 唯一存储行(其余为结转虚行)
        assertThat(((Number) r0.get("tenantId")).intValue()).isEqualTo(1);
        assertThat((Boolean) r0.get("balancePrevDerived")).isTrue();
        assertThat(((Number) r0.get("balancePrev")).doubleValue()).isEqualTo(chainPrev);  // 人工 1000 被覆盖
        assertThat(((Number) r0.get("balanceEnd")).doubleValue())
                .isEqualTo(chainPrev + 50000.0 - 40000.0);

        // 清理:删空该行,06 月回到全结转虚行(copyFromPrev / carriedRows 两个用例也用 06 月)
        String cleared = utf8(mvc.perform(put("/api/ledger/companies/1/months/2026/6")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[{\"tenantId\":1}]}"))
                .andExpect(status().isOk()).andReturn());
        assertThat(storedRows(cleared)).isEmpty();
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

    // ── import:列级定向 upsert;结余链 2026-08-25 起 balancePrev 按链上位置定夺
    //    (上一自然月无账=链起点,期初照收;有账=派生位,文件值忽略) ──
    @Test
    void import_balancePrevCollectedNote_roundTripWithDerived() throws Exception {
        // 首现户(不在种子租户表 → 未绑定行,真·首次出现月):9 个费用 + 结余(将被屏蔽)/收款/备注
        String importBody = "{\"rows\":[{\"tenantName\":\"结余链首现户\","
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
                .andReturn());
        List<java.util.Map<String, Object>> st = storedRows(body);
        assertThat(st).hasSize(1);
        java.util.Map<String, Object> r0 = st.get(0);
        // 结余链:「结余链首现户」2026-07 为首次出现月 → 文件里的 102.94 作期初照收(非派生位)
        assertThat(((Number) r0.get("balancePrev")).doubleValue()).isEqualTo(102.94);
        assertThat((Boolean) r0.get("balancePrevDerived")).isFalse();
        assertThat(((Number) r0.get("totalCollected")).doubleValue()).isEqualTo(14627.98);
        assertThat((String) r0.get("note")).isEqualTo("电梯费用未支付");
        // totalReceivable = 21 费用和;balanceEnd = 期初 + 应收 - 收款
        assertThat(((Number) r0.get("totalReceivable")).doubleValue()).isEqualTo(14627.98);
        assertThat(((Number) r0.get("balanceEnd")).doubleValue()).isEqualTo(102.94);

        // 清理:未绑定行按行 id 删空,让重跑与后续用例确定性
        Number rowId = (Number) r0.get("id");
        mvc.perform(put("/api/ledger/companies/1/months/2026/7").header("Authorization", auth())
                .contentType("application/json").content("{\"rows\":[{\"id\":" + rowId + "}]}"))
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
        assertThat((String) JsonPath.read(res, "$.data.errors[0].reason"))
                .as("真全空的行,措辞照旧").contains("无费用/结余/收款/备注");
    }

    // 2026-08-27 用户反馈:整行只有上月结余的被跳过,提示却说「无…结余」—— 话说反了。
    // 数据是对的(上月有该户 → 本月结余由上月期末派生,文件里那个值本就该忽略),
    // 但这条提示让用户以为系统没看见他填的结余。跳过的理由要说成派生,不能说成"没有"。
    @Test
    void import_onlyBalancePrev_onDerivedSlot_skipReasonSaysDerivedNotEmpty() throws Exception {
        // tenant 1 在 2026-05 有种子 → 06 月是派生位(上一自然月有账)
        String res = utf8(mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "6")
                .header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"" + seededTenantName() + "\",\"balancePrev\":8888}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.imported").value(0))
                .andReturn());
        String reason = JsonPath.read(res, "$.data.errors[0].reason");
        assertThat(reason).as("要说清是「派生」").contains("派生");
        assertThat(reason).as("不能再说「无…结余」——这行明明有结余").doesNotContain("无费用/结余/收款/备注");
    }

    /** 2026-05 有种子的那个租户的账面名(派生位用例的前置)。 */
    private String seededTenantName() throws Exception {
        String may = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/5")
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
        return JsonPath.read(may, "$.data.rows[0].tenantName");
    }

    // ── 结转虚行(2026-08-24 拍板):有上月账的空月,默认显示上月期末≠0 的户,费用列留空 ──
    @SuppressWarnings("unchecked")
    @Test
    void carriedRows_showInEmptyMonth_materializeOnSave_revertOnBlank() throws Exception {
        // 2026-06 无存储行 → 全部行为结转虚行(仅链上期末≠0 的户,种子里未必 13 户全有)
        String jun = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/6")
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
        List<java.util.Map<String, Object>> junRows = JsonPath.read(jun, "$.data.rows[*]");
        assertThat(junRows).isNotEmpty()
                .allMatch(r -> Boolean.TRUE.equals(r.get("carried")) && r.get("id") == null);
        // 取样第一条虚行:balancePrev 必须 = 该户 2026-05 的期末(链上派生)
        java.util.Map<String, Object> sample = junRows.get(0);
        int tid = ((Number) sample.get("tenantId")).intValue();
        double prev = ((Number) sample.get("balancePrev")).doubleValue();
        assertThat(prev).isNotZero();
        String may = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/5")
                .header("Authorization", auth())).andExpect(status().isOk()).andReturn());
        List<java.util.Map<String, Object>> mayRows = JsonPath.read(may, "$.data.rows[*]");
        double mayEnd = mayRows.stream()
                .filter(r -> r.get("tenantId") != null && ((Number) r.get("tenantId")).intValue() == tid)
                .mapToDouble(r -> ((Number) r.get("balanceEnd")).doubleValue()).findFirst().orElseThrow();
        assertThat(prev).isEqualTo(mayEnd);

        // 原样送回全部虚行(前端保存草稿含虚行)→ 不落库:月仍全虚
        StringBuilder rows = new StringBuilder();
        for (int i = 0; i < junRows.size(); i++) {
            if (i > 0) rows.append(',');
            rows.append("{\"tenantId\":").append(((Number) junRows.get(i).get("tenantId")).intValue())
                .append(",\"balancePrev\":").append(junRows.get(i).get("balancePrev"))
                .append(",\"totalCollected\":0,\"note\":null}");
        }
        String echo = utf8(mvc.perform(put("/api/ledger/companies/1/months/2026/6")
                .header("Authorization", auth()).contentType("application/json")
                .content("{\"rows\":[" + rows + "]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0)).andReturn());
        assertThat(storedRows(echo)).isEmpty();

        // 在取样虚行上录一笔费用 → 落成真行(carried=false,id 非空)
        String one = "{\"rows\":[{\"tenantId\":" + tid + ",\"balancePrev\":" + prev
                + ",\"factoryRent\":777,\"totalCollected\":0,\"note\":null}]}";
        String after = utf8(mvc.perform(put("/api/ledger/companies/1/months/2026/6")
                .header("Authorization", auth()).contentType("application/json").content(one))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0)).andReturn());
        List<java.util.Map<String, Object>> st2 = storedRows(after);
        assertThat(st2).hasSize(1);
        assertThat(((Number) st2.get(0).get("tenantId")).intValue()).isEqualTo(tid);
        assertThat(st2.get(0).get("id")).isNotNull();
        assertThat(((Number) st2.get(0).get("totalReceivable")).doubleValue()).isEqualTo(777.0);

        // 清空该行(派生结余不算内容)→ 真行删除,回结转虚行
        String blank = "{\"rows\":[{\"tenantId\":" + tid + ",\"balancePrev\":" + prev
                + ",\"totalCollected\":0,\"note\":null}]}";
        String back = utf8(mvc.perform(put("/api/ledger/companies/1/months/2026/6")
                .header("Authorization", auth()).contentType("application/json").content(blank))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0)).andReturn());
        assertThat(storedRows(back)).isEmpty();
        List<java.util.Map<String, Object>> backRows = JsonPath.read(back, "$.data.rows[*]");
        assertThat(backRows.stream().anyMatch(r ->
                r.get("tenantId") != null && ((Number) r.get("tenantId")).intValue() == tid
                && Boolean.TRUE.equals(r.get("carried")))).isTrue();
    }

    @Test
    void import_balancePrevOnly_seedsFirstMonth_ignoredWhenDerived() throws Exception {
        // 结余链(2026-08-25):历史月未补时,源册「上月结余」是唯一期初入口
        // ① 首现户只有一笔挂账结余(戎合 249 万那种)照样入库,且是可改的期初位
        String fresh = "挂账首现户";
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "8")
                .header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"" + fresh + "\",\"balancePrev\":2499022.41}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1))
                .andExpect(jsonPath("$.data.skipped").value(0));
        String aug = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/8").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        java.util.Map<String, Object> seeded = storedRows(aug).stream()
                .filter(r -> fresh.equals(r.get("tenantName"))).findFirst().orElseThrow();
        assertThat(((Number) seeded.get("balancePrev")).doubleValue()).isEqualTo(2499022.41);
        assertThat((Boolean) seeded.get("balancePrevDerived")).isFalse();

        // ② 派生位:同一户 08 月刚落了账 → 09 月的**上一自然月**有记录 → 文件里的结余被忽略,以链为准
        //    (刻意拿同一户接着往下个月导:严格相邻口径下,只有紧邻才派生)
        double chainEnd = 2499022.41;              // 08 月期末 = 期初 2499022.41 + 应收 0 - 收款 0
        mvc.perform(post("/api/ledger/companies/1/import")
                .param("year", "2026").param("month", "9")
                .header("Authorization", auth())
                .contentType("application/json")
                .content("{\"rows\":[{\"tenantName\":\"" + fresh + "\",\"balancePrev\":999999,\"factoryRent\":10}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.imported").value(1));
        String sep = utf8(mvc.perform(get("/api/ledger/companies/1/months/2026/9").header("Authorization", auth()))
                .andExpect(status().isOk()).andReturn());
        java.util.Map<String, Object> derived = storedRows(sep).stream()
                .filter(r -> fresh.equals(r.get("tenantName"))).findFirst().orElseThrow();
        assertThat(((Number) derived.get("balancePrev")).doubleValue()).isEqualTo(chainEnd);   // 不是 999999
        assertThat((Boolean) derived.get("balancePrevDerived")).isTrue();
        assertThat(((Number) derived.get("balanceEnd")).doubleValue()).isEqualTo(2499032.41);  // + 应收 10

        // 清理:两行删空,保持重跑确定性
        mvc.perform(put("/api/ledger/companies/1/months/2026/8").header("Authorization", auth())
                .contentType("application/json").content("{\"rows\":[{\"id\":" + seeded.get("id") + "}]}"))
                .andExpect(status().isOk());
        mvc.perform(put("/api/ledger/companies/1/months/2026/9").header("Authorization", auth())
                .contentType("application/json").content("{\"rows\":[{\"id\":" + derived.get("id") + "}]}"))
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
