package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.CompanyAccountDTO;
import com.park.demo3.dto.CompanyAccountReq;
import com.park.demo3.dto.CompanyDTO;
import com.park.demo3.dto.CompanyReq;
import com.park.demo3.entity.BillNotice;
import com.park.demo3.entity.CompanyAccount;
import com.park.demo3.entity.ManagementCompany;
import com.park.demo3.entity.MonthlyLedger;
import com.park.demo3.entity.ReportAccount;
import com.park.demo3.entity.ReportAmount;
import com.park.demo3.entity.ReportCustomRow;
import com.park.demo3.mapper.BillNoticeMapper;
import com.park.demo3.mapper.CompanyAccountMapper;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.MonthlyLedgerMapper;
import com.park.demo3.mapper.ReportAccountMapper;
import com.park.demo3.mapper.ReportAmountMapper;
import com.park.demo3.mapper.ReportCustomRowMapper;
import com.park.demo3.security.NoReviewGuard;
import com.park.demo3.security.ReviewGuard;
import com.park.demo3.security.ReviewKind;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class CompanyService {
    // 收款账户类型值域(S20 §1.2);白名单在服务层挡,别的值一律 400
    private static final Set<String> KINDS = Set.of("bank", "wechat", "alipay", "personal", "other");

    private final ManagementCompanyMapper companies;
    private final CompanyAccountMapper accounts;
    private final MonthlyLedgerMapper ledger;
    private final ReportAmountMapper reportAmounts;
    private final ReportCustomRowMapper reportCustomRows;
    private final ReportAccountMapper reportAccounts;
    private final BillNoticeMapper notices;   // 删公司只读它:该司当过收款主体的账期(见 delete)

    private final BookService bookService;
    private final ReviewGuard reviewGuard;

    public CompanyService(ManagementCompanyMapper companies, CompanyAccountMapper accounts,
                          MonthlyLedgerMapper ledger,
                          ReportAmountMapper reportAmounts, ReportCustomRowMapper reportCustomRows,
                          ReportAccountMapper reportAccounts, BillNoticeMapper notices,
                          BookService bookService, ReviewGuard reviewGuard) {
        this.companies = companies; this.accounts = accounts; this.ledger = ledger;
        this.reportAmounts = reportAmounts; this.reportCustomRows = reportCustomRows;
        this.reportAccounts = reportAccounts; this.notices = notices;
        this.bookService = bookService;
        this.reviewGuard = reviewGuard;
    }

    /** 删公司会跨全部年份清掉这四把键的数据,scope 恒是 companyId。 */
    private static final List<ReviewKind> COMPANY_SCOPED =
        List.of(ReviewKind.LEDGER, ReviewKind.REPORT_IS, ReviewKind.REPORT_BS, ReviewKind.REPORT_TB);

    public List<CompanyDTO> list() {
        Map<Integer, List<CompanyAccountDTO>> byCompany = accounts.selectList(
                new QueryWrapper<CompanyAccount>().orderByAsc("sort_no", "id"))
            .stream().map(CompanyService::toDTO)
            .collect(Collectors.groupingBy(CompanyAccountDTO::companyId,
                LinkedHashMap::new, Collectors.toList()));
        return companies.selectList(new QueryWrapper<ManagementCompany>()
                .orderByAsc("sort_no").orderByAsc("id"))
            .stream().map(c -> toDTO(c, byCompany.getOrDefault(c.getId(), List.of()))).toList();
    }

    @NoReviewGuard(reason = "insert management_company 加建册,两张表都无 ym 列;建册那一步把新司指针直接指到全局链尾(不另起私链、不新增也不改 book_month_pin),已审月台账用的是哪一版模板不受影响")
    public CompanyDTO create(CompanyReq req) {
        requireUniqueName(req.name(), null);
        ManagementCompany c = new ManagementCompany();
        c.setName(req.name());
        c.setShortName(shortOf(req.shortName(), req.name()));
        c.setFullName(blankToNull(req.fullName()));
        c.setStatus(req.status() == null ? 1 : req.status());
        c.setSortNo(0);
        companies.insert(c);
        // §9:新增账册=建司附带动作(自动建册 v1=标准 21 列模板)
        bookService.createLedgerBook(companies.selectById(c.getId()), "系统");
        return toDTO(companies.selectById(c.getId()), List.of());
    }

    // 停用不删:status=0 即从收款公司选择器消失,历史单仍指得回来(delete 才是级联清库)
    @NoReviewGuard(reason = "只改名字与启停用标志,management_company 无 ym 列无金额列;renameLedgerBook 只 setName、不碰 book_template_version 与 book_month_pin,而 bill_notice.pay_company_id 是外键快照,改 status 动不了它")
    public CompanyDTO update(Integer id, CompanyReq req) {
        ManagementCompany c = companies.selectById(id);
        if (c == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");
        requireUniqueName(req.name(), id);
        c.setName(req.name());
        c.setShortName(shortOf(req.shortName(), req.name()));
        if (req.fullName() != null) c.setFullName(blankToNull(req.fullName()));
        if (req.status() != null) c.setStatus(req.status());
        companies.updateById(c);
        bookService.renameLedgerBook(id, c.getName());   // 账册即公司(§9):名字同步,不分叉
        return toDTO(companies.selectById(id), accountsOf(id));
    }

    // 级联删除:公司连同其全部台账与报表数据一并删除(前端删除确认弹窗已明示不可恢复);
    // 不级联则 report_* 的 FK 会让 deleteById 直接 500(company_account 走 DB 级 ON DELETE CASCADE)
    // ⚠ @Transactional 在 2 参重载上,不在这里:controller 走的是 2 参那个,而这一句是自调用、
    //   绕过 Spring 代理,注解挂在这里等于六步删除各跑各的事务(拒在中途就留半清空的库)。
    public void delete(Integer id) { delete(id, false); }

    /**
     * RBAC-SPEC §5.6 守卫:删公司会连带清掉该公司**所有年份**的月度台账与三大报表数据,
     * 且没有软删可恢复。档案岗删一个"重复建的公司",entry 与 report 两个模块的人既拦不住也收不到通知。
     *
     * 所以不是禁止,是**要求显式确认**:名下有数据时先 409 把行数报出来,
     * 调用方看清楚了再带 force=true 重来。能力保留,但毁数据这件事必须是睁着眼做的。
     *
     * 修法是加守卫而不是发明更高的权限档 —— 这是缺守卫不是缺权限:
     * 就算只有主管能删,主管也不该在不知情的情况下毁掉几年的台账。
     */
    @Transactional
    public void delete(Integer id, boolean force) {
        ManagementCompany c = companies.selectById(id);
        if (c == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");
        // 全站唯一一条**无条件跨全部年份删已审月数据**的写:下面四句 delete 的 WHERE 里只有
        // company_id,没有年月。已审月的 monthly_ledger 与三大报表金额会被一次删光,而下面那道
        // !force 的 409 只是「确认请再删一次」,主管点第二次照删。审核态在 service 层才拦得住
        // (提权在 WriteAccessManager 里就放行了),所以闸在这里。
        //
        // 这四把键的 scope 恒是 companyId,守卫精确到公司,不会误伤别家 —— 新司/空司/没审过的司
        // 照删。用 assertNoLockedMonth 而不是那个跨多月的重载不是偷懒:这一次写的「被影响月集合」
        // 就是该司全部月,「该 kind+scope 下存在任一被锁月就拒」与它精确等价,没有多拒一个月。
        for (ReviewKind k : COMPANY_SCOPED) reviewGuard.assertNoLockedMonth(k, String.valueOf(id));
        // 第五把:催缴单的**收款主体**。上面四把只数 monthly_ledger 与 report_amount,看不见催缴单 ——
        // 而 bill_notice.pay_company_id 无 FK(V89 只有 fk_notice_tenant),DB 一声不吭就让它悬空:
        // 行还在、total_amount 一分不动,但 BillNoticeService.toDTO 的 payCompanyName 变 null,
        // 已审月的单子从此没有落款主体、账户块(company_account 是 ON DELETE CASCADE,V94)一起消失。
        // **不改数字,但让数字印不出来** —— 与上面四把同一档,所以一起守。
        //
        // ⚠ 不用 assertNoLockedMonth(BILL_NOTICES, null):BILL_NOTICES 是 ScopeShape.NONE 的园区级键,
        //   那等于「任一月催缴单审过 → 谁都删不掉公司」,正是这一轮要防的那种让系统不能用的守卫。
        //   按**被影响月**精确守:只有该司真当过收款主体的那几个月算数,没出过单的公司照删。
        // ⚠ 脏 ym 先跳过:ym 是 CHAR(7) 无格式约束,ReviewKey.of 对 2031-13 抛的是 400
        //   「账期必须是 YYYY-MM」而不是 423,用户会看到删不掉且看不懂(同 TenantService.delete)。
        reviewGuard.assertEditable(ReviewKind.BILL_NOTICES,
            notices.selectObjs(new QueryWrapper<BillNotice>().select("distinct ym").eq("pay_company_id", id))
                .stream().filter(java.util.Objects::nonNull).map(String::valueOf)
                .filter(ym -> ym.matches("\\d{4}-(0[1-9]|1[0-2])")).toList(),
            null);
        if (!force) {
            long ledgerRows = ledger.selectCount(new QueryWrapper<MonthlyLedger>().eq("company_id", id));
            long reportRows = reportAmounts.selectCount(new QueryWrapper<ReportAmount>().eq("company_id", id));
            // 催缴单也进这道确认:只当收款主体、名下无台账无报表的公司,原先删起来连提示都不弹
            long noticeRows = notices.selectCount(new QueryWrapper<BillNotice>().eq("pay_company_id", id));
            if (ledgerRows > 0 || reportRows > 0 || noticeRows > 0) {
                throw new BizException(ResultCode.CONFLICT, String.format(
                    "「%s」名下还有 %d 行月度台账、%d 行报表金额(删除即清空,不可恢复),"
                  + "另有 %d 张催缴单以它为收款主体(单子留着,但落款主体会空掉)。确认请再删一次。",
                    c.getName(), ledgerRows, reportRows, noticeRows));
            }
        }
        bookService.dropLedgerBook(id);   // 册随司退场;模板版本在全局链上,不跟着走
        ledger.delete(new QueryWrapper<MonthlyLedger>().eq("company_id", id));
        reportAmounts.delete(new QueryWrapper<ReportAmount>().eq("company_id", id));
        reportCustomRows.delete(new QueryWrapper<ReportCustomRow>().eq("company_id", id));
        reportAccounts.delete(new QueryWrapper<ReportAccount>().eq("company_id", id));
        companies.deleteById(id);
    }

    // ══════════ 收款账户(S20 §1.2) ══════════

    @NoReviewGuard(reason = "company_account(V94)无 ym 列也无金额列;催缴单只快照 pay_company_id,账户块是导出时按公司现取默认账户渲染的,不进 bill_notice_line 的任何金额列")
    @Transactional
    public CompanyAccountDTO addAccount(Integer companyId, CompanyAccountReq req) {
        if (companies.selectById(companyId) == null)
            throw new BizException(ResultCode.NOT_FOUND, "公司不存在");
        requireKind(req.kind());
        CompanyAccount a = new CompanyAccount();
        a.setCompanyId(companyId);
        a.setIsDefault(0);
        a.setSortNo(0);
        apply(a, req);
        accounts.insert(a);
        clearOtherDefaults(a);
        return toDTO(accounts.selectById(a.getId()));
    }

    // PUT 全量提交,但 null 字段保持不变(MyBatis-Plus updateById 跳过 null);清空传空串
    @NoReviewGuard(reason = "同 addAccount:company_account 无 ym 列无金额列。最坏后果是已审月的单子重新导出时账号栏印的是新账号 —— 那正是「当前收款信息本该更新」的语义,已审月的 total_amount 与逐行 amount 一分不动")
    @Transactional
    public CompanyAccountDTO updateAccount(Integer id, CompanyAccountReq req) {
        CompanyAccount a = accounts.selectById(id);
        if (a == null) throw new BizException(ResultCode.NOT_FOUND, "收款账户不存在");
        requireKind(req.kind());
        apply(a, req);
        accounts.updateById(a);
        clearOtherDefaults(a);
        return toDTO(accounts.selectById(id));
    }

    @NoReviewGuard(reason = "company_account 无 ym 列无金额列,且没有任何表以 FK 指向它(V94 里只有反向的 company_account→management_company),deleteById 级联不到任何带 ym 的行")
    public void deleteAccount(Integer id) { accounts.deleteById(id); }

    private static void apply(CompanyAccount a, CompanyAccountReq req) {
        a.setKind(req.kind());
        if (req.accountName() != null) a.setAccountName(blankToNull(req.accountName()));
        if (req.accountNo() != null)   a.setAccountNo(blankToNull(req.accountNo()));
        if (req.bankName() != null)    a.setBankName(blankToNull(req.bankName()));
        if (req.isDefault() != null)   a.setIsDefault(req.isDefault() ? 1 : 0);
        if (req.sortNo() != null)      a.setSortNo(req.sortNo());
        if (req.remark() != null)      a.setRemark(blankToNull(req.remark()));
    }

    // 默认账户同公司唯一:设新默认时清旧(DB 没法用部分唯一索引表达,闸在这一处)
    private void clearOtherDefaults(CompanyAccount a) {
        if (a.getIsDefault() == null || a.getIsDefault() != 1) return;
        accounts.update(null, new UpdateWrapper<CompanyAccount>()
            .eq("company_id", a.getCompanyId()).ne("id", a.getId()).set("is_default", 0));
    }

    private void requireKind(String kind) {
        if (!KINDS.contains(kind))
            throw new BizException(ResultCode.BAD_REQUEST, "账户类型须为 bank/wechat/alipay/personal/other");
    }

    private List<CompanyAccountDTO> accountsOf(Integer companyId) {
        return accounts.selectList(new QueryWrapper<CompanyAccount>()
            .eq("company_id", companyId).orderByAsc("sort_no", "id"))
            .stream().map(CompanyService::toDTO).toList();
    }

    private void requireUniqueName(String name, Integer excludeId) {
        QueryWrapper<ManagementCompany> q = new QueryWrapper<ManagementCompany>().eq("name", name);
        if (excludeId != null) q.ne("id", excludeId);
        if (companies.selectCount(q) > 0) throw new BizException(ResultCode.CONFLICT, "公司名称已存在");
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String shortOf(String provided, String name) {
        return provided == null || provided.isBlank() ? deriveShort(name) : provided.trim();
    }

    // short 派生:去「园区」前缀、去「有限/管理/运营/物业/公司/产业」词、取前 2 字
    static String deriveShort(String name) {
        String s = name == null ? "" : name.trim();
        if (s.startsWith("园区")) s = s.substring(2);
        for (String w : new String[]{"有限", "管理", "运营", "物业", "公司", "产业"}) {
            s = s.replace(w, "");
        }
        return s.length() > 2 ? s.substring(0, 2) : s;
    }

    private static CompanyDTO toDTO(ManagementCompany c, List<CompanyAccountDTO> accts) {
        return new CompanyDTO(c.getId(), c.getName(), c.getShortName(), c.getSortNo(),
            c.getFullName(), c.getStatus(), accts);
    }

    private static CompanyAccountDTO toDTO(CompanyAccount a) {
        return new CompanyAccountDTO(a.getId(), a.getCompanyId(), a.getKind(), a.getAccountName(),
            a.getAccountNo(), a.getBankName(),
            a.getIsDefault() != null && a.getIsDefault() == 1, a.getSortNo(), a.getRemark());
    }
}
