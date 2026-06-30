package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.PvRecord;
import java.util.List;
public interface PvRecordMapper extends BaseMapper<PvRecord> {
    // 该年(acct_month 前4位==year)全部记录,按 acct_month 升序
    default List<PvRecord> selectByYear(int year) {
        return selectList(new QueryWrapper<PvRecord>()
            .likeRight("acct_month", year + "-").orderByAsc("acct_month"));
    }
    // 删某期指定记账月集合的行(任意来源)——导入按「(期,月)一行」upsert:先清该期该月(种子/手动/导入)再插。
    // 不波及未导入的(期,月)。返回删除行数。
    default int deleteByPhaseAndMonths(String phaseId, List<String> acctMonths) {
        if (acctMonths == null || acctMonths.isEmpty()) return 0;
        return delete(new QueryWrapper<PvRecord>()
            .eq("phase_id", phaseId)
            .in("acct_month", acctMonths));
    }
    // 删某年(acct_month 前缀 year-)的 source='import' 行(清空本期导入);返回删除行数
    default int deleteImported(int year) {
        return delete(new QueryWrapper<PvRecord>()
            .likeRight("acct_month", year + "-")
            .eq("source", "import"));
    }
}
