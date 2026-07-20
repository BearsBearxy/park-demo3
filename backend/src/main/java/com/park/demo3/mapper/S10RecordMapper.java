package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.S10Record;
import java.util.List;
public interface S10RecordMapper extends BaseMapper<S10Record> {
    // 某 phase + acct_month 的真实行(稀疏读);确定性排序:tenant_id 升序 + id 次级(null 软引用行落尾)
    default List<S10Record> selectBySlot(int phase, String acctMonth) {
        return selectList(new QueryWrapper<S10Record>()
            .eq("phase", phase)
            .eq("acct_month", acctMonth)
            .orderByAsc("tenant_id").orderByAsc("id"));
    }
    // 某 acct_month 跨全部 phase 的行(账单页附表10口径整期取);排序同 selectBySlot
    default List<S10Record> selectByMonth(String acctMonth) {
        return selectList(new QueryWrapper<S10Record>()
            .eq("acct_month", acctMonth)
            .orderByAsc("tenant_id").orderByAsc("id"));
    }
    // 某年跨全部 phase 的行(acct_month 前缀 year-;电费成本 metrics-year 整年一次取数用)
    default List<S10Record> selectByYear(int year) {
        return selectList(new QueryWrapper<S10Record>().likeRight("acct_month", year + "-"));
    }
    // 某 (phase, acct_month, tenant_name) 唯一行(upsert 用)
    default S10Record selectBySlotTenant(int phase, String acctMonth, String tenantName) {
        return selectOne(new QueryWrapper<S10Record>()
            .eq("phase", phase)
            .eq("acct_month", acctMonth)
            .eq("tenant_name", tenantName));
    }
    // 删某 (phase, acct_month) 的 source='import' 行(重导替换 / 清空本期导入用);返回删除行数
    default int deleteImported(int phase, String acctMonth) {
        return delete(new QueryWrapper<S10Record>()
            .eq("phase", phase)
            .eq("acct_month", acctMonth)
            .eq("source", "import"));
    }
}
