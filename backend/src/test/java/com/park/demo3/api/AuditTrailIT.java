package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.service.ChangeLogService;
import com.park.demo3.service.ChangeLogService.Cell;
import com.park.demo3.service.ChangeLogService.Tbl;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * 「数据修改记录」与操作日志的三处补记(用户 2026-10-05 拍板「2按你建议，3，4一起做」第 4 条):
 *  ① 手改的数逐格进操作日志(第 6 路 change),**看得到操作日志不等于看得到工资** —— 一行说的是哪张表,
 *     就要那张表的查看权;计费参数、表档案两路同理;
 *  ② 登录成败(用户名照限流键的写法、IP,不记密码);
 *  ③ 角色权限改动记成加了哪几项、去了哪几项。
 *
 * 整类 @Transactional:建的角色、账号、日志全部回滚;快照不随库回滚,@AfterTransaction 重载一次(同 SystemTieringIT)。
 */
@AutoConfigureMockMvc
@Transactional
class AuditTrailIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ChangeLogService changes;
    @Autowired com.park.demo3.security.UserPermissionCache cache;

    private static final String PASS = "init-pass-123";

    @org.springframework.test.context.transaction.AfterTransaction
    void reloadCacheAfterRollback() { cache.reload(); }

    // ══════════ ① 数据修改记录 + 按查看权过滤 ══════════

    /**
     * 破坏验证:AuditQueryMapper 的 change 分支去掉 tbl IN (tbls) → 只有系统查看的人看到 3 行,红;
     * 去掉 AND tbl = #{tbl} → 按表筛回来 3 行,红;param / meter 分支去掉 !seeParam / !seeMeter 的 1=0 → 那两句红;
     * actors() 的 value_change_log 不加条件 → 下拉里出现这个人,红。
     */
    @Test
    void changeRowsShowOnlyToViewersWhoMayOpenThatTable() throws Exception {
        String a = admin();
        String actor = "it_vcl_" + System.nanoTime() % 1000000;
        asUser(actor, () -> {
            changes.record(Tbl.SALARY, List.of(
                new Cell("2031-01 · 测试员甲", "基本工资", new BigDecimal("4500.00"), new BigDecimal("4800")),
                new Cell("2031-01 · 测试员甲", "岗位工资", new BigDecimal("300.00"), 300)), null);   // 没变,不记
            changes.record(Tbl.LEDGER, "测试公司 · 2031-01 · 甲户", "厂房租金", null, new BigDecimal("1000.50"));
            changes.summary(Tbl.LEDGER, "测试公司", "删掉了这家公司的 3 行台账");
        });
        // 同一个人的一行表档案记录(表档案那一路要「抄表 · 查看」)
        jdbc.update("INSERT INTO meter_archive_log (meter_id, tbl, from_ym, action, src, operator, at)"
                  + " VALUES (999999999, 'status', '2031-01', 'delete', 'manual', ?, NOW())", actor);

        // 系统管理员:三行都在,改前 → 改后、动作是表名
        assertThat(total(logs(a, "?size=50&actor=" + actor))).isEqualTo(4);
        assertThat(total(logs(a, "?src=meter&actor=" + actor))).isEqualTo(1);
        String all = logs(a, "?src=change&size=50&actor=" + actor);
        assertThat(total(all)).isEqualTo(3);
        assertThat(JsonPath.<List<String>>read(all, "$.data.rows[*].source")).containsOnly("change");
        assertThat(JsonPath.<List<String>>read(all, "$.data.rows[*].action"))
            .containsExactlyInAnyOrder("salary_record", "monthly_ledger", "monthly_ledger");
        assertThat(JsonPath.<List<String>>read(all, "$.data.rows[*].target")).containsExactlyInAnyOrder(
            "2031-01 · 测试员甲 · 基本工资", "测试公司 · 2031-01 · 甲户 · 厂房租金", "测试公司");
        assertThat(JsonPath.<List<String>>read(all, "$.data.rows[*].detail")).containsExactlyInAnyOrder(
            "4500 → 4800", "— → 1000.5", "删掉了这家公司的 3 行台账");
        assertThat(JsonPath.<List<String>>read(all, "$.data.tables")).containsExactly(
            "monthly_ledger", "meter_reading", "salary_record", "report_amount", "pnl_row", "analysis_setting");
        // 按表筛:只回那张表;不给 src 也行,给 src=change 也行
        assertThat(JsonPath.<List<String>>read(logs(a, "?tbl=salary_record&actor=" + actor), "$.data.rows[*].target"))
            .containsExactly("2031-01 · 测试员甲 · 基本工资");
        assertThat(total(logs(a, "?src=change&tbl=monthly_ledger&actor=" + actor))).isEqualTo(2);

        // 只有「操作日志 · 查看」:一行都看不到,下拉里没有这个人,也没有可筛的表;计费参数、表档案两路也是空的
        String onlyLogs = login(mkUser(a, "it-logs-only", mkRole(a, "it_logs_only", "[\"sys-logs:view\"]")), PASS);
        String none = logs(onlyLogs, "?size=50&actor=" + actor);
        assertThat(total(none)).as("看不到工资和台账的人,操作日志里也不该冒出它们的改前改后").isZero();
        assertThat(total(logs(onlyLogs, "?tbl=salary_record&actor=" + actor))).isZero();
        assertThat(JsonPath.<List<String>>read(none, "$.data.tables")).isEmpty();
        assertThat(JsonPath.<List<String>>read(none, "$.data.actors")).doesNotContain(actor);
        assertThat(total(logs(a, "?src=param&size=1"))).as("种子库计费参数有日志").isPositive();
        assertThat(total(logs(onlyLogs, "?src=param&size=1"))).as("没有计费参数查看权,单价的改前改后不给看").isZero();
        assertThat(total(logs(onlyLogs, "?src=meter&actor=" + actor))).as("没有抄表查看权,表档案那一路不给看").isZero();

        // 加上「工资 · 查看」:只看到工资那一行,台账两行照样看不到
        String salaryViewer = login(mkUser(a, "it-logs-sal",
            mkRole(a, "it_logs_sal", "[\"sys-logs:view\",\"salary:view\"]")), PASS);
        String sal = logs(salaryViewer, "?size=50&actor=" + actor);
        assertThat(JsonPath.<List<String>>read(sal, "$.data.rows[*].target")).containsExactly("2031-01 · 测试员甲 · 基本工资");
        assertThat(total(sal)).isEqualTo(1);
        assertThat(JsonPath.<List<String>>read(sal, "$.data.tables")).containsExactly("salary_record");
        assertThat(JsonPath.<List<String>>read(sal, "$.data.actors")).contains(actor);
    }

    @Test
    void tableFilterRejectsUnknownTablesAndOtherSources() throws Exception {
        String a = admin();
        assertThat((int) JsonPath.read(logs(a, "?tbl=auth_user"), "$.code")).isEqualTo(400);
        assertThat((int) JsonPath.read(logs(a, "?src=param&tbl=salary_record"), "$.code")).isEqualTo(400);
        assertThat((int) JsonPath.read(logs(a, "?src=change&size=1"), "$.code")).isZero();
    }

    // ══════════ ② 登录成败 ══════════

    /**
     * 破坏验证:去掉 loginFailed 里的 audit.logAs → 前两条红;查无此人时记 req.username() → 「不记输入的用户名」红;
     * 成功那句 audit.logAs 去掉 → 「登录」那行红;actor 不按限流键小写 → actor 那句红;
     * 查无此人每次都记(不按 IP 合桶)→ 「换着名字刷」那句红(对抗复查 SEC-1:每换一个名字就是一个新的限流桶,原来一条不落地记)。
     */
    @Test
    void loginSuccessAndFailureAreLogged_withNormalisedUsernameAndIp_neverThePassword() throws Exception {
        String a = admin();
        String u = mkUser(a, "it-Login", mkRole(a, "it_login", "[\"ledger:view\"]"));
        String norm = u.toLowerCase(Locale.ROOT);
        String ip = "10.88." + (System.nanoTime() % 200) + "." + (System.nanoTime() % 199 + 1);
        String nobody = "it-nobody-" + System.nanoTime() % 1000000;

        assertThat(loginCode(ip, u, "wrong-pass-zz1")).isEqualTo(401);
        assertThat(loginCode(ip, nobody, "typed-secret-77")).isEqualTo(401);
        assertThat(loginCode(ip, u, PASS)).isZero();
        for (int i = 0; i < 5; i++) assertThat(loginCode(ip, u, "wrong-pass-zz" + i)).isEqualTo(401);
        assertThat(loginCode(ip, u, PASS)).as("连错 5 次锁住了").isEqualTo(429);

        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT actor, action, target, detail FROM auth_audit_log WHERE target = ? ORDER BY id", ip);
        assertThat(rows).extracting(r -> r.get("action")).containsExactly(
            "login.fail", "login.fail", "login", "login.fail", "login.fail", "login.fail", "login.fail", "login.fail");
        assertThat(rows).extracting(r -> r.get("actor")).containsExactly(norm, "", norm, norm, norm, norm, norm, norm);
        assertThat(rows.get(0).get("detail")).isEqualTo("密码不对");
        assertThat(rows.get(1).get("detail")).as("查无此人:不记输入的用户名(常有人把密码敲进用户名框)").isEqualTo("没有这个账号");
        assertThat(rows.get(2).get("detail")).isNull();
        assertThat(rows.get(6).get("detail")).isEqualTo("密码不对");
        assertThat(rows.get(7).get("detail")).isEqualTo("密码不对，已连错 5 次，这个网络地址 15 分钟内不能再试这个账号");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit_log WHERE target = ? AND"
                + " (CONCAT_WS('|', actor, detail) LIKE '%pass-zz%' OR CONCAT_WS('|', actor, detail) LIKE '%secret%'"
                + "  OR CONCAT_WS('|', actor, detail) LIKE ?)", Integer.class, ip, "%" + nobody + "%"))
            .as("密码、查无此人时输入的用户名,哪一列都不许出现").isZero();

        // 进了时间线:按这个人筛得出登录与失败
        assertThat(JsonPath.<List<String>>read(logs(a, "?src=auth&size=50&actor=" + norm), "$.data.rows[*].action"))
            .contains("login", "login.fail");

        // 同一个地址换着不存在的名字刷:每个名字各是一个限流桶、永远到不了 5 次,原来每次一行。
        // 现在按地址合一个桶:15 分钟里只记第 1 次和第 5 次,行数有上限
        String ip2 = "10.89." + (System.nanoTime() % 200) + "." + (System.nanoTime() % 199 + 1);
        for (int i = 0; i < 12; i++) assertThat(loginCode(ip2, "it-spray-" + i + "-" + System.nanoTime() % 100000, "x")).isEqualTo(401);
        assertThat(jdbc.queryForList("SELECT detail FROM auth_audit_log WHERE target = ? ORDER BY id", String.class, ip2))
            .containsExactly("没有这个账号",
                "没有这个账号；这个网络地址 15 分钟内已试了 5 次不存在的账号，后面的不再一条条记");
    }

    // ══════════ ①b 别的几路也按「这块数据谁打得开」 ══════════

    /**
     * 对抗复查 SEC-2 / PROD-F9(2026-10-05):导入那一路照导入中心的读规则(PermissionRegistry /api/import-log/**,
     * 八个模块查看权任一)—— 只有「系统管理 · 查看」的账号打不开导入中心,操作日志里也不给看工资表的文件名和人数;
     * 账号与角色那一路里作废催缴单的行要「出账与催缴单 · 查看」,删表的行要「抄表 · 查看」;审核那一路 /api/review
     * 本来就是任何登录账号都能读(审核状态与退回理由),照旧。回包 sources = 这个账号看得见的来源,前端下拉只列它们。
     * 数据修改记录带授权人(V139):提权时做的改动,操作日志写明由谁授权。
     * 破坏验证:import 分支去掉 !seeImport 的 1=0 → 「只有系统查看」那句红;auth 分支去掉 bill-notice 条件 → 同句红;
     *          sources 不按查看权减 → sources 那两句红;change 分支 authorizer 写回 NULL → 授权人那句红。
     */
    @Test
    void importAndModuleRowsFollowTheReadRuleOfTheirScreen_andChangeRowsCarryTheAuthorizer() throws Exception {
        String a = admin();
        long n = System.nanoTime() % 1000000;
        String actor = "it_vis_" + n, importer = "it_imp_" + n;
        jdbc.update("INSERT INTO import_log (data_type, type_label, file_name, target, `rows`, ok, warn, status, operator, created_at)"
                  + " VALUES ('salary', '工资明细', '2031年1月工资.xlsx', '2031-01', 12, 12, 0, 'complete', ?, NOW())", importer);
        jdbc.update("INSERT INTO auth_audit_log (ts, actor, action, target, detail) VALUES (NOW(), ?, 'bill-notice.void', '2031-01 · 甲户 · 单 #1', NULL)", actor);
        jdbc.update("INSERT INTO auth_audit_log (ts, actor, action, target, detail) VALUES (NOW(), ?, 'meter.delete', '甲表', '删表')", actor);
        jdbc.update("INSERT INTO auth_audit_log (ts, actor, action, target, detail) VALUES (NOW(), ?, 'role.update', 'role:x', '没动权限，共 0 项')", actor);
        jdbc.update("INSERT INTO value_change_log (at, actor, authorizer, tbl, row_ref, field, old_val, new_val)"
                  + " VALUES (NOW(), ?, 'boss_' , 'salary_record', '2031-01 · 测试员乙', '基本工资', '1', '2')", actor);

        assertThat(total(logs(a, "?size=50&actor=" + actor))).isEqualTo(4);
        assertThat(JsonPath.<List<String>>read(logs(a, "?src=change&actor=" + actor), "$.data.rows[*].authorizer"))
            .containsExactly("boss_");
        assertThat(JsonPath.<List<String>>read(logs(a, "?size=1"), "$.data.sources"))
            .containsExactly("param", "import", "auth", "review", "meter", "change");

        String onlyLogs = login(mkUser(a, "it-vis-only", mkRole(a, "it_vis_only", "[\"sys-logs:view\"]")), PASS);
        String none = logs(onlyLogs, "?size=50&actor=" + actor);
        assertThat(JsonPath.<List<String>>read(none, "$.data.rows[*].action")).containsExactly("role.update");
        assertThat(total(logs(onlyLogs, "?src=import&actor=" + importer))).isZero();
        assertThat(JsonPath.<List<String>>read(none, "$.data.actors")).doesNotContain(importer);
        assertThat(JsonPath.<List<String>>read(none, "$.data.sources")).containsExactly("auth", "review");

        String wider = login(mkUser(a, "it-vis-mb",
            mkRole(a, "it_vis_mb", "[\"sys-logs:view\",\"bill-notices:view\",\"import:view\"]")), PASS);
        String w = logs(wider, "?size=50&actor=" + actor);
        assertThat(JsonPath.<List<String>>read(w, "$.data.rows[*].action"))
            .containsExactlyInAnyOrder("bill-notice.void", "role.update");
        assertThat(total(logs(wider, "?src=import&actor=" + importer))).isEqualTo(1);
        assertThat(JsonPath.<List<String>>read(w, "$.data.actors")).contains(importer);
        assertThat(JsonPath.<List<String>>read(w, "$.data.sources")).containsExactly("import", "auth", "review");
    }

    // ══════════ ③ 角色权限改了哪几项 ══════════

    /** 破坏验证:updateRole 的 detail 改回「权限 N 项」或不按屏合并 → 红。 */
    @Test
    void roleChangesRecordWhichPermissionsWereAddedAndRemoved() throws Exception {
        String a = admin();
        int id = mkRole(a, "it_diff", "[\"ledger:view\"]");
        String target = "role:" + jdbc.queryForObject("SELECT code FROM auth_role WHERE id=?", String.class, id);
        mvc.perform(put("/api/system/roles/" + id).header("Authorization", hdr(a)).contentType("application/json")
            .content("{\"name\":\"改权限\",\"navLayers\":[\"data\"],\"perms\":[\"income-statement:view\",\"salary:view\"]}"));
        mvc.perform(put("/api/system/roles/" + id).header("Authorization", hdr(a)).contentType("application/json")
            .content("{\"name\":\"改名不改权限\",\"navLayers\":[\"data\"],\"perms\":[\"income-statement:view\",\"salary:view\"]}"));
        assertThat(jdbc.queryForList("SELECT detail FROM auth_audit_log WHERE target=? ORDER BY id", String.class, target))
            .containsExactly(
                "加：月度台账（查看）；现共 1 项",
                "加：附表12 工资明细（查看）、利润表（查看）；去：月度台账（查看）；现共 2 项",
                "没动权限，共 2 项");
    }

    /**
     * 报表金额、损益附表一张表管好几屏(RBAC-SPEC §15.6):按行定位前缀给对应屏的查看者看 ——
     * 只有利润表查看的人看不到资产负债表的改动,只有附表1 查看的看不到附表2。
     * 删一家三张报表都有数的公司:按三张表各记一条摘要,只有利润表查看的人只看到「利润表 · {公司}」那一条
     * (改前记一条裸公司名,按前缀过滤后谁都看不到,系统管理员也看不到)。
     * 破坏验证:AuditQueryMapper.REF_FILTER 恒真 → 只看利润表的人看到 4 行,红;
     *          CompanyService.delete 改回一次删光记一条裸公司名 → 「利润表 · 」那条红。
     */
    @Test
    void reportAndPnlRowsShowOnlyToViewersOfThatStatement_andCompanyDeletionIsLoggedPerStatement() throws Exception {
        String a = admin();
        String actor = "it_rep_" + System.nanoTime() % 1000000;
        asUser(actor, () -> {
            changes.record(Tbl.REPORT, "利润表 · 测试公司 · 2031-01 · 行次 1", "本月数", 1, 2);
            changes.record(Tbl.REPORT, "资产负债表 · 测试公司 · 2031-01 · 行次 1", "期末数", 1, 2);
            changes.record(Tbl.PNL, "附表1 租金损益明细 · 2031 年 · 甲", "1月", 1, 2);
            changes.record(Tbl.PNL, "附表2 电费损益明细 · 2031 年 · 乙", "1月", 1, 2);
        });
        assertThat(total(logs(a, "?src=change&actor=" + actor))).isEqualTo(4);
        String is = login(mkUser(a, "it-rep-is",
            mkRole(a, "it_rep_is", "[\"sys-logs:view\",\"income-statement:view\",\"rent-pnl:view\"]")), PASS);
        String seen = logs(is, "?src=change&size=50&actor=" + actor);
        assertThat(JsonPath.<List<String>>read(seen, "$.data.rows[*].target")).containsExactlyInAnyOrder(
            "利润表 · 测试公司 · 2031-01 · 行次 1 · 本月数", "附表1 租金损益明细 · 2031 年 · 甲 · 1月");
        assertThat(total(seen)).isEqualTo(2);
        assertThat(JsonPath.<List<String>>read(seen, "$.data.tables")).containsExactly("report_amount", "pnl_row");
        assertThat(JsonPath.<List<String>>read(seen, "$.data.actors")).contains(actor);
        String bsOnly = login(mkUser(a, "it-rep-bs", mkRole(a, "it_rep_bs", "[\"sys-logs:view\",\"balance-sheet:view\"]")), PASS);
        assertThat(JsonPath.<List<String>>read(logs(bsOnly, "?src=change&actor=" + actor), "$.data.rows[*].target"))
            .containsExactly("资产负债表 · 测试公司 · 2031-01 · 行次 1 · 期末数");

        // 删一家三张报表都有数的公司(本类事务回滚)
        String coName = "IT删司测试" + System.nanoTime() % 100000;
        int coId = JsonPath.read(body(mvc.perform(post("/api/companies").header("Authorization", hdr(a))
            .contentType("application/json").content("{\"name\":\"" + coName + "\"}")).andReturn()), "$.data.id");
        for (String st : List.of("is", "bs", "tb"))
            jdbc.update("INSERT INTO report_amount (company_id, statement, year, month, row_key, field, amount, created_at, updated_at)"
                + " VALUES (?, ?, 2031, 1, 'r1', 'cur', 10, NOW(), NOW())", coId, st);
        assertThat((int) JsonPath.read(body(mvc.perform(delete("/api/companies/" + coId).param("force", "true")
            .header("Authorization", hdr(a))).andReturn()), "$.code")).isZero();
        assertThat(JsonPath.<List<String>>read(logs(a, "?tbl=report_amount&size=50&actor=admin"), "$.data.rows[*].target"))
            .contains("利润表 · " + coName, "资产负债表 · " + coName, "科目余额表 · " + coName);
        List<String> mine = JsonPath.read(logs(is, "?tbl=report_amount&size=50&actor=admin"), "$.data.rows[*].target");
        assertThat(mine).contains("利润表 · " + coName)
            .doesNotContain("资产负债表 · " + coName, "科目余额表 · " + coName, coName);
    }

    /**
     * 0.30–0.32 线上写下的「删除公司」报表摘要 row_ref 是裸公司名(0.33 起才按三张表分条、带报表名)。
     * 升级后系统管理员、看得了任一张报表的人照样看得到;一张报表都看不了的人看不到(这一路整张表都不给)。
     * 夹具照 origin/master 的 CompanyService.delete 原样写一行(ChangeLogService.summary:field 空、只有说明)。
     * 破坏验证:REF_FILTER 去掉裸公司名那一行 → 前两条红。
     */
    @Test
    void legacyCompanyDeletionSummaryWithBareCompanyName_staysVisibleToReportViewers() throws Exception {
        String a = admin();
        String actor = "it_old_" + System.nanoTime() % 1000000;
        jdbc.update("INSERT INTO value_change_log (at, actor, tbl, row_ref, field, note) VALUES (NOW(), ?, 'report_amount', "
            + "'旧版删掉的公司', '', '删除了这家公司，它名下 3 格三大报表金额（所有年月）一并删掉')", actor);
        assertThat(JsonPath.<List<String>>read(logs(a, "?tbl=report_amount&actor=" + actor), "$.data.rows[*].target"))
            .as("系统管理员").containsExactly("旧版删掉的公司");
        String tb = login(mkUser(a, "it-old-tb", mkRole(a, "it_old_tb", "[\"sys-logs:view\",\"trial-balance:view\"]")), PASS);
        assertThat(total(logs(tb, "?tbl=report_amount&actor=" + actor))).as("只看科目余额表的").isEqualTo(1);
        String ledger = login(mkUser(a, "it-old-ld", mkRole(a, "it_old_ld", "[\"sys-logs:view\",\"ledger:view\"]")), PASS);
        assertThat(total(logs(ledger, "?src=change&actor=" + actor))).as("一张报表都看不了的").isZero();
    }

    // ══════════ helpers ══════════

    private void asUser(String name, Runnable r) {
        SecurityContextHolder.getContext().setAuthentication(new TestingAuthenticationToken(name, null));
        try { r.run(); } finally { SecurityContextHolder.clearContext(); }
    }

    private String logs(String token, String query) throws Exception {
        return body(mvc.perform(get("/api/system/logs" + query).header("Authorization", hdr(token))).andReturn());
    }

    private static long total(String body) { return ((Number) JsonPath.read(body, "$.data.total")).longValue(); }

    private int loginCode(String ip, String user, String pass) throws Exception {
        return JsonPath.read(body(mvc.perform(post("/api/auth/login").header("X-Forwarded-For", ip)
            .contentType("application/json")
            .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}")).andReturn()), "$.code");
    }

    private String admin() throws Exception { return login("admin", "admin123"); }
    private String hdr(String t) { return "Bearer " + t; }

    private String login(String user, String pass) throws Exception {
        return JsonPath.read(body(mvc.perform(post("/api/auth/login").contentType("application/json")
            .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}")).andReturn()), "$.data.token");
    }

    private String body(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private int mkRole(String token, String codePrefix, String permsJson) throws Exception {
        String b = body(mvc.perform(post("/api/system/roles").header("Authorization", hdr(token))
            .contentType("application/json")
            .content("{\"code\":\"" + codePrefix + "_" + System.nanoTime() % 100000 + "\",\"name\":\"日志测试\","
                   + "\"navLayers\":[\"data\"],\"perms\":" + permsJson + "}")).andReturn());
        assertThat((int) JsonPath.read(b, "$.code")).as(b).isZero();
        return JsonPath.read(b, "$.data.id");
    }

    private String mkUser(String token, String prefix, int roleId) throws Exception {
        String uname = prefix + "-" + System.nanoTime();
        String b = body(mvc.perform(post("/api/system/users").header("Authorization", hdr(token))
            .contentType("application/json")
            .content("{\"username\":\"" + uname + "\",\"displayName\":\"日志测试\",\"password\":\"" + PASS
                   + "\",\"roleIds\":[" + roleId + "]}")).andReturn());
        assertThat((int) JsonPath.read(b, "$.code")).as(b).isZero();
        passwordAlreadyChanged(uname);
        return uname;
    }
}
