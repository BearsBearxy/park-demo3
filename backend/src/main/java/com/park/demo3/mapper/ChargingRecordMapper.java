package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.ChargingRecord;
import java.util.List;
public interface ChargingRecordMapper extends BaseMapper<ChargingRecord> {
    // 某附表全部记录(供 overview 年份口径)
    default List<ChargingRecord> selectBySchedule(int scheduleNo) {
        return selectList(new QueryWrapper<ChargingRecord>().eq("schedule_no", scheduleNo));
    }
    // 某附表某年(acct_month 前4位==year)记录,按 acct_month 升序 + id 次级(插入序)确定排序
    default List<ChargingRecord> selectByScheduleAndYear(int scheduleNo, int year) {
        return selectList(new QueryWrapper<ChargingRecord>()
            .eq("schedule_no", scheduleNo)
            .likeRight("acct_month", year + "-")
            .orderByAsc("acct_month").orderByAsc("id"));
    }
    // 删某附表指定(cat,记账月)集合的行(任意来源)——导入按「(附表,cat,月)一行」upsert:
    // 先清这些(cat,月)的种子/手动/导入行再插新行。不波及未导入的(cat,月)。返回删除行数。
    default int deleteByScheduleCatMonths(int scheduleNo, List<String[]> catMonths) {
        if (catMonths == null || catMonths.isEmpty()) return 0;
        return delete(new QueryWrapper<ChargingRecord>()
            .eq("schedule_no", scheduleNo)
            .and(w -> {
                for (String[] cm : catMonths) w.or(x -> x.eq("cat", cm[0]).eq("acct_month", cm[1]));
            }));
    }
    // 删某附表某年(acct_month 前缀 year-)的 source='import' 行(清空本期导入);返回删除行数
    default int deleteImported(int scheduleNo, int year) {
        return delete(new QueryWrapper<ChargingRecord>()
            .eq("schedule_no", scheduleNo)
            .likeRight("acct_month", year + "-")
            .eq("source", "import"));
    }
}
