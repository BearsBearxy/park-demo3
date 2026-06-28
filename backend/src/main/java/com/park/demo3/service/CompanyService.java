package com.park.demo3.service;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.CompanyDTO;
import com.park.demo3.entity.ManagementCompany;
import com.park.demo3.mapper.ManagementCompanyMapper;
import com.park.demo3.mapper.MonthlyLedgerMapper;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class CompanyService {
    private final ManagementCompanyMapper companies;
    private final MonthlyLedgerMapper ledger;

    public CompanyService(ManagementCompanyMapper companies, MonthlyLedgerMapper ledger) {
        this.companies = companies; this.ledger = ledger;
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

    public void delete(Integer id) {
        ManagementCompany c = companies.selectById(id);
        if (c == null) throw new BizException(ResultCode.NOT_FOUND, "公司不存在");
        long rows = ledger.selectCount(new QueryWrapper<com.park.demo3.entity.MonthlyLedger>()
            .eq("company_id", id));
        if (rows > 0) throw new BizException(ResultCode.CONFLICT, "该公司已有台账数据,不可删除");
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
