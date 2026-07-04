package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.CompanyDTO;
import com.park.demo3.entity.ManagementCompany;
import com.park.demo3.entity.MonthlyLedger;
import com.park.demo3.entity.ReportAccount;
import com.park.demo3.entity.ReportAmount;
import com.park.demo3.entity.ReportCustomRow;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.MonthlyLedgerMapper;
import com.park.demo3.mapper.ReportAccountMapper;
import com.park.demo3.mapper.ReportAmountMapper;
import com.park.demo3.mapper.ReportCustomRowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service
public class CompanyService {
    private final ManagementCompanyMapper companies;
    private final MonthlyLedgerMapper ledger;
    private final ReportAmountMapper reportAmounts;
    private final ReportCustomRowMapper reportCustomRows;
    private final ReportAccountMapper reportAccounts;

    public CompanyService(ManagementCompanyMapper companies, MonthlyLedgerMapper ledger,
                          ReportAmountMapper reportAmounts, ReportCustomRowMapper reportCustomRows,
                          ReportAccountMapper reportAccounts) {
        this.companies = companies; this.ledger = ledger;
        this.reportAmounts = reportAmounts; this.reportCustomRows = reportCustomRows;
        this.reportAccounts = reportAccounts;
    }

    public List<CompanyDTO> list() {
        return companies.selectList(new QueryWrapper<ManagementCompany>()
                .orderByAsc("sort_no").orderByAsc("id"))
            .stream().map(this::toDTO).toList();
    }

    public CompanyDTO create(String name) {
        requireUniqueName(name, null);
        ManagementCompany c = new ManagementCompany();
        c.setName(name);
        c.setShortName(deriveShort(name));
        c.setSortNo(0);
        companies.insert(c);
        return toDTO(companies.selectById(c.getId()));
    }

    public CompanyDTO rename(Integer id, String name) {
        ManagementCompany c = companies.selectById(id);
        if (c == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");
        requireUniqueName(name, id);
        c.setName(name);
        c.setShortName(deriveShort(name));
        companies.updateById(c);
        return toDTO(companies.selectById(id));
    }

    // 级联删除:公司连同其全部台账与报表数据一并删除(前端删除确认弹窗已明示不可恢复);
    // 不级联则 report_* 的 FK 会让 deleteById 直接 500
    @Transactional
    public void delete(Integer id) {
        ManagementCompany c = companies.selectById(id);
        if (c == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");
        ledger.delete(new QueryWrapper<MonthlyLedger>().eq("company_id", id));
        reportAmounts.delete(new QueryWrapper<ReportAmount>().eq("company_id", id));
        reportCustomRows.delete(new QueryWrapper<ReportCustomRow>().eq("company_id", id));
        reportAccounts.delete(new QueryWrapper<ReportAccount>().eq("company_id", id));
        companies.deleteById(id);
    }

    private void requireUniqueName(String name, Integer excludeId) {
        QueryWrapper<ManagementCompany> q = new QueryWrapper<ManagementCompany>().eq("name", name);
        if (excludeId != null) q.ne("id", excludeId);
        if (companies.selectCount(q) > 0) throw new BizException(ResultCode.CONFLICT, "公司名称已存在");
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

    private CompanyDTO toDTO(ManagementCompany c) {
        return new CompanyDTO(c.getId(), c.getName(), c.getShortName(), c.getSortNo());
    }
}
