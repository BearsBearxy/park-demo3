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
 * v3「读写分开」(RBAC-SPEC §11,2026-10-04 用户拍板)端到端:真登录,真走 SecurityConfig → ReadAccessManager。
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

    // ══ 规则 2:读默认拒绝,缺查看点就 403,文案写明缺哪一项 ══

    /**
     * 破坏验证:SecurityConfig 的 GET 规则改回 .authenticated() → 两条 403 断言红;
     *          accessDeniedHandler 对 GET 仍套 FORBIDDEN 通用句 → 文案断言红。
     */
    @Test
    void withoutContractView_contractReadsAre403_andTheMessageNamesTheMissingPerm() throws Exception {
        String t = userWith(Perm.MASTER_VIEW);

        MvcResult r = mvc.perform(get("/api/contracts/1/terminate-preview")
                .header("Authorization", hdr(t))).andReturn();
        assertThat(r.getResponse().getStatus()).isEqualTo(403);
        assertThat((String) JsonPath.read(body(r), "$.message"))
            .isEqualTo("无查看权限：需要「合同 · 查看」，请联系系统管理员在角色里勾上");
        assertThat(statusOf(get("/api/contracts/summary"), t)).isEqualTo(403);
        // 对照:同一个账号读主数据是 200 —— 挡住的是合同这一块,不是整个账号
        assertThat(statusOf(get("/api/buildings"), t)).isEqualTo(200);
    }

    // ══ 规则 4 + 7:园区股东 = analysis:view + report:view,分析独立放行 ══

    /**
     * 分析专用接口、分析白名单里的模块接口与报表(含科目余额表)都能读;模块自己的明细(租户详情、合同终止预览、
     * 抄表、台账、公摊结果、催缴单)与工资读不到。
     * 破坏验证:读规则 /api/tenants/summary 去掉 ANALYSIS_VIEW → 白名单那一格红;
     *          SecurityConfig 的 GET 改回 .authenticated() → 「不应能读」那一格红。
     */
    @Test
    void shareholder_readsAnalysisAndItsWhitelist_butNotModuleDetailOrSalary() throws Exception {
        String t = userInRole(roleIdOf("shareholder"));
        List<String> perms = JsonPath.read(body(mvc.perform(get("/api/auth/me").header("Authorization", hdr(t)))
            .andReturn()), "$.data.permissions");
        assertThat(perms).containsExactlyInAnyOrder(Perm.ANALYSIS_VIEW, Perm.REPORT_VIEW);

        int tenantId = jdbc.queryForObject("SELECT MIN(id) FROM tenant", Integer.class);
        int contractId = jdbc.queryForObject("SELECT MIN(id) FROM contract", Integer.class);
        for (String ok : List.of("/api/analysis/months", "/api/tenants/summary", "/api/contracts/summary",
                "/api/buildings/summary", "/api/tenants", "/api/contracts", "/api/contracts/" + contractId,
                "/api/companies", "/api/budget/all", "/api/pnl/s2/2025", "/api/reports/is/1/2025/10",
                "/api/reports/is/1/years", "/api/reports/tb/1/2025/10", "/api/review/pending", "/api/notices")) {
            assertThat(statusOf(get(ok), t)).as("股东应能读 " + ok).isEqualTo(200);
        }
        for (String no : List.of("/api/tenants/" + tenantId, "/api/contracts/" + contractId + "/terminate-preview",
                "/api/meters", "/api/ledger/companies/1/years", "/api/alloc/years", "/api/bill-notices",
                "/api/salary/overview", "/api/salary/records?year=2025&month=1")) {
            assertThat(statusOf(get(no), t)).as("股东不应能读 " + no).isEqualTo(403);
        }
        // 可批人接口不收不可提权的点 —— 收的话它就是「谁有工资查看权」的花名册,任何已登录账号都能查。
        // 破坏验证:ApprovalService.candidates 去掉 requireElevatable → 第一条红
        assertThat((int) JsonPath.read(getBody("/api/auth/approvals/candidates?perms=salary:view", t), "$.code"))
            .isEqualTo(403);
        assertThat((int) JsonPath.read(getBody("/api/auth/approvals/candidates?perms=entry:edit", t), "$.code"))
            .as("对照:可提权的点照常列人").isZero();
    }

    // ══ 规则 5:敏感字段服务端打码 ══

    /**
     * 没有 master:view 的人(这里只有 analysis:view + contract:view)读到的租户联系人、合同详情里的租户快照、
     * 个人卡户名与收款账号都是掩码,有 master:view 的人是明文;写回时提交掩码 = 没改。
     * 破坏验证:TenantService.buildTenantDto 的 plain 恒 true → 租户掩码断言红;
     *          CompanyService.toDTO 的 plain 恒 true → 账号掩码断言红;
     *          TenantService.update 去掉 keepIfMasked → 写回断言红(库里变成星号)。
     */
    @Test
    void sensitiveFieldsAreMaskedServerSide_withoutMasterView() throws Exception {
        String ana = userWith(Perm.ANALYSIS_VIEW, Perm.CONTRACT_VIEW);
        String anaOnly = userWith(Perm.ANALYSIS_VIEW, Perm.REPORT_VIEW);   // 股东那一档:没有任何数据层查看
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
            // 租户列表:按 id 取这一行
            String path = "$.data[?(@.id==" + tid + ")]";
            Map<String, Object> masked = one(JsonPath.read(getBody("/api/tenants", ana), path));
            assertThat(masked.get("contactPhone")).isEqualTo("138****5678");
            assertThat(masked.get("contactName")).isEqualTo("王**");
            Map<String, Object> plain = one(JsonPath.read(getBody("/api/tenants", admin), path));
            assertThat(plain.get("contactPhone")).isEqualTo("13812345678");
            assertThat(plain.get("contactName")).isEqualTo("王小明");

            // 别名里是老板姓名:有数据层查看的(这里是合同查看)要拿它对户,给明文;只有分析 / 报表查看的逐项打码。
            // 破坏验证:buildTenantDto 的 aliasPlain 恒 true → 「宋**,冯*」那条红
            assertThat(masked.get("aliases")).isEqualTo("宋测试，冯测");
            assertThat(one(JsonPath.read(getBody("/api/tenants", anaOnly), path)).get("aliases")).isEqualTo("宋**,冯*");

            // 写回:提交的是现值的掩码 = 没改(提权拿到 master:edit 的人表单里回填的就是它)
            // 破坏验证:TenantService.update 的 aliases 去掉 keepIfMasked → 库里别名变成「宋**,冯*」
            mvc.perform(put("/api/tenants/" + tid).header("Authorization", hdr(admin)).contentType("application/json")
                .content("{\"companyName\":\"" + name + "\",\"businessType\":\"测试\",\"status\":1,\"aliases\":\"宋**,冯*\","
                       + "\"contactName\":\"王**\",\"contactPhone\":\"138****5678\"}"))
               .andExpect(status().isOk());
            assertThat(jdbc.queryForMap("SELECT contact_name n, contact_phone p, aliases a FROM tenant WHERE id=?", tid))
                .containsEntry("n", "王小明").containsEntry("p", "13812345678").containsEntry("a", "宋测试，冯测");

            // 合同详情里的租户快照:取的是 tenant 表现值,归 master,只有 contract:view 的人拿掩码
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
     * 本月出账枢纽对数据层任一 view 开放,催缴单那一步的「· ¥总额」另按 billing:view 判。独占 2080-03 / 2080-04。
     * 破坏验证:DataHomeService 把 noticeTotal 无条件传进 buildChain → 「不含 ¥」断言红。
     */
    @Test
    void dataHome_noticeTotalNeedsBillingView() throws Exception {
        String t = userWith(Perm.ENTRY_VIEW);
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

    // ══ 工资:只认 salary:view,entry:edit 不隐含它;写接口回包也按它收 ══

    /**
     * 破坏验证:读规则 /api/salary/** 改成 ENTRY_VIEW → 两条 403 断言红;
     *          SalaryService.visible 直接 return d → 回包 name/base 断言红。
     */
    @Test
    void salary_onlySalaryViewReads_andWriteResponsesHideTheRow() throws Exception {
        String clerk = userWith(Perm.ENTRY_EDIT);
        String hr = userWith(Perm.SALARY_VIEW);
        String created = body(mvc.perform(post("/api/salary/records").header("Authorization", hdr(admin))
            .contentType("application/json")
            .content("{\"acctMonth\":\"2080-01\",\"name\":\"IT-V3工资人\",\"base\":5000}")).andReturn());
        int id = JsonPath.read(created, "$.data.id");
        try {
            assertThat((String) JsonPath.read(created, "$.data.name")).as("有 salary:view 的管理员看整行").isEqualTo("IT-V3工资人");

            assertThat(statusOf(get("/api/salary/overview"), clerk)).isEqualTo(403);
            assertThat(statusOf(get("/api/salary/records?year=2080&month=1"), clerk)).isEqualTo(403);

            String patched = body(mvc.perform(patch("/api/salary/records/" + id + "/note")
                .header("Authorization", hdr(clerk)).contentType("application/json").content("{\"note\":\"x\"}"))
                .andExpect(status().isOk()).andReturn());
            assertThat((int) JsonPath.read(patched, "$.code")).isZero();
            assertThat((int) JsonPath.read(patched, "$.data.id")).isEqualTo(id);
            assertThat((Object) JsonPath.read(patched, "$.data.name")).isNull();
            assertThat((Object) JsonPath.read(patched, "$.data.base")).isNull();

            List<String> names = JsonPath.read(getBody("/api/salary/records?year=2080&month=1", hr), "$.data.rows[*].name");
            assertThat(names).contains("IT-V3工资人");
        } finally {
            jdbc.update("DELETE FROM salary_record WHERE acct_month = '2080-01'");
        }
    }

    // ══ 规则 1:编辑隐含查看,在装载快照时展开,不落库 ══

    /** 破坏验证:UserPermissionCache 不调 Perm.withImplied → /api/contracts 的 200 与 me 里的 contract:view 红。 */
    @Test
    void editImpliesView_atLoadTime_notStored_andNeverSalary() throws Exception {
        String t = userWith(Perm.CONTRACT_EDIT, Perm.ENTRY_EDIT);
        List<String> perms = JsonPath.read(getBody("/api/auth/me", t), "$.data.permissions");
        assertThat(perms).containsExactlyInAnyOrder(Perm.CONTRACT_EDIT, Perm.ENTRY_EDIT,
            Perm.CONTRACT_VIEW, Perm.ENTRY_VIEW);
        assertThat(statusOf(get("/api/contracts"), t)).isEqualTo(200);
        assertThat(statusOf(get("/api/salary/overview"), t)).isEqualTo(403);

        List<String> stored = jdbc.queryForList("SELECT perm FROM auth_role_perm WHERE role_id=?", String.class,
            roles.get(roles.size() - 1));
        assertThat(stored).as("隐含的查看不落库").containsExactlyInAnyOrder(Perm.CONTRACT_EDIT, Perm.ENTRY_EDIT);
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
