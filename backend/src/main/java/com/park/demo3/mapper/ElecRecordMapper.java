package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.ElecRecord;
import java.util.List;
public interface ElecRecordMapper extends BaseMapper<ElecRecord> {
    // 该年(acct_month 前4位==year)指定 type 全部记录,按 acct_month 升序,
    // 月内按 id(=种子插入顺序:phase p1→p3、period 峰→平→谷)确定排序
    default List<ElecRecord> selectByYearAndType(int year, String type) {
        return selectList(new QueryWrapper<ElecRecord>()
            .likeRight("acct_month", year + "-").eq("type", type)
            .orderByAsc("acct_month").orderByAsc("id"));
    }
    // 删某期指定记账月集合的行(任意来源、energy+basic 都删)——导入按(期,月)整月整期 upsert:
    // 先清该期该月(种子/手动/导入)再插。不波及未导入的(期,月)。返回删除行数。
    default int deleteByPhaseAndMonths(String phaseId, java.util.List<String> acctMonths) {
        if (acctMonths == null || acctMonths.isEmpty()) return 0;
        return delete(new QueryWrapper<ElecRecord>()
            .eq("phase_id", phaseId)
            .in("acct_month", acctMonths));
    }
    // 删某年(acct_month 前缀 year-)的 source='import' 行(清空本期导入);返回删除行数
    default int deleteImported(int year) {
        return delete(new QueryWrapper<ElecRecord>()
            .likeRight("acct_month", year + "-")
            .eq("source", "import"));
    }
}
