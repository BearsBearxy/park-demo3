/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.dto.ZoneDTO;
import com.park.demo3.service.ZoneService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 导入中心改稿(2026-10-10)的三个后端口子:coverage「这个月有没有」、page 导入记录分页、record 记下导到哪和被拒原因。
 *
 * 整类一个事务、跑完回滚:光伏 / 充电桩抄表「到哪天」看的是全表 MAX,要整表清掉才造得出「没有」;
 * 导入记录的页签数要精确,也得先清掉别的用例留下的记录。年份用 2031 / 2032,与种子数据不撞。
 * ⚠ 事务里 MyBatis 会话会缓存同一条查询,JdbcTemplate 的写清不掉它:每个用例里先造完夹具再发请求,
 *   不在两次请求之间用 jdbc 改数(「到哪天」的「没有」单开一个用例就是这个原因)。
 */
@AutoConfigureMockMvc
@Transactional
class ImportCenterApiIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ZoneService zones;
    private String tok;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        tok = "Bearer " + JsonPath.read(body, "$.data.token");
        jdbc.update("DELETE FROM import_log");
    }

    private String getOk(String url) throws Exception {
        return mvc.perform(get(url).header("Authorization", tok))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private static Map<String, Object> item(String body, String key) {
        List<Map<String, Object>> l = JsonPath.read(body, "$.data[?(@.key=='" + key + "')]");
        assertThat(l).as(key).hasSize(1);
        return l.get(0);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> chips(Map<String, Object> it) {
        return (List<Map<String, Object>>) it.get("chips");
    }

    private static boolean chipDone(Map<String, Object> it, String code) {
        return chips(it).stream().filter(c -> code.equals(c.get("code"))).map(c -> (Boolean) c.get("done"))
            .findFirst().orElseThrow(() -> new AssertionError("没有胶囊 " + code + ":" + it));
    }

    private static boolean allDone(Map<String, Object> it) { return chips(it).stream().allMatch(c -> (Boolean) c.get("done")); }
    private static boolean noneDone(Map<String, Object> it) { return chips(it).stream().noneMatch(c -> (Boolean) c.get("done")); }

    private void log(String type, String status, int ok, LocalDateTime at, String operator, String note) {
        jdbc.update("INSERT INTO import_log (data_type, type_label, file_name, `rows`, ok, warn, status, operator, note, created_at)"
                  + " VALUES (?,?,?,?,?,?,?,?,?,?)", type, type, "f.xlsx", ok, ok,
            "partial".equals(status) ? 1 : 0, status, operator, note, Timestamp.valueOf(at));
    }

    // ══ coverage:每类「有 / 缺 / 落后」(按月有没有、按年有没有只有两态) ══

    @Test
    void coverage_eachKindHasDoneMissingAndBehind() throws Exception {
        // 公司胶囊:两家启用公司保证「落后」是真的一半(种子里有几家都不影响)
        jdbc.update("INSERT INTO management_company (name, short, sort_no, status) VALUES ('IT覆盖甲', 'IT甲', 98, 1), ('IT覆盖乙', 'IT乙', 99, 1)");
        int coA = jdbc.queryForObject("SELECT id FROM management_company WHERE name = 'IT覆盖甲'", Integer.class);
        int coB = jdbc.queryForObject("SELECT id FROM management_company WHERE name = 'IT覆盖乙'", Integer.class);
        // 7 月全家都有,8 月只有甲,9 月一家没有
        jdbc.update("INSERT INTO monthly_ledger (company_id, tenant_name, period_year, period_month)"
                  + " SELECT id, 'IT租户', 2031, 7 FROM management_company WHERE status = 1");
        jdbc.update("INSERT INTO monthly_ledger (company_id, tenant_name, period_year, period_month) VALUES (?, 'IT租户', 2031, 8)", coA);
        for (String st : List.of("is", "bs", "tb")) {
            jdbc.update("INSERT INTO report_amount (company_id, statement, year, month, row_key, field, amount, created_at, updated_at)"
                      + " SELECT id, ?, 2031, 7, 'r', 'end', 1, NOW(), NOW() FROM management_company WHERE status = 1", st);
            jdbc.update("INSERT INTO report_amount (company_id, statement, year, month, row_key, field, amount, created_at, updated_at)"
                      + " VALUES (?, ?, 2031, 8, 'r', 'end', 1, NOW(), NOW())", coA, st);
        }
        // 附表10:7 月四期都有,8 月只有一期
        for (int ph = 1; ph <= 4; ph++)
            jdbc.update("INSERT INTO s10_record (tenant_name, phase, acct_month, profile) VALUES ('IT租户', ?, '2031-07', 'office')", ph);
        jdbc.update("INSERT INTO s10_record (tenant_name, phase, acct_month, profile) VALUES ('IT租户', 1, '2031-08', 'office')");
        // 工资:7 月有,8 月没有
        jdbc.update("INSERT INTO salary_record (acct_month, name) VALUES ('2031-07', 'IT员工')");
        // 园区抄表:7 月每个期区都有读数,8 月只有 p1
        for (ZoneDTO z : zones.list()) {
            jdbc.update("INSERT INTO meter (kind, zone, name) VALUES ('elec', ?, ?)", z.code(), "IT覆盖" + z.code());
            int mid = jdbc.queryForObject("SELECT id FROM meter WHERE kind = 'elec' AND zone = ? AND name = ?", Integer.class,
                z.code(), "IT覆盖" + z.code());
            jdbc.update("INSERT INTO meter_reading (meter_id, ym) VALUES (?, '2031-07')", mid);
            if ("p1".equals(z.code())) jdbc.update("INSERT INTO meter_reading (meter_id, ym) VALUES (?, '2031-08')", mid);
        }
        // 按月表:都到 8 月,附表8 和附表2 只到 7 月
        jdbc.update("INSERT INTO pv_record (phase_id, acct_month, occur_month) SELECT MIN(id), '2031-08', '2031-08' FROM pv_phase");
        jdbc.update("INSERT INTO charging_record (schedule_no, cat, acct_month) SELECT 7, MIN(cat_id), '2031-08' FROM charging_cat WHERE schedule_no = 7");
        jdbc.update("INSERT INTO charging_record (schedule_no, cat, acct_month) SELECT 8, MIN(cat_id), '2031-07' FROM charging_cat WHERE schedule_no = 8");
        jdbc.update("INSERT INTO elec_record (type, phase_id, acct_month) SELECT 'energy', MIN(id), '2031-08' FROM elec_phase");
        jdbc.update("INSERT INTO elec_cost_entry (meter_id, acct_month, fee_key) SELECT MIN(id), '2031-08', 'it' FROM elec_meter");
        jdbc.update("INSERT INTO office_record (schedule_no, acct_month, belong_month) VALUES (13, '2031-08', '2031-08'), (14, '2031-08', '2031-08')");
        for (String s : List.of("s1", "s3", "s4", "s5"))
            jdbc.update("INSERT INTO pnl_row (schedule, year, row_key, label, kind, m1, m8, created_at, updated_at)"
                      + " VALUES (?, 2031, 'it', 'IT行', 'detail', 1, 1, NOW(), NOW())", s);
        jdbc.update("INSERT INTO pnl_row (schedule, year, row_key, label, kind, m7, created_at, updated_at)"
                  + " VALUES ('s2', 2031, 'it', 'IT行', 'detail', 1, NOW(), NOW())");
        // 预算:2031 有预算数;2032 只有实际数(不算)
        jdbc.update("INSERT INTO budget_row (year, label, amount_budget, sort_order, created_at, updated_at) VALUES (2031, 'IT', 100, 1, NOW(), NOW())");
        jdbc.update("INSERT INTO budget_row (year, label, amount_actual, sort_order, created_at, updated_at) VALUES (2032, 'IT', 100, 1, NOW(), NOW())");
        // 光伏 / 充电桩抄表看全表最晚一天:清空后各插一天(「没有」见下一个用例)
        jdbc.update("DELETE FROM pv_reading");
        jdbc.update("DELETE FROM cp_reading");
        jdbc.update("INSERT INTO pv_reading (station_id, read_date) SELECT MIN(id), '2031-08-31' FROM pv_station");
        jdbc.update("INSERT INTO cp_reading (station_id, read_date) SELECT MIN(id), '2031-08-20' FROM cp_station");

        String jul = getOk("/api/import-log/coverage?ym=2031-07");
        String aug = getOk("/api/import-log/coverage?ym=2031-08");
        String sep = getOk("/api/import-log/coverage?ym=2031-09");
        String jan32 = getOk("/api/import-log/coverage?ym=2032-01");

        assertThat((List<?>) JsonPath.read(aug, "$.data")).hasSize(24);

        // ── 公司胶囊:台账、三张报表 ──
        for (String k : List.of("ledger", "report_is", "report_bs", "report_tb")) {
            assertThat(item(jul, k).get("kind")).isEqualTo("chips");
            assertThat(allDone(item(jul, k))).as(k + " 7 月全齐").isTrue();
            assertThat(item(jul, k).get("missing")).as(k + " 有").isEqualTo(false);
            assertThat(chipDone(item(aug, k), String.valueOf(coA))).as(k + " 8 月甲有").isTrue();
            assertThat(chipDone(item(aug, k), String.valueOf(coB))).as(k + " 8 月乙没有").isFalse();
            assertThat(item(aug, k).get("missing")).as(k + " 落后").isEqualTo(true);
            assertThat(noneDone(item(sep, k))).as(k + " 9 月一家没有").isTrue();
            assertThat(item(sep, k).get("missing")).as(k + " 缺").isEqualTo(true);
        }
        assertThat(chips(item(aug, "ledger"))).anyMatch(c -> "IT甲".equals(c.get("label")));

        // ── 期区胶囊:附表10(期号 1..4)、园区抄表(期区码) ──
        assertThat(chips(item(aug, "s10"))).extracting(c -> c.get("label")).containsExactly("一期", "二期", "三期", "宿舍");
        assertThat(item(jul, "s10").get("missing")).isEqualTo(false);
        assertThat(chipDone(item(aug, "s10"), "1")).isTrue();
        assertThat(chipDone(item(aug, "s10"), "4")).isFalse();
        assertThat(item(aug, "s10").get("missing")).isEqualTo(true);
        assertThat(noneDone(item(sep, "s10"))).isTrue();

        assertThat(chips(item(aug, "meter"))).extracting(c -> c.get("code")).contains("p1", "p2", "p3", "dorm");
        assertThat(allDone(item(jul, "meter"))).isTrue();
        assertThat(item(jul, "meter").get("missing")).isEqualTo(false);
        assertThat(chipDone(item(aug, "meter"), "p1")).isTrue();
        assertThat(chipDone(item(aug, "meter"), "dorm")).isFalse();
        assertThat(item(aug, "meter").get("missing")).isEqualTo(true);
        assertThat(noneDone(item(sep, "meter"))).isTrue();

        // ── 有 / 没有:工资 ──
        assertThat(item(jul, "salary")).containsEntry("kind", "has").containsEntry("has", true).containsEntry("missing", false);
        assertThat(item(aug, "salary")).containsEntry("has", false).containsEntry("missing", true);

        // ── 到 X月X日:不限月(选 7 月也写到 8月31日) ──
        assertThat(item(jul, "pvMeter")).containsEntry("kind", "day").containsEntry("upTo", "2031-08-31").containsEntry("missing", false);
        assertThat(item(aug, "pvMeter")).containsEntry("upTo", "2031-08-31").containsEntry("missing", false);
        assertThat(item(aug, "cpMeter")).containsEntry("upTo", "2031-08-20").containsEntry("missing", true);
        assertThat(item(sep, "pvMeter")).containsEntry("upTo", "2031-08-31").containsEntry("missing", true);

        // ── 到 N月:所选年 MAX(acct_month) ──
        for (String k : List.of("pv", "charging_7", "elec", "elecCost", "office_13", "office_14", "pnl_s1", "pnl_s3", "pnl_s4", "pnl_s5")) {
            assertThat(item(aug, k)).as(k).containsEntry("kind", "month").containsEntry("upTo", "2031-08").containsEntry("missing", false);
            assertThat(item(sep, k)).as(k + " 落后").containsEntry("upTo", "2031-08").containsEntry("missing", true);
            assertThat(item(jan32, k)).as(k + " 缺").containsEntry("missing", true).doesNotContainKey("upTo");
        }
        // 和本月出账同一套判据(U1):选 7 月、库里只有 8 月 → 写「到 8月」,但 7 月没有行就算缺(中间漏导一个月不许显成齐的);
        // 损益附表本月出账不看,仍按「到 N月」早不早于所选月
        for (String k : List.of("pv", "charging_7", "elec", "elecCost", "office_13", "office_14"))
            assertThat(item(jul, k)).as(k + " 7 月漏导").containsEntry("upTo", "2031-08").containsEntry("missing", true);
        assertThat(item(jul, "pnl_s1")).containsEntry("upTo", "2031-08").containsEntry("missing", false);
        assertThat(item(jul, "charging_8")).containsEntry("upTo", "2031-07").containsEntry("missing", false);
        assertThat(item(aug, "charging_8")).containsEntry("upTo", "2031-07").containsEntry("missing", true);
        assertThat(item(aug, "pnl_s2")).containsEntry("upTo", "2031-07").containsEntry("missing", true);

        // ── 该年有没有:预算 ──
        assertThat(item(aug, "budget")).containsEntry("kind", "year").containsEntry("has", true).containsEntry("missing", false);
        assertThat(item(jan32, "budget")).containsEntry("has", false).containsEntry("missing", true);

        // ── 合同不按月,不算缺 ──
        for (String k : List.of("contractFull", "billingTerms"))
            assertThat(item(aug, k)).containsEntry("kind", "na").containsEntry("missing", false);
    }

    @Test
    void coverage_dayKindsWithNoReadingsAreMissing() throws Exception {
        jdbc.update("DELETE FROM pv_reading");
        jdbc.update("DELETE FROM cp_reading");
        String body = getOk("/api/import-log/coverage?ym=2031-08");
        assertThat(item(body, "pvMeter")).containsEntry("kind", "day").containsEntry("missing", true).doesNotContainKey("upTo");
        assertThat(item(body, "cpMeter")).containsEntry("missing", true).doesNotContainKey("upTo");
    }

    // 新园区(park.sh 开的,common 迁移不带公司种子):一家启用公司都没有 → 胶囊空,也算缺(本月出账那边这四行都是未录)
    @Test
    void coverage_noActiveCompanies_companyChipKindsAreMissing() throws Exception {
        jdbc.update("UPDATE management_company SET status = 0");
        String body = getOk("/api/import-log/coverage?ym=2031-08");
        for (String k : List.of("ledger", "report_is", "report_bs", "report_tb")) {
            assertThat(chips(item(body, k))).as(k).isEmpty();
            assertThat(item(body, k).get("missing")).as(k + " 没有公司也算缺").isEqualTo(true);
        }
    }

    // 操作日志里导入那一行的对象:前端不再发 target 字符串,由结构列拼回「名 · 期 · 公司 · 期区」
    @Test
    void auditLog_importTargetFromScopeColumns() throws Exception {
        jdbc.update("INSERT INTO management_company (name, short, sort_no, status) VALUES ('IT日志公司', 'IT日志', 97, 1)");
        int co = jdbc.queryForObject("SELECT id FROM management_company WHERE name = 'IT日志公司'", Integer.class);
        for (String body : List.of(
                "{\"dataType\":\"ledger\",\"typeLabel\":\"月度台账\",\"fileName\":\"a.xlsx\",\"rows\":3,\"ok\":3,\"warn\":0,"
                    + "\"status\":\"complete\",\"periodFrom\":\"2031-09\",\"periodTo\":\"2031-09\",\"companyId\":" + co + "}",
                "{\"dataType\":\"meter\",\"typeLabel\":\"园区抄表\",\"fileName\":\"b.xlsx\",\"rows\":3,\"ok\":3,\"warn\":0,"
                    + "\"status\":\"complete\",\"periodFrom\":\"2031-08\",\"periodTo\":\"2031-09\",\"zone\":\"p2\"}",
                "{\"dataType\":\"contractFull\",\"typeLabel\":\"合同 · 汇总册\",\"fileName\":\"c.xlsx\",\"rows\":3,\"ok\":3,\"warn\":0,"
                    + "\"status\":\"complete\"}"))
            mvc.perform(post("/api/import-log").header("Authorization", tok).contentType("application/json").content(body))
                .andExpect(status().isOk());
        String logs = getOk("/api/system/logs?src=import&size=50");   // 本类每个用例先清空 import_log
        assertThat((List<String>) JsonPath.read(logs, "$.data.rows[*].target")).contains(
            "月度台账 · 2031-09 · IT日志", "园区抄表 · 2031-08~2031-09 · 二期", "合同 · 汇总册");
    }

    @Test
    void coverage_lastImportSkipsRejected() throws Exception {
        LocalDateTime now = LocalDateTime.now();
        log("ledger", "complete", 65, now.minusHours(3), "张敏", null);
        log("ledger", "rejected", 0, now.minusHours(1), "李工", "表头和模板对不上");
        String body = getOk("/api/import-log/coverage?ym=2031-08");
        @SuppressWarnings("unchecked") Map<String, Object> last = (Map<String, Object>) item(body, "ledger").get("last");
        assertThat(last).containsEntry("operator", "张敏").containsEntry("rows", 65);
        assertThat(item(body, "contractFull")).doesNotContainKey("last");   // 从没导过
    }

    @Test
    void coverage_badYm_400() throws Exception {
        mvc.perform(get("/api/import-log/coverage?ym=2031-13").header("Authorization", tok)).andExpect(status().isBadRequest());
    }

    // ══ page:近 30 天、不含抄表批量删除、页签与去处筛选、三个页签上的数 ══

    @Test
    void page_filtersAndCounts() throws Exception {
        LocalDateTime now = LocalDateTime.now();
        for (int d = 1; d <= 3; d++) log("elec", "complete", 10, now.minusDays(d), "张敏", null);
        log("elecCost", "partial", 8, now.minusDays(4), "张敏", null);
        log("elecCost", "partial", 8, now.minusDays(5), "张敏", null);
        log("ledger", "rejected", 0, now.minusDays(6), "张敏", "表头和模板对不上");
        log("meter_delete", "complete", 3, now.minusHours(1), "张敏", null);   // 删除留痕,不进记录表
        log("elec", "complete", 10, now.minusDays(31), "张敏", null);          // 30 天外

        String all = getOk("/api/import-log/page?page=1&size=2");
        assertThat((Integer) JsonPath.read(all, "$.data.total")).isEqualTo(6);
        assertThat((List<?>) JsonPath.read(all, "$.data.rows")).hasSize(2);
        assertThat((String) JsonPath.read(all, "$.data.rows[0].dataType")).isEqualTo("elec");   // 新的在前
        assertThat((Integer) JsonPath.read(all, "$.data.counts.all")).isEqualTo(6);
        assertThat((Integer) JsonPath.read(all, "$.data.counts.partial")).isEqualTo(2);
        assertThat((Integer) JsonPath.read(all, "$.data.counts.rejected")).isEqualTo(1);

        String p3 = getOk("/api/import-log/page?page=3&size=2");
        assertThat((List<String>) JsonPath.read(p3, "$.data.rows[*].dataType")).containsExactly("elecCost", "ledger");

        String partial = getOk("/api/import-log/page?status=partial");
        assertThat((Integer) JsonPath.read(partial, "$.data.total")).isEqualTo(2);
        assertThat((List<String>) JsonPath.read(partial, "$.data.rows[*].status")).containsOnly("partial");
        assertThat((Integer) JsonPath.read(partial, "$.data.counts.all")).isEqualTo(6);   // 页签数不跟页签走

        String rejected = getOk("/api/import-log/page?status=rejected");
        assertThat((String) JsonPath.read(rejected, "$.data.rows[0].note")).isEqualTo("表头和模板对不上");

        String twoTypes = getOk("/api/import-log/page?dataType=elec&dataType=elecCost");
        assertThat((Integer) JsonPath.read(twoTypes, "$.data.total")).isEqualTo(5);
        assertThat((Integer) JsonPath.read(twoTypes, "$.data.counts.rejected")).isEqualTo(0);
        assertThat((Integer) JsonPath.read(twoTypes, "$.data.counts.partial")).isEqualTo(2);

        mvc.perform(get("/api/import-log/page?status=weird").header("Authorization", tok)).andExpect(status().isBadRequest());
    }

    // ══ record:导到哪 + 整单被拒 ══

    @Test
    void record_rejectedWithScopeAndNote() throws Exception {
        String longNote = "表头".repeat(150);   // 300 字:截到 200,不许因为它整条记录丢掉
        String body = mvc.perform(post("/api/import-log").header("Authorization", tok).contentType("application/json")
                .content("{\"dataType\":\"meter\",\"typeLabel\":\"园区抄表\",\"fileName\":\"9月抄表.xlsx\",\"rows\":0,\"ok\":0,\"warn\":0,"
                       + "\"status\":\"rejected\",\"periodFrom\":\"2031-09\",\"periodTo\":\"2031-09\",\"companyId\":3,\"zone\":\"p2\","
                       + "\"note\":\"" + longNote + "\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertThat((String) JsonPath.read(body, "$.data.status")).isEqualTo("rejected");
        assertThat((String) JsonPath.read(body, "$.data.periodFrom")).isEqualTo("2031-09");
        assertThat((String) JsonPath.read(body, "$.data.periodTo")).isEqualTo("2031-09");
        assertThat((Integer) JsonPath.read(body, "$.data.companyId")).isEqualTo(3);
        assertThat((String) JsonPath.read(body, "$.data.zone")).isEqualTo("p2");
        assertThat((String) JsonPath.read(body, "$.data.note")).hasSize(200);
        assertThat((Integer) JsonPath.read(getOk("/api/import-log/page?status=rejected"), "$.data.total")).isEqualTo(1);

        mvc.perform(post("/api/import-log").header("Authorization", tok).contentType("application/json")
                .content("{\"dataType\":\"pvMeter\",\"typeLabel\":\"光伏抄表\",\"fileName\":\"f.xlsx\",\"rows\":1,\"ok\":1,\"warn\":0,"
                       + "\"status\":\"complete\",\"periodFrom\":\"10月1日\"}"))
                .andExpect(status().isBadRequest());
    }
}
