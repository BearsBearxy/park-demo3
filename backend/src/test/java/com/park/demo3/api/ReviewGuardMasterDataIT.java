package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 主数据两条**真的会往回改已审月**的删除口(2026-09-09 逐条过完 25 条候选之后只剩这两条)。
 *
 * 与兄弟用例的分工:ReviewGuardIT 钉闸本身的行为,ReviewGuardChainIT 钉出账链五键的挂点,
 * 这里钉的是「主数据也有两条要守」以及**守得准不准** —— 后者才是这一轮的风险所在:
 * 给主数据一刀切挂 assertNoLockedMonth 会让「1 月审过 → 再也不能新增租户/删公司」,
 * 系统当场不能用。所以每条 423 都配一条「换个 scope 就该放行」的反证,少了那半边,
 * 守卫是不是把整个系统锁死了,这份用例看不出来。
 *
 * 类上 @Transactional:本用例建公司/建租户/塞 s10 行,全靠回滚清场,不污染复用容器。
 * 用远期空月 2031-08:园区数据到不了那里,任何一条断言红了都只可能是守卫的问题。
 */
@AutoConfigureMockMvc
@org.springframework.transaction.annotation.Transactional
class ReviewGuardMasterDataIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    private static final String YM = "2031-08";

    // ══ 删公司:四把 COMPANY scope 的键,任一有已审月就拒 ═══════════════════════

    /**
     * 破坏验证:注释掉 CompanyService.delete 里那句 assertNoLockedMonth 的 for → 本条变 0。
     *
     * 用 force=true 是要点:!force 那道 409 只是「确认请再删一次」,主管点第二次照删,
     * 所以审核闸必须站在 force 前面 —— 拿掉这个参数,这条用例证不出闸比确认强。
     */
    @Test
    void company_deleteRefusedWhenItsLedgerMonthIsApproved() throws Exception {
        int id = newCompany();
        seedLedgerRow(id, newTenant());     // 要被保住的那一行,不塞它「数据没变」就无从谈起
        seedApproved("ledger:" + id + ":" + YM, "ledger", String.valueOf(id));

        assertThat(code(delete("/api/companies/" + id + "?force=true"))).isEqualTo(423);
        assertThat(countLedger(id))
            .as("拒了,可那句 ledger.delete 已经跑过了 —— 守卫挂在四句 delete 后面就是这个样子")
            .isEqualTo(1);
        assertThat(countCompany(id)).isEqualTo(1);
    }

    /** LEDGER 只是四把里的一把:三大报表那三把同样得守,不然删公司照样清空已审月的报表金额。 */
    @Test
    void company_deleteRefusedWhenOnlyAReportMonthIsApproved() throws Exception {
        int id = newCompany();
        seedReportRow(id);
        seedApproved("report-tb:" + id + ":" + YM, "report-tb", String.valueOf(id));

        assertThat(code(delete("/api/companies/" + id + "?force=true"))).isEqualTo(423);
        assertThat(countReport(id))
            .as("拒了,可那句 reportAmounts.delete 已经跑过了")
            .isEqualTo(1);
        assertThat(countCompany(id)).isEqualTo(1);
    }

    /**
     * 反证:别家公司审过不该拦住删这一家。
     *
     * scope 恒是 companyId,漏了这一维就是「园区里有任何一家公司审过月度台账 → 谁都删不掉」,
     * 那正是这一轮要防的那种「加一道让系统不能用的守卫」。
     */
    @Test
    void company_anotherCompanysApprovedMonthDoesNotBlock() throws Exception {
        int id = newCompany();
        seedApproved("ledger:1:" + YM, "ledger", "1");   // 1 号是种子公司,不是本用例建的这家

        assertThat(code(delete("/api/companies/" + id + "?force=true"))).isZero();
        assertThat(countCompany(id)).isZero();
    }

    // ══ 删公司(第五把):催缴单的**收款主体** ═══════════════════════════════════

    /**
     * 一个**只当收款主体**的公司:名下无台账无报表,四把 COMPANY scope 的键一把都不响,
     * 而它的某个催缴单月已审。
     *
     * 破坏验证:注释掉 CompanyService.delete 里那句 assertEditable(BILL_NOTICES, ...) → 本条
     * 从 423 变 0,而且 bill_notice 行还在、金额没变 —— 变的只是 pay_company_id 悬空
     * (V89 没给它 FK),已审月的单子从此印不出落款主体。**不写数字,但让数字印不出来**,
     * 所以第三条断言盯的是 pay_company_id 还指得回去,不是盯行数。
     */
    @Test
    void company_deleteRefusedWhenItIsPaySubjectOfAnApprovedNoticeMonth() throws Exception {
        int id = newCompany();
        seedNotice(id, newTenant(), YM);
        seedApproved("bill-notices:" + YM, "bill-notices", null);

        assertThat(code(delete("/api/companies/" + id + "?force=true"))).isEqualTo(423);
        assertThat(countCompany(id)).isEqualTo(1);
        assertThat(countNoticeOf(id))
            .as("拒了,可 pay_company_id 已经悬空 —— 守卫挂在 deleteById 后面就是这个样子")
            .isEqualTo(1);
    }

    /**
     * 反证:同一家公司、同样有单,只是那个月**没审** —— 该删得掉。
     *
     * 这条和上面那条同等重要:BILL_NOTICES 是 ScopeShape.NONE 的园区级键,守卫要是图省事写成
     * assertNoLockedMonth(BILL_NOTICES, null),上面那条照绿,而这条会跟着 423 ——
     * 后果是「任一月催缴单审过 → 谁都删不掉公司」。少了这半边,一刀切看不出来。
     */
    @Test
    void company_paySubjectOfAnUnapprovedNoticeMonth_stillDeletes() throws Exception {
        int id = newCompany();
        seedNotice(id, newTenant(), YM);
        seedApproved("bill-notices:2031-07", "bill-notices", null);   // 审的是**别的**月

        assertThat(code(delete("/api/companies/" + id + "?force=true"))).isZero();
        assertThat(countCompany(id)).isZero();
    }

    /** 催缴单行数要进 !force 的 409 文案 —— 原先删一个纯收款主体连提示都不弹。 */
    @Test
    void company_noticeCountShowsUpInTheConfirmConflict() throws Exception {
        int id = newCompany();
        seedNotice(id, newTenant(), YM);

        MvcResult r = delete("/api/companies/" + id);   // 不带 force:要的就是那道确认
        assertThat(code(r)).isEqualTo(409);
        assertThat(body(r)).contains("催缴单");
    }

    // ══ 删租户:按 (期区, 账期) 精确守 ═════════════════════════════════════════

    /**
     * 破坏验证:注释掉 TenantService.delete 里那句 assertEditable → 本条变 0,
     * 且 s10_record 那一行的 tenant_id 被抹成 NULL(第二条断言同时红)。
     */
    @Test
    void tenant_deleteRefusedWhenItsS10MonthIsApproved() throws Exception {
        int id = newTenant();
        seedS10(id, 1, YM);
        seedApproved("s10:1:" + YM, "s10", "1");

        assertThat(code(delete("/api/tenants/" + id))).isEqualTo(423);
        assertThat(s10TenantIds(id))
            .as("拒了却还是把已审月那行的 tenant_id 抹成了 NULL —— 守卫挂在两句 update 后面了")
            .isEqualTo(1);
        assertThat(countTenant(id)).isEqualTo(1);
    }

    /**
     * 反证一:该租户的行在一期,审掉的是二期 —— 该放行。
     *
     * S10 的 scope 是**期区**不是租户。守卫要是图省事写成 assertNoLockedMonth(S10, null),
     * 或者把 scope 传错,这条会跟着 423 —— 后果是任一期区审过一个月,全园区的租户永远删不掉。
     */
    @Test
    void tenant_anotherPhaseApprovedDoesNotBlock() throws Exception {
        int id = newTenant();
        seedS10(id, 1, YM);
        seedApproved("s10:2:" + YM, "s10", "2");

        assertThat(code(delete("/api/tenants/" + id))).isZero();
    }

    /** 反证二:名下一行附表10 都没有的租户,附表10 审过也照删 —— 「1 月审过还能不能干活」的那一问。 */
    @Test
    void tenant_withoutAnyS10Row_deletesEvenWhenThatMonthIsApproved() throws Exception {
        int id = newTenant();
        seedApproved("s10:1:" + YM, "s10", "1");

        assertThat(code(delete("/api/tenants/" + id))).isZero();
    }

    /**
     * 脏数据不许把「删不掉」变成「看不懂」。
     *
     * acct_month 是 CHAR(7) 无格式约束,导入进来一个 2031-13 是可能的;ReviewKey.of 对它抛的是
     * 400「账期必须是 YYYY-MM」而不是 423。守卫里那道 matches 少了,用户看到的就是删租户报
     * 一句跟租户毫无关系的账期格式错误。
     */
    @Test
    void tenant_malformedAcctMonthIsSkipped_notTurnedInto400() throws Exception {
        int id = newTenant();
        seedS10(id, 1, "2031-13");

        assertThat(code(delete("/api/tenants/" + id)))
            .as("脏行应当跳过而不是让 ReviewKey.of 抛 400")
            .isZero();
    }

    // ══ 删租户(第二条跨月路径):催缴单备注的人工覆盖 ═══════════════════════════

    /**
     * bill_note_override 的 fk_note_override_tenant 是 ON DELETE CASCADE(V92):删租户会**硬删**
     * 它在全部账期的人工备注,一声不吭。这一档可达但窄 —— 名下没有合同/台账/附表10 行、
     * 却有某月备注覆盖的租户;而 V92 建表注释写明这张表独立存在就是为了「催缴单先删后插重生成
     * 也不丢」,这种状态是设计出来的常态。
     *
     * 破坏验证:注释掉 TenantService.delete 里那句 assertEditable(BILL_NOTICES, ...) → 本条变 0,
     * 且第二条断言同时红(那行备注被级联删掉了)。
     */
    @Test
    void tenant_deleteRefusedWhenItsNoteOverrideMonthIsApproved() throws Exception {
        int id = newTenant();
        seedNoteOverride(id, YM);
        seedApproved("bill-notices:" + YM, "bill-notices", null);

        assertThat(code(delete("/api/tenants/" + id))).isEqualTo(423);
        assertThat(countNoteOverride(id))
            .as("拒了却还是把已审月那条人工备注级联删掉了 —— 守卫挂在 deleteById 后面了")
            .isEqualTo(1);
        assertThat(countTenant(id)).isEqualTo(1);
    }

    /**
     * 反证:备注覆盖落在**未审**月 —— 照删,备注跟着租户一起走。
     *
     * 这半边是这一条的全部风险所在:BILL_NOTICES 是园区级键,写成 assertNoLockedMonth 或者
     * 干脆补一道「有备注覆盖就不许删」的 409,上面那条照绿而这条变红,后果是任一月催缴单审过
     * → 全园区的租户再也删不掉。
     */
    @Test
    void tenant_noteOverrideInAnUnapprovedMonth_stillDeletes() throws Exception {
        int id = newTenant();
        seedNoteOverride(id, YM);
        seedApproved("bill-notices:2031-07", "bill-notices", null);   // 审的是**别的**月

        assertThat(code(delete("/api/tenants/" + id))).isZero();
        assertThat(countTenant(id)).isZero();
    }

    // ══ 删楼栋:本栋单元被别栋合同引用 —— 把 500 换成看得懂的 409 ══════════════

    /**
     * ContractService.replaceExtraUnits 往 contract_unit 插附加单元时不校验该单元属于本合同的
     * 楼栋,所以 A 栋的合同可以把 B 栋的单元当附加单元用。删 B 栋:那道只查 contract.building_id
     * 的 409 不响 → unit 随楼栋级联删 → contract_unit.unit_id 是 RESTRICT(V58)→ 用户看到 500。
     *
     * 破坏验证:去掉 BuildingService.delete 里第二道 409 → 本条从 409 变 500。
     */
    @Test
    void building_deleteRefusedWith409WhenItsUnitIsUsedByAnotherBuildingsContract() throws Exception {
        int id = newBuilding();
        jdbc.update("INSERT INTO contract_unit (contract_id, unit_id) VALUES ((SELECT id FROM contract LIMIT 1), ?)",
            onlyUnitOf(id));

        MvcResult r = delete("/api/buildings/" + id);
        assertThat(code(r)).isEqualTo(409);
        assertThat(body(r)).contains("单元被其他楼栋的合同引用");
        assertThat(countBuilding(id)).isEqualTo(1);
    }

    /** 反证:没有任何引用的楼栋照删 —— 补的这道 409 不许把「删楼栋」变成删不掉。 */
    @Test
    void building_withoutAnyUnitReference_stillDeletes() throws Exception {
        int id = newBuilding();

        assertThat(code(delete("/api/buildings/" + id))).isZero();
        assertThat(countBuilding(id)).isZero();
    }

    // ══ 删单元:同一个洞的第二级 ═══════════════════════════════════════════════

    /**
     * 楼栋那一级(上面两条)修好时,**单元这一级没跟着修** —— 典型的「只补了点名的那条路径,
     * 兄弟调用点还烂着」。deleteUnit 只查 contract.unit_id 与 contract_unit,漏了 billing_term_unit;
     * 而 ContractService.saveLines 写计费行时直接拿请求里的 unitIds 插,既不校验该单元属于本合同楼栋、
     * 也不校验它在 contract_unit 里 —— 所以「只被计费行绑定」是可达状态。
     * fk_btu_unit(V91)是 RESTRICT,少这一道用户看到的是 400「违反完整性约束」而不是能照着做的中文。
     *
     * 破坏验证:去掉 BuildingService.deleteUnit 里 termUnits 那一支 → 本条从 409 变 400。
     */
    @Test
    void unit_deleteRefusedWith409WhenItIsBoundByAContractBillingLine() throws Exception {
        int id = newBuilding();
        int unitId = onlyUnitOf(id);
        jdbc.update("INSERT INTO contract_billing_term (contract_id, fee_name, bill_mode, unit_price) "
                  + "VALUES ((SELECT id FROM contract LIMIT 1), '厂房租金', 'per_month', 1)");
        jdbc.update("INSERT INTO billing_term_unit (term_id, unit_id) "
                  + "VALUES ((SELECT MAX(id) FROM contract_billing_term), ?)", unitId);

        MvcResult r = delete("/api/units/" + unitId);
        assertThat(code(r)).isEqualTo(409);
        assertThat(body(r)).contains("计费行绑定");
    }

    /** 反证:没有任何引用的单元照删 —— 补的这道 409 不许把「删单元」变成删不掉。 */
    @Test
    void unit_withoutAnyReference_stillDeletes() throws Exception {
        int unitId = onlyUnitOf(newBuilding());

        assertThat(code(delete("/api/units/" + unitId))).isZero();
    }

    // ── 脚手架 ────────────────────────────────────────────────────────────────

    private void seedApproved(String key, String kind, String scope) {
        jdbc.update("INSERT INTO review_state (review_key, kind, period, scope, status) VALUES (?,?,?,?,'approved')",
            key, kind, key.substring(key.lastIndexOf(':') + 1), scope);
    }

    /** 名字带 nanoTime:公司名/租户名都有查重,与并跑用例撞唯一名会变成 409 而不是本用例要的码。 */
    private int newCompany() throws Exception {
        return JsonPath.read(body(postJson("/api/companies",
            "{\"name\":\"审核闸公司" + System.nanoTime() + "\",\"short\":\"审闸\"}")), "$.data.id");
    }

    private int newTenant() throws Exception {
        return JsonPath.read(body(postJson("/api/tenants",
            "{\"companyName\":\"审核闸租户" + System.nanoTime() + "\",\"businessType\":\"制造\"}")), "$.data.id");
    }

    /** 一栋一层一单元:删楼栋那两条只需要「这栋有一个单元」。generated_at 无默认值,必须给。 */
    private int newBuilding() throws Exception {
        return JsonPath.read(body(postJson("/api/buildings",
            "{\"name\":\"审核闸楼栋" + System.nanoTime() + "\",\"phase\":1,\"floorCount\":1,"
          + "\"totalArea\":100,\"rentableArea\":100,\"perFloor\":1}")), "$.data.id");
    }

    private Integer onlyUnitOf(int buildingId) {
        return jdbc.queryForObject("SELECT id FROM unit WHERE building_id=?", Integer.class, buildingId);
    }

    private Integer countBuilding(int id) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM building WHERE id=?", Integer.class, id);
    }

    private void seedNotice(int payCompanyId, int tenantId, String ym) {
        jdbc.update("INSERT INTO bill_notice (ym, tenant_id, pay_company_id, total_amount, generated_at)"
                  + " VALUES (?,?,?,123.45,NOW())", ym, tenantId, payCompanyId);
    }

    /** 该司仍当着收款主体的单数。盯的是 pay_company_id 没悬空,不是 bill_notice 的行数。 */
    private Integer countNoticeOf(int companyId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM bill_notice WHERE pay_company_id=?", Integer.class, companyId);
    }

    private void seedNoteOverride(int tenantId, String ym) {
        jdbc.update("INSERT INTO bill_note_override (ym, tenant_id, fee_key, note) VALUES (?,?,'elec','人工备注')",
            ym, tenantId);
    }

    private Integer countNoteOverride(int tenantId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM bill_note_override WHERE tenant_id=?",
            Integer.class, tenantId);
    }

    private void seedS10(int tenantId, int phase, String acctMonth) {
        jdbc.update("INSERT INTO s10_record (tenant_id, tenant_name, phase, acct_month, profile, source)"
                  + " VALUES (?,?,?,?,'office','manual')",
            tenantId, "审核闸租户", phase, acctMonth);
    }

    private void seedLedgerRow(int companyId, int tenantId) {
        jdbc.update("INSERT INTO monthly_ledger (company_id, tenant_id, period_year, period_month, factory_rent)"
                  + " VALUES (?,?,2031,8,123.45)", companyId, tenantId);
    }

    private void seedReportRow(int companyId) {
        jdbc.update("INSERT INTO report_amount (company_id, statement, year, month, row_key, field, amount,"
                  + " created_at, updated_at) VALUES (?,'tb',2031,8,'1','cur',123.45,NOW(),NOW())", companyId);
    }

    private Integer countLedger(int companyId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM monthly_ledger WHERE company_id=?", Integer.class, companyId);
    }

    private Integer countReport(int companyId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM report_amount WHERE company_id=?", Integer.class, companyId);
    }

    private Integer countCompany(int id) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM management_company WHERE id=?", Integer.class, id);
    }

    private Integer countTenant(int id) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM tenant WHERE id=?", Integer.class, id);
    }

    private Integer s10TenantIds(int id) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM s10_record WHERE tenant_id=?", Integer.class, id);
    }

    private MvcResult postJson(String url, String json) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.post(url).header("Authorization", "Bearer " + admin())
            .contentType("application/json").content(json)).andReturn();
    }

    private MvcResult delete(String url) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.delete(url)
            .header("Authorization", "Bearer " + admin())).andReturn();
    }

    private String body(MvcResult r) throws Exception {
        return new String(r.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private int code(MvcResult r) throws Exception {
        return JsonPath.read(body(r), "$.code");
    }

    private String token;   // 每个用例一个实例(JUnit 默认),登一次够用 —— 别每个请求登一次去撞登录限流

    private String admin() throws Exception {
        if (token != null) return token;
        token = JsonPath.read(body(mvc.perform(MockMvcRequestBuilders.post("/api/auth/login")
            .contentType("application/json")
            .content("{\"username\":\"admin\",\"password\":\"admin123\"}")).andReturn()), "$.data.token");
        return token;
    }
}
