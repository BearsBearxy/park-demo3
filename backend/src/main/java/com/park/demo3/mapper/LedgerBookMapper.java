package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.LedgerBook;
import java.util.List;
public interface LedgerBookMapper extends BaseMapper<LedgerBook> {
    default List<LedgerBook> byScreen(String screen) {
        return selectList(new QueryWrapper<LedgerBook>().eq("screen", screen).orderByAsc("id"));
    }
    default LedgerBook byCompany(Integer companyId) {
        return selectOne(new QueryWrapper<LedgerBook>().eq("screen", "ledger").eq("company_id", companyId));
    }
    default LedgerBook byPhase(Integer phase) {
        return selectOne(new QueryWrapper<LedgerBook>().eq("screen", "s10").eq("phase", phase));
    }
}
