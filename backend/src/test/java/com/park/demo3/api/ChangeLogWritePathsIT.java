package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * 数据修改记录接到各条手改路径上(用户 2026-10-05 拍板「2按你建议，3，4一起做」第 4 条):
 * 台账、抄表读数、工资、三大报表每一次手改,只记真变了的格(谁、改前、改后);导入不逐格记。
 * 每步之前记下 value_change_log 的最大 id,断言这一步新写的行 —— 逐字比「行定位 | 列 | 改前 → 改后 | 说明」。
 *
 * 整类 @Transactional:造的数和记录全部回滚。2031 年各月在种子库里是空的。
 */
@AutoConfigureMockMvc
@Transactional
class ChangeLogWritePathsIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    /**
     * 破坏验证:save 里 logMonth 挪到 rechain 之前 / diff 不跳过新增行的 0 格 / importRows 也记 /
     * copyFromPrev 不记 / renameRow 不记 → 对应那一步的断言红。
     */
    @Test
    void ledgerManualSavesAreLoggedCellByCellImportIsNot() throws Exception {
        String t = admin();
        String co = jdbc.queryForObject("SELECT name FROM management_company WHERE id = 1", String.class);
        String tn = jdbc.queryForObject("SELECT company_name FROM tenant WHERE id = 1", String.class);
        String mar = co + " · 2031-03 · " + tn, apr = co + " · 2031-04 · " + tn;

        long m0 = mark();
        call(put("/api/ledger/companies/1/months/2031/3"), t,
            "{\"rows\":[{\"tenantId\":1,\"factoryRent\":1000,\"standardWater\":50,\"note\":\"甲\"}]}");
        assertThat(since(m0, "monthly_ledger", "%2031-0%")).as("新加一行:没录的 0 格不记").containsExactly(
            mar + " | 厂房租金 | null → 1000 | 新增这一行",
            mar + " | 基准水费 | null → 50 | 新增这一行",
            mar + " | 备注 | null → 甲 | 新增这一行");

        long m1 = mark();
        call(put("/api/ledger/companies/1/months/2031/3"), t,
            "{\"rows\":[{\"tenantId\":1,\"factoryRent\":1200,\"standardWater\":50,\"totalCollected\":300,\"note\":\"甲\"}]}");
        assertThat(since(m1, "monthly_ledger", "%2031-0%")).as("改了两格、水费和备注没变:正好两行").containsExactly(
            mar + " | 厂房租金 | 1000 → 1200 | null",
            mar + " | 本月收款 | 0 → 300 | null");

        long m2 = mark();
        call(post("/api/ledger/companies/1/months/2031/4/copy-from-prev"), t, null);
        assertThat(since(m2, "monthly_ledger", "%2031-0%")).containsExactly(
            apr + " | 上月结余 | null → 950 | 复制上月，新增这一行",
            apr + " | 厂房租金 | null → 1200 | 复制上月，新增这一行",
            apr + " | 基准水费 | null → 50 | 复制上月，新增这一行");

        long m2b = mark();
        call(put("/api/ledger/companies/1/months/2031/4"), t,
            "{\"rows\":[{\"tenantId\":1,\"balancePrev\":999,\"factoryRent\":1200,\"standardWater\":50}]}");
        assertThat(since(m2b, "monthly_ledger", "%2031-0%"))
            .as("4 月的结余接 3 月期末,送来的 999 被结余链改回去了:库里没变就不记").isEmpty();

        Integer aprId = jdbc.queryForObject("SELECT id FROM monthly_ledger WHERE company_id = 1"
            + " AND period_year = 2031 AND period_month = 4 AND tenant_id = 1", Integer.class);
        long m3 = mark();
        call(patch("/api/ledger/rows/" + aprId + "/tenant-name"), t, "{\"tenantName\":\"IT账面改名\"}");
        assertThat(since(m3, "monthly_ledger", "%2031-0%")).containsExactly(
            co + " · 2031-04 · IT账面改名 | 账面名 | " + tn + " → IT账面改名 | null");

        long m4 = mark();
        String imp = call(post("/api/ledger/companies/1/import?year=2031&month=3"), t,
            "{\"rows\":[{\"tenantName\":\"" + tn + "\",\"factoryRent\":1500}]}");
        assertThat((int) JsonPath.read(imp, "$.data.imported")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT factory_rent FROM monthly_ledger WHERE company_id = 1"
            + " AND period_year = 2031 AND period_month = 3 AND tenant_id = 1", BigDecimal.class))
            .as("导入确实改了这一行").isEqualByComparingTo("1500");
        assertThat(since(m4, "monthly_ledger", "%2031-0%"))
            .as("导入不逐格记;结余链顺手改到 4 月的结余是推出来的,也不记").isEmpty();

        long m5 = mark();
        call(put("/api/ledger/companies/1/months/2031/3"), t, "{\"rows\":[{\"tenantId\":1}]}");
        assertThat(since(m5, "monthly_ledger", "%2031-0%")).as("清空 = 删掉这一行,旧值留下").containsExactly(
            mar + " | 厂房租金 | 1500 → null | 删除这一行",
            mar + " | 基准水费 | 50 → null | 删除这一行",
            mar + " | 本月收款 | 300 → null | 删除这一行",
            mar + " | 备注 | 甲 → null | 删除这一行");
        assertActorIsAdmin(m0);
    }

    /** 破坏验证:updateReading 拿内存里改过的对象比(不重读) / 导入也记 → 对应断言红。 */
    @Test
    void meterReadingManualEditsAreLoggedImportIsNot() throws Exception {
        String t = admin();
        long m0 = mark();
        String imp = call(post("/api/meters/import"), t, "{\"rows\":[{\"kind\":\"elec\",\"zone\":\"p2\","
            + "\"name\":\"IT改动记录表\",\"ym\":\"2031-03\",\"factor\":1,\"prevTotal\":100,\"currTotal\":150}]}");
        assertThat((int) JsonPath.read(imp, "$.data.imported")).isEqualTo(1);
        assertThat(since(m0, "meter_reading", "%IT改动记录表%")).as("导入不逐格记").isEmpty();

        Map<String, Object> r = jdbc.queryForMap("SELECT r.id, r.meter_id FROM meter_reading r JOIN meter m"
            + " ON m.id = r.meter_id WHERE m.name = 'IT改动记录表' AND r.ym = '2031-03'");
        int id = ((Number) r.get("id")).intValue(), meterId = ((Number) r.get("meter_id")).intValue();
        String mar = "二期电表 IT改动记录表 · 2031-03";

        long m1 = mark();
        call(put("/api/meters/readings/" + id), t, "{\"meterId\":" + meterId
            + ",\"ym\":\"2031-03\",\"currTotal\":160,\"note\":\"复核\"}");
        assertThat(since(m1, "meter_reading", "%IT改动记录表%"))
            .as("没送上月行至:库里没清掉(updateById 跳过 null),照库记就是没变").containsExactly(
            mar + " | 本月行至 | 150 → 160 | null",
            mar + " | 备注 | null → 复核 | null");

        long m2 = mark();
        call(post("/api/meters/readings"), t, "{\"meterId\":" + meterId
            + ",\"ym\":\"2031-04\",\"prevTotal\":160,\"currTotal\":175}");
        assertThat(since(m2, "meter_reading", "%IT改动记录表%")).containsExactly(
            "二期电表 IT改动记录表 · 2031-04 | 上月行至 | null → 160 | 新增这一行",
            "二期电表 IT改动记录表 · 2031-04 | 本月行至 | null → 175 | 新增这一行");

        long m3 = mark();
        call(delete("/api/meters/readings/" + id), t, null);
        assertThat(since(m3, "meter_reading", "%IT改动记录表%")).containsExactly(
            mar + " | 上月行至 | 100 → null | 删除这一行",
            mar + " | 本月行至 | 160 → null | 删除这一行",
            mar + " | 备注 | 复核 → null | 删除这一行");
        assertActorIsAdmin(m0);
    }

    /** 破坏验证:create / updateNote / delete 任一处不记,或 clearImported 不记摘要 → 对应断言红。 */
    @Test
    void salaryManualEditsAreLoggedImportIsNot() throws Exception {
        String t = admin();
        long m0 = mark();
        String imp = call(post("/api/salary/import?year=2031&month=3"), t,
            "{\"rows\":[{\"tenantName\":\"IT导入员\",\"base\":8000}]}");
        assertThat((int) JsonPath.read(imp, "$.data.imported")).isEqualTo(1);
        assertThat(since(m0, "salary_record", "%2031-03%")).as("导入不逐格记").isEmpty();

        long m1 = mark();
        String created = call(post("/api/salary/records"), t,
            "{\"acctMonth\":\"2031-03\",\"name\":\"IT日志员\",\"base\":4500,\"post\":300}");
        int id = JsonPath.read(created, "$.data.id");
        assertThat(since(m1, "salary_record", "%2031-03%")).as("没填的 0 格、0 天不记").containsExactly(
            "IT日志员 · 2031-03 | 基本工资 | null → 4500 | 新增这一行",
            "IT日志员 · 2031-03 | 岗位工资 | null → 300 | 新增这一行");

        long m2 = mark();
        call(patch("/api/salary/records/" + id + "/note"), t, "{\"note\":\"补发\"}");
        assertThat(since(m2, "salary_record", "%2031-03%")).containsExactly(
            "IT日志员 · 2031-03 | 备注 | null → 补发 | null");

        long m3 = mark();
        call(delete("/api/salary/records/" + id), t, null);
        assertThat(since(m3, "salary_record", "%2031-03%")).containsExactly(
            "IT日志员 · 2031-03 | 基本工资 | 4500 → null | 删除这一行",
            "IT日志员 · 2031-03 | 岗位工资 | 300 → null | 删除这一行",
            "IT日志员 · 2031-03 | 备注 | 补发 → null | 删除这一行");

        long m4 = mark();
        call(delete("/api/salary/imported?year=2031&month=3"), t, null);
        assertThat(since(m4, "salary_record", "%2031-03%")).containsExactly(
            "2031-03 · 导入的工资 |  | null → null | 清空了这个月导入的工资，共 1 人");
        assertActorIsAdmin(m0);
    }

    /** 破坏验证:logPeriod 不把「没有这一格」当 0 / 不重读 / 导入也记 → 对应断言红。 */
    @Test
    void reportManualSavesAreLoggedCellByCellImportIsNot() throws Exception {
        String t = admin();
        String co = jdbc.queryForObject("SELECT name FROM management_company WHERE id = 1", String.class);
        String r1 = "利润表 · " + co + " · 2031-03 · 行次 1", r2 = "利润表 · " + co + " · 2031-03 · 行次 2";

        long m0 = mark();
        call(put("/api/reports/is/1/2031/3"), t, "{\"cells\":[{\"rowKey\":\"1\",\"field\":\"cur\",\"amount\":100},"
            + "{\"rowKey\":\"1\",\"field\":\"ytd\",\"amount\":200},{\"rowKey\":\"2\",\"field\":\"cur\",\"amount\":50}]}");
        assertThat(since(m0, "report_amount", "%2031-03%")).containsExactly(
            r1 + " | 本月金额 | 0 → 100 | null",
            r1 + " | 本年累计金额 | 0 → 200 | null",
            r2 + " | 本月金额 | 0 → 50 | null");

        long m1 = mark();
        call(put("/api/reports/is/1/2031/3"), t, "{\"cells\":[{\"rowKey\":\"1\",\"field\":\"cur\",\"amount\":150},"
            + "{\"rowKey\":\"1\",\"field\":\"ytd\",\"amount\":200}]}");
        assertThat(since(m1, "report_amount", "%2031-03%")).as("本年累计没变不记;行次 2 没送 = 改成了 0").containsExactly(
            r1 + " | 本月金额 | 100 → 150 | null",
            r2 + " | 本月金额 | 50 → 0 | null");

        long m2 = mark();
        String imp = call(post("/api/reports/is/import?year=2031&month=3"), t, "{\"sections\":[{\"companyName\":\""
            + co + "\",\"cells\":[{\"rowKey\":\"1\",\"field\":\"cur\",\"amount\":999}]}]}");
        assertThat((int) JsonPath.read(imp, "$.data.imported")).isEqualTo(1);
        assertThat(since(m2, "report_amount", "%2031-03%")).as("导入不逐格记").isEmpty();
        assertActorIsAdmin(m0);
    }

    /** 破坏验证:CompanyService.delete 去掉两句 summary → 红。 */
    @Test
    void deletingACompanyLeavesOneSummaryRowPerTable() throws Exception {
        String t = admin();
        int id = JsonPath.read(call(post("/api/companies"), t, "{\"name\":\"IT改动记录公司\"}"), "$.data.id");
        call(put("/api/ledger/companies/" + id + "/months/2031/3"), t, "{\"rows\":[{\"tenantId\":1,\"factoryRent\":10}]}");
        call(put("/api/reports/is/" + id + "/2031/3"), t, "{\"cells\":[{\"rowKey\":\"1\",\"field\":\"cur\",\"amount\":5}]}");

        long m0 = mark();
        call(delete("/api/companies/" + id + "?force=true"), t, null);
        assertThat(since(m0, "monthly_ledger", "IT改动记录公司%")).containsExactly(
            "IT改动记录公司 |  | null → null | 删除了这家公司，它名下 1 行台账（所有年月）一并删掉");
        assertThat(since(m0, "report_amount", "IT改动记录公司%")).containsExactly(
            "IT改动记录公司 |  | null → null | 删除了这家公司，它名下 1 格三大报表金额（所有年月）一并删掉");
    }

    // ── helpers ──

    private long mark() {
        return jdbc.queryForObject("SELECT COALESCE(MAX(id), 0) FROM value_change_log", Long.class);
    }

    /** mark 之后这张表、行定位 LIKE refLike 的新记录,一行一句「行定位 | 列 | 改前 → 改后 | 说明」。 */
    private List<String> since(long mark, String tbl, String refLike) {
        return jdbc.query("SELECT row_ref, field, old_val, new_val, note FROM value_change_log"
                + " WHERE id > ? AND tbl = ? AND row_ref LIKE ? ORDER BY id",
            (rs, i) -> rs.getString(1) + " | " + rs.getString(2) + " | " + rs.getString(3) + " → "
                + rs.getString(4) + " | " + rs.getString(5), mark, tbl, refLike);
    }

    private void assertActorIsAdmin(long mark) {
        assertThat(jdbc.queryForList("SELECT DISTINCT actor FROM value_change_log WHERE id > ?", String.class, mark))
            .containsExactly("admin");
    }

    /** 发请求并断言业务码 0,回 UTF-8 正文。 */
    private String call(MockHttpServletRequestBuilder req, String token, String json) throws Exception {
        if (!token.isEmpty()) req.header("Authorization", "Bearer " + token);
        if (json != null) req.contentType("application/json").content(json);
        String body = new String(mvc.perform(req).andReturn().getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
        assertThat((int) JsonPath.read(body.isEmpty() ? "{\"code\":0}" : body, "$.code")).as(body).isZero();
        return body;
    }

    private String admin() throws Exception {
        return JsonPath.read(call(post("/api/auth/login"), "", "{\"username\":\"admin\",\"password\":\"admin123\"}"),
            "$.data.token");
    }
}
