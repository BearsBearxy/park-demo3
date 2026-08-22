package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.CompanyAccountDTO;
import com.park.demo3.dto.CompanyAccountReq;
import com.park.demo3.dto.CompanyDTO;
import com.park.demo3.dto.CompanyReq;
import com.park.demo3.entity.CompanyAccount;
import com.park.demo3.entity.ManagementCompany;
import com.park.demo3.entity.MonthlyLedger;
import com.park.demo3.entity.ReportAccount;
import com.park.demo3.entity.ReportAmount;
import com.park.demo3.entity.ReportCustomRow;
import com.park.demo3.mapper.CompanyAccountMapper;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.MonthlyLedgerMapper;
import com.park.demo3.mapper.ReportAccountMapper;
import com.park.demo3.mapper.ReportAmountMapper;
import com.park.demo3.mapper.ReportCustomRowMapper;
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

    public CompanyService(ManagementCompanyMapper companies, CompanyAccountMapper accounts,
                          MonthlyLedgerMapper ledger,
                          ReportAmountMapper reportAmounts, ReportCustomRowMapper reportCustomRows,
                          ReportAccountMapper reportAccounts) {
        this.companies = companies; this.accounts = accounts; this.ledger = ledger;
        this.reportAmounts = reportAmounts; this.reportCustomRows = reportCustomRows;
        this.reportAccounts = reportAccounts;
    }

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

    public CompanyDTO create(CompanyReq req) {
        requireUniqueName(req.name(), null);
        ManagementCompany c = new ManagementCompany();
        c.setName(req.name());
        c.setShortName(shortOf(req.shortName(), req.name()));
        c.setFullName(blankToNull(req.fullName()));
        c.setStatus(req.status() == null ? 1 : req.status());
        c.setSortNo(0);
        companies.insert(c);
        return toDTO(companies.selectById(c.getId()), List.of());
    }

    // 停用不删:status=0 即从收款公司选择器消失,历史单仍指得回来(delete 才是级联清库)
    public CompanyDTO update(Integer id, CompanyReq req) {
        ManagementCompany c = companies.selectById(id);
        if (c == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");
        requireUniqueName(req.name(), id);
        c.setName(req.name());
        c.setShortName(shortOf(req.shortName(), req.name()));
        if (req.fullName() != null) c.setFullName(blankToNull(req.fullName()));
        if (req.status() != null) c.setStatus(req.status());
        companies.updateById(c);
        return toDTO(companies.selectById(id), accountsOf(id));
    }

    // 级联删除:公司连同其全部台账与报表数据一并删除(前端删除确认弹窗已明示不可恢复);
    // 不级联则 report_* 的 FK 会让 deleteById 直接 500(company_account 走 DB 级 ON DELETE CASCADE)
    @Transactional
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
    public void delete(Integer id, boolean force) {
        ManagementCompany c = companies.selectById(id);
        if (c == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");
        if (!force) {
            long ledgerRows = ledger.selectCount(new QueryWrapper<MonthlyLedger>().eq("company_id", id));
            long reportRows = reportAmounts.selectCount(new QueryWrapper<ReportAmount>().eq("company_id", id));
            if (ledgerRows > 0 || reportRows > 0) {
                throw new BizException(ResultCode.CONFLICT, String.format(
                    "「%s」名下还有 %d 行月度台账、%d 行报表金额,删除会连同清空且不可恢复。确认请再删一次。",
                    c.getName(), ledgerRows, reportRows));
            }
        }
        ledger.delete(new QueryWrapper<MonthlyLedger>().eq("company_id", id));
        reportAmounts.delete(new QueryWrapper<ReportAmount>().eq("company_id", id));
        reportCustomRows.delete(new QueryWrapper<ReportCustomRow>().eq("company_id", id));
        reportAccounts.delete(new QueryWrapper<ReportAccount>().eq("company_id", id));
        companies.deleteById(id);
    }

    // ══════════ 收款账户(S20 §1.2) ══════════

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
