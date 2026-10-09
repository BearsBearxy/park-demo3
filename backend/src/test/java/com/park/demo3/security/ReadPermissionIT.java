package com.park.demo3.security;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 读写分开(RBAC-SPEC §11)在 v4(§15,每屏一个查看)下的端到端:真登录,真走 SecurityConfig → ReadAccessManager。
 *
 * 不带 @Transactional:要用新建账号登录(权限缓存走 reload 那条路径)。账号与自建角色 @AfterEach 用 jdbc 删掉;
 * 业务数据落在独占的 2080 年或带 IT-V3 前缀的行,各用例 finally 里删。
 * 每条用例头上写了它的破坏验证:改坏哪一处、哪条断言红。
 */
@AutoConfigureMockMvc
class ReadPermissionIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserPermissionCache cache;

    private static final String PASS = "init-pass-123";
    private final List<String> users = new ArrayList<>();
    private final List<Integer> roles = new ArrayList<>();
    private String admin;

    @BeforeEach
    void loginAdmin() throws Exception { admin = login("admin", "admin123"); }   // 单会话:每个用例只登一次

    @AfterEach
    void cleanup() {
        for (String u : users) {
            jdbc.update("DELETE FROM auth_audit_log WHERE actor=? OR authorizer=?", u, u);
            jdbc.update("DELETE FROM auth_session WHERE username=?", u);
            jdbc.update("DELETE aur FROM auth_user_role aur JOIN auth_user x ON x.id=aur.user_id WHERE x.username=?", u);
            jdbc.update("DELETE FROM auth_user WHERE username=?", u);
        }
        for (Integer r : roles) jdbc.update("DELETE FROM auth_role WHERE id=?", r);
        cache.reload();
    }

    // ══ 读默认拒绝,缺查看就 403,文案写明缺哪一屏(K10:needText 三档) ══

    /**
     * 破坏验证:SecurityConfig 的 GET 规则改回 .authenticated() → 403 断言红;
     *          ReadAccessManager.deniedMessage 不走 Perm.needText(把十几个屏名糊在一句) → 「等 12 项」那条红。
     */
    @Test
    void withoutContractsView_contractReadsAre403_andTheMessageNamesTheMissingScreens() throws Exception {
        String t = userWith("buildings:view");

        MvcResult r = mvc.perform(get("/api/contracts/1/terminate-preview")
                .header("Authorization", hdr(t))).andReturn();
        assertThat(r.getResponse().getStatus()).isEqualTo(403);
        assertThat((String) JsonPath.read(body(r), "$.message"))
            .isEqualTo("无查看权限：需要「合同管理 · 查看」，请联系系统管理员在角色里勾上");
        // 2–3 项:「A」或「B」其中一项
        assertThat((String) JsonPath.read(body(mvc.perform(get("/api/contracts/1").header("Authorization", hdr(t))).andReturn()),
                "$.message"))
            .isEqualTo("无查看权限：需要「合同管理 · 查看」或「租户对标 · 查看」其中一项，请联系系统管理员在角色里勾上");
        // 4 项及以上:按 ALL 顺序取前两项,写总数 —— /api/tenants 被 12 屏共用
        assertThat((String) JsonPath.read(body(mvc.perform(get("/api/tenants").header("Authorization", hdr(t))).andReturn()),
                "$.message"))
            .isEqualTo("无查看权限：需要「租户管理 · 查看」「合同管理 · 查看」等 12 项中的任一项，请联系系统管理员在角色里勾上");
        // 对照:同一个账号读楼栋是 200 —— 挡住的是别的屏,不是整个账号
        assertThat(statusOf(get("/api/buildings"), t)).isEqualTo(200);
    }

    // ══ 园区股东 = 报表 10 屏 + 分析 20 屏 + 导入中心(v3 就打得开导入中心),分析独立放行 ══

    /**
     * 分析屏实际调到的模块接口能读(不要求对应数据屏的查看);数据屏自己的明细与工资读不到。
     * v4 收紧的两条:租户 / 合同的 KPI 汇总(/summary)分析层不调,只给本屏。
     * 破坏验证:读规则 /api/contracts/{id} 去掉 tenant-peer → 「应能读」那一格红;
     *          /api/tenants/summary 放回分析 → 「不应能读」那一格红。
     */
    @Test
    void shareholder_readsWhatItsScreensCall_butNotModuleDetailOrSalary() throws Exception {
        String t = userInRole(roleIdOf("shareholder"));
        List<String> perms = JsonPath.read(body(mvc.perform(get("/api/auth/me").header("Authorization", hdr(t)))
            .andReturn()), "$.data.permissions");
        List<String> want = new ArrayList<>();
        for (Perm.Screen s : Perm.SCREENS)
            if (!"data".equals(s.layer()) && !"system".equals(s.layer())) want.add(s.value() + ":view");
        want.add("import:view");
        assertThat(perms).as("报表 10 + 分析 20 + 导入中心;/auth/me 不带旧键").containsExactlyInAnyOrderElementsOf(want);

        int tenantId = jdbc.queryForObject("SELECT MIN(id) FROM tenant", Integer.class);
        int contractId = jdbc.queryForObject("SELECT MIN(id) FROM contract", Integer.class);
        for (String ok : List.of("/api/analysis/months", "/api/buildings/summary", "/api/tenants", "/api/contracts",
                "/api/contracts/" + contractId, "/api/companies", "/api/budget/all", "/api/pnl/s2/2025",
                "/api/reports/is/1/2025/10", "/api/reports/is/1/years", "/api/reports/tb/1/2025/10",
                "/api/import-log/overview", "/api/review/pending", "/api/notices")) {
            assertThat(statusOf(get(ok), t)).as("股东应能读 " + ok).isEqualTo(200);
        }
        for (String no : List.of("/api/tenants/" + tenantId, "/api/tenants/summary", "/api/contracts/summary",
                "/api/contracts/" + contractId + "/terminate-preview", "/api/meters", "/api/ledger/companies/1/years",
                "/api/alloc/years", "/api/bill-notices", "/api/salary/overview", "/api/salary/records?year=2025&month=1")) {
            assertThat(statusOf(get(no), t)).as("股东不应能读 " + no).isEqualTo(403);
        }
        // 可批人接口不收不可提权的点 —— 收的话它就是「谁有工资查看权」的花名册,任何已登录账号都能查。
        // 破坏验证:ApprovalService.candidates 去掉 requireElevatable → 第一条红
        assertThat((int) JsonPath.read(getBody("/api/auth/approvals/candidates?perms=salary:view", t), "$.code"))
            .isEqualTo(403);
        assertThat((int) JsonPath.read(getBody("/api/auth/approvals/candidates?perms=ledger:edit", t), "$.code"))
            .as("对照:可提权的点照常列人").isZero();
    }

    // ══ 敏感字段服务端打码:联系人归「租户管理 · 查看」,收款账号归「催缴单 · 查看」 ══

    /**
     * 没有租户查看与催缴单查看的人(这里是合同查看 + 现金流量分析)读到的租户联系人、合同详情里的租户快照、
     * 个人卡户名与收款账号都是掩码;写回时提交掩码 = 没改。
     * 破坏验证:TenantService.buildTenantDto 的 plain 恒 true → 租户掩码断言红;
     *          CompanyService.toDTO 的 plain 恒 true → 账号掩码断言红;
     *          TenantService 的别名明文改回含导入中心 / 不含数据层 → 别名那两条之一红。
     */
    @Test
    void sensitiveFieldsAreMaskedServerSide_withoutTenantsOrBillNoticesView() throws Exception {
        String ana = userWith("contracts:view", "fin-cashflow:view");
        String anaOnly = userWith("park:view", "income-statement:view", "import:view");   // 没有数据层 17 屏的查看
        String name = "IT-V3打码户" + System.nanoTime();
        int tid = JsonPath.read(body(mvc.perform(post("/api/tenants").header("Authorization", hdr(admin))
            .contentType("application/json")
            .content("{\"companyName\":\"" + name + "\",\"businessType\":\"测试\",\"aliases\":\"宋测试，冯测\","
                   + "\"contactName\":\"王小明\",\"contactPhone\":\"13812345678\"}")).andReturn()), "$.data.id");
        int companyId = jdbc.queryForObject("SELECT MIN(id) FROM management_company", Integer.class);
        int aid = JsonPath.read(body(mvc.perform(post("/api/companies/" + companyId + "/accounts")
            .header("Authorization", hdr(admin)).contentType("application/json")
            .content("{\"kind\":\"personal\",\"accountName\":\"李四\",\"accountNo\":\"6222020200112345678\","
                   + "\"bankName\":\"工商银行\"}")).andReturn()), "$.data.id");
        try {
            String path = "$.data[?(@.id==" + tid + ")]";
            Map<String, Object> masked = one(JsonPath.read(getBody("/api/tenants", ana), path));
            assertThat(masked.get("contactPhone")).isEqualTo("138****5678");
            assertThat(masked.get("contactName")).isEqualTo("王**");
            Map<String, Object> plain = one(JsonPath.read(getBody("/api/tenants", admin), path));
            assertThat(plain.get("contactPhone")).isEqualTo("13812345678");
            assertThat(plain.get("contactName")).isEqualTo("王小明");

            // 别名里是老板姓名:有数据层 17 屏任一查看的(这里是合同查看)要拿它对户,给明文;
            // 只有报表 / 分析 / 导入中心查看的逐项打码(园区股东迁移后有导入中心查看,含了它他就多拿到别名明文)
            assertThat(masked.get("aliases")).isEqualTo("宋测试，冯测");
            assertThat(one(JsonPath.read(getBody("/api/tenants", anaOnly), path)).get("aliases")).isEqualTo("宋**,冯*");

            // 写回:提交的是现值的掩码 = 没改
            mvc.perform(put("/api/tenants/" + tid).header("Authorization", hdr(admin)).contentType("application/json")
                .content("{\"companyName\":\"" + name + "\",\"businessType\":\"测试\",\"status\":1,\"aliases\":\"宋**,冯*\","
                       + "\"contactName\":\"王**\",\"contactPhone\":\"138****5678\"}"))
               .andExpect(status().isOk());
            assertThat(jdbc.queryForMap("SELECT contact_name n, contact_phone p, aliases a FROM tenant WHERE id=?", tid))
                .containsEntry("n", "王小明").containsEntry("p", "13812345678").containsEntry("a", "宋测试，冯测");

            // 合同详情里的租户快照:取的是 tenant 表现值,归租户屏,只有合同查看的人拿掩码
            Map<String, Object> c = jdbc.queryForMap("SELECT c.id id, t.contact_phone p FROM contract c "
                + "JOIN tenant t ON t.id = c.tenant_id WHERE CHAR_LENGTH(t.contact_phone) >= 11 ORDER BY c.id LIMIT 1");
            String phone = (String) c.get("p");
            String snap = getBody("/api/contracts/" + c.get("id"), ana);
            assertThat((String) JsonPath.read(snap, "$.data.tenant.contactPhone"))
                .isEqualTo(phone.substring(0, 3) + "****" + phone.substring(phone.length() - 4))
                .isNotEqualTo(phone);
            assertThat((String) JsonPath.read(getBody("/api/contracts/" + c.get("id"), admin), "$.data.tenant.contactPhone"))
                .isEqualTo(phone);

            // 收款账户:账号只留后 4 位、个人卡户名只留姓;开户行不打码
            String acct = "$.data[*].accounts[?(@.id==" + aid + ")]";
            Map<String, Object> ma = one(JsonPath.read(getBody("/api/companies", ana), acct));
            assertThat(ma.get("accountNo")).isEqualTo("****5678");
            assertThat(ma.get("accountName")).isEqualTo("李*");
            assertThat(ma.get("bankName")).isEqualTo("工商银行");
            Map<String, Object> pa = one(JsonPath.read(getBody("/api/companies", admin), acct));
            assertThat(pa.get("accountNo")).isEqualTo("6222020200112345678");
            assertThat(pa.get("accountName")).isEqualTo("李四");

            mvc.perform(put("/api/company-accounts/" + aid).header("Authorization", hdr(admin))
                .contentType("application/json")
                .content("{\"kind\":\"personal\",\"accountName\":\"李*\",\"accountNo\":\"****5678\"}"))
               .andExpect(status().isOk());
            assertThat(jdbc.queryForMap("SELECT account_name n, account_no a FROM company_account WHERE id=?", aid))
                .containsEntry("n", "李四").containsEntry("a", "6222020200112345678");
        } finally {
            jdbc.update("DELETE FROM company_account WHERE id=?", aid);
            jdbc.update("DELETE FROM tenant WHERE id=?", tid);
        }
    }

    /**
     * 本月出账只要「本月出账 · 查看」,催缴单那一步的「· ¥总额」另按「催缴单 · 查看」判。独占 2080-03 / 2080-04。
     * 破坏验证:DataHomeService 把 noticeTotal 无条件传进 buildChain → 「不含 ¥」断言红。
     */
    @Test
    void dataHome_noticeTotalNeedsBillNoticesView() throws Exception {
        String t = userWith("data-home:view");
        jdbc.update("INSERT INTO tenant(company_name, business_type) VALUES('IT-V3首页户', 'factory')");
        int tid = jdbc.queryForObject("SELECT MAX(id) FROM tenant", Integer.class);
        try {
            jdbc.update("INSERT INTO bill_notice(ym, tenant_id, notice_kind, total_amount, prev_due, status, generated_at) "
                    + "VALUES('2080-04', ?, 'combined', 12.5, 0, 'draft', NOW())", tid);
            String step = "$.data.chain.steps[?(@.key=='bill-notices')].detail";
            List<String> noMoney = JsonPath.read(getBody("/api/data-home/overview?ym=2080-03", t), step);
            assertThat(noMoney).containsExactly("4月的单 · 1 张");
            List<String> money = JsonPath.read(getBody("/api/data-home/overview?ym=2080-03", admin), step);
            assertThat(money).containsExactly("4月的单 · 1 张 · ¥12.50");
        } finally {
            jdbc.update("DELETE FROM bill_notice WHERE tenant_id = ?", tid);
            jdbc.update("DELETE FROM tenant WHERE id = ?", tid);
        }
    }

    // ══ 工资:读只认 salary:view,写只认 salary:edit;月度台账编辑两样都不给 ══

    /**
     * 破坏验证:读规则 /api/salary/** 改成台账查看 → 录入员读 403 两条红;
     *          PermissionRegistry 把 "/api/salary" 挂到台账编辑 → 录入员写 403 那几条红。
     */
    @Test
    void salary_readsNeedSalaryView_writesNeedSalaryEdit_ledgerEditGetsNeither() throws Exception {
        String clerk = userWith("ledger:edit");
        String hr = userWith("salary:view");
        String payroll = userWith(Perm.SALARY_EDIT);
        String created = body(mvc.perform(post("/api/salary/records").header("Authorization", hdr(payroll))
            .contentType("application/json")
            .content("{\"acctMonth\":\"2080-01\",\"name\":\"IT-V3工资人\",\"base\":5000}"))
            .andExpect(status().isOk()).andReturn());
        int id = JsonPath.read(created, "$.data.id");
        try {
            assertThat((String) JsonPath.read(created, "$.data.name")).as("回包整行:写的人本来就看得见").isEqualTo("IT-V3工资人");
            assertThat(statusOf(get("/api/salary/records?year=2080&month=1"), payroll))
                .as("录入员读得到:salary:edit 隐含本屏查看").isEqualTo(200);

            assertThat(statusOf(get("/api/salary/overview"), clerk)).isEqualTo(403);
            assertThat(statusOf(get("/api/salary/records?year=2080&month=1"), clerk)).isEqualTo(403);
            String json = "application/json";
            assertThat(statusOf(post("/api/salary/records").contentType(json)
                .content("{\"acctMonth\":\"2080-01\",\"name\":\"IT-V3专员\",\"base\":1}"), clerk)).isEqualTo(403);
            assertThat(statusOf(patch("/api/salary/records/" + id + "/note").contentType(json)
                .content("{\"note\":\"x\"}"), clerk)).isEqualTo(403);
            assertThat(statusOf(delete("/api/salary/records/" + id), clerk)).isEqualTo(403);
            assertThat(statusOf(post("/api/salary/import?year=2080&month=1").contentType(json)
                .content("{\"rows\":[{\"tenantName\":\"IT-V3专员\"}]}"), clerk)).isEqualTo(403);
            assertThat(statusOf(delete("/api/salary/imported?year=2080&month=1"), clerk)).isEqualTo(403);
            assertThat(statusOf(delete("/api/salary/batch").contentType(json)
                .content("{\"ids\":[" + id + "]}"), clerk)).isEqualTo(403);
            assertThat(statusOf(patch("/api/salary/records/" + id + "/note").contentType(json)
                .content("{\"note\":\"x\"}"), hr)).isEqualTo(403);

            List<String> names = JsonPath.read(getBody("/api/salary/records?year=2080&month=1", hr), "$.data.rows[*].name");
            assertThat(names).as("被拒的写一行都没落").containsExactly("IT-V3工资人");
        } finally {
            jdbc.update("DELETE FROM salary_record WHERE acct_month = '2080-01'");
        }
    }

    /**
     * 餐补逐月合计:损益附表一屏的查看就读得到 12 个月的合计,读不到逐人明细。独占 2080 年。
     * 破坏验证:删掉读规则 /api/salary/lunch-totals → 附表1 查看 200 那条红(落进 /api/salary/** 只认 salary:view)。
     */
    @Test
    void lunchTotals_pnlViewReadsMonthlySums_butNotPerPersonRows() throws Exception {
        String report = userWith("rent-pnl:view");
        String ledger = userWith("ledger:view");
        jdbc.update("INSERT INTO salary_record(acct_month, emp_idx, name, lunch, source) VALUES "
            + "('2080-01', 1, 'IT-V3餐补甲', 300.00, 'manual'), ('2080-01', 2, 'IT-V3餐补乙', 150.50, 'manual'), "
            + "('2080-03', 1, 'IT-V3餐补甲', 0.00, 'manual'), ('2079-01', 1, 'IT-V3餐补丙', 999.00, 'manual')");
        try {
            List<Object> ms = JsonPath.read(getBody("/api/salary/lunch-totals?year=2080", report), "$.data");
            assertThat(ms).hasSize(12);
            assertThat(new BigDecimal(String.valueOf(ms.get(0)))).isEqualByComparingTo("450.50");
            assertThat(ms.get(1)).as("没录工资的月是 null,不是 0").isNull();
            assertThat(new BigDecimal(String.valueOf(ms.get(2)))).as("录了、餐补合计 0").isEqualByComparingTo("0");

            assertThat(statusOf(get("/api/salary/records?year=2080&month=1"), report))
                .as("逐人明细仍只给工资查看").isEqualTo(403);
            assertThat(statusOf(get("/api/salary/lunch-totals?year=2080"), ledger)).isEqualTo(403);
        } finally {
            jdbc.update("DELETE FROM salary_record WHERE name LIKE 'IT-V3餐补%'");
        }
    }

    /**
     * 收款账户(v4):账户维护挪到了催缴单屏的收款公司窗,有「催缴单 · 查看」在 /payees 与 /companies 都拿明文;
     * 没有它的(月度台账查看)读 /companies 是掩码、读 /payees 直接 403。
     * 破坏验证:读规则 /api/companies/payees 并上台账查看 → 「台账查看 403」那条红;
     *          CompanyService.list 只按 listForNotice 那条判 → 「/companies 明文」那条红。
     */
    @Test
    void payees_billNoticesViewSeesFullAccount_othersMasked() throws Exception {
        String billing = userWith("bill-notices:view");
        String ledger = userWith("ledger:view");
        int companyId = jdbc.queryForObject("SELECT MIN(id) FROM management_company", Integer.class);
        int aid = JsonPath.read(body(mvc.perform(post("/api/companies/" + companyId + "/accounts")
            .header("Authorization", hdr(admin)).contentType("application/json")
            .content("{\"kind\":\"personal\",\"accountName\":\"李四\",\"accountNo\":\"6222020200112345678\","
                   + "\"bankName\":\"工商银行\"}")).andReturn()), "$.data.id");
        try {
            String acct = "$.data[*].accounts[?(@.id==" + aid + ")]";
            Map<String, Object> full = one(JsonPath.read(getBody("/api/companies/payees", billing), acct));
            assertThat(full.get("accountNo")).isEqualTo("6222020200112345678");
            assertThat(full.get("accountName")).isEqualTo("李四");
            assertThat(one(JsonPath.read(getBody("/api/companies", billing), acct)).get("accountNo"))
                .as("收款公司窗同一判据").isEqualTo("6222020200112345678");

            assertThat(statusOf(get("/api/companies/payees"), ledger)).isEqualTo(403);
            Map<String, Object> masked = one(JsonPath.read(getBody("/api/companies", ledger), acct));
            assertThat(masked.get("accountNo")).isEqualTo("****5678");
            assertThat(masked.get("accountName")).isEqualTo("李*");
        } finally {
            jdbc.update("DELETE FROM company_account WHERE id=?", aid);
        }
    }

    // ══ 编辑 / 专有动作隐含本屏查看,在装载快照时展开,不落库,不跨屏 ══

    /**
     * 破坏验证:UserPermissionCache 不调 Perm.withImplied → /api/contracts 的 200 与 me 里的两项查看红;
     *          IMPLIED_VIEW 漏了专有动作(只认 :edit 结尾) → ledger:view 那一项红。
     */
    @Test
    void actionsImplyOwnScreenView_atLoadTime_notStored_notAcrossScreens() throws Exception {
        String t = userWith("contracts:edit", "ledger:company");
        List<String> perms = JsonPath.read(getBody("/api/auth/me", t), "$.data.permissions");
        assertThat(perms).as("新增删除公司只带出月度台账查看,不带出报表屏")
            .containsExactlyInAnyOrder("contracts:edit", "contracts:view", "ledger:company", "ledger:view");
        assertThat(statusOf(get("/api/contracts"), t)).isEqualTo(200);
        assertThat(statusOf(get("/api/ledger/companies/1/years"), t)).isEqualTo(200);
        assertThat(statusOf(get("/api/reports/is/1/years"), t)).isEqualTo(403);
        assertThat(statusOf(get("/api/salary/overview"), t)).isEqualTo(403);

        List<String> stored = jdbc.queryForList("SELECT perm FROM auth_role_perm WHERE role_id=?", String.class,
            roles.get(roles.size() - 1));
        assertThat(stored).as("隐含的查看不落库").containsExactlyInAnyOrder("contracts:edit", "ledger:company");
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /** 建一个只带这几个点的自建角色,挂一个新账号,返回它的令牌。 */
    private String userWith(String... perms) throws Exception {
        String code = "it_v3_" + System.nanoTime() % 1_000_000_000L;
        String ps = Arrays.stream(perms).map(p -> "\"" + p + "\"").collect(Collectors.joining(","));
        String r = body(mvc.perform(post("/api/system/roles").header("Authorization", hdr(admin))
            .contentType("application/json")
            .content("{\"code\":\"" + code + "\",\"name\":\"读写分开测试\",\"navLayers\":[\"data\"],\"perms\":[" + ps + "]}"))
            .andExpect(status().isOk()).andReturn());
        assertThat((int) JsonPath.read(r, "$.code")).as(r).isZero();
        int roleId = JsonPath.read(r, "$.data.id");
        roles.add(roleId);
        return userInRole(roleId);
    }

    private String userInRole(int roleId) throws Exception {
        String u = "it-v3-" + System.nanoTime();
        users.add(u);
        String r = body(mvc.perform(post("/api/system/users").header("Authorization", hdr(admin))
            .contentType("application/json")
            .content("{\"username\":\"" + u + "\",\"displayName\":\"读写分开\",\"password\":\"" + PASS
                   + "\",\"roleIds\":[" + roleId + "]}"))
            .andExpect(status().isOk()).andReturn());
        assertThat((int) JsonPath.read(r, "$.code")).as(r).isZero();
        passwordAlreadyChanged(u);
        return login(u, PASS);
    }

    private int roleIdOf(String code) {
        return jdbc.queryForObject("SELECT id FROM auth_role WHERE code=?", Integer.class, code);
    }

    private String login(String u, String p) throws Exception {
        String b = body(mvc.perform(post("/api/auth/login").contentType("application/json")
            .content("{\"username\":\"" + u + "\",\"password\":\"" + p + "\"}")).andReturn());
        return JsonPath.read(b, "$.data.token");
    }

    private int statusOf(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder req, String token)
            throws Exception {
        return mvc.perform(req.header("Authorization", hdr(token))).andReturn().getResponse().getStatus();
    }

    private String getBody(String url, String token) throws Exception {
        return body(mvc.perform(get(url).header("Authorization", hdr(token))).andExpect(status().isOk()).andReturn());
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> one(List<?> hits) {
        assertThat(hits).hasSize(1);
        return (Map<String, Object>) hits.get(0);
    }

    private static String hdr(String t) { return "Bearer " + t; }

    private static String body(MvcResult r) {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }
}
