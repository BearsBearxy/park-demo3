package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.OfficeRecord;
import java.util.List;
public interface OfficeRecordMapper extends BaseMapper<OfficeRecord> {
    // 某附表全部记录(供 overview 年份口径)
    default List<OfficeRecord> selectBySchedule(int scheduleNo) {
        return selectList(new QueryWrapper<OfficeRecord>().eq("schedule_no", scheduleNo));
    }
    // 某附表某年(acct_month 前4位==year)记录,按 acct_month 升序 + id 次级(种子插入序)确定排序
    default List<OfficeRecord> selectByScheduleAndYear(int scheduleNo, int year) {
        return selectList(new QueryWrapper<OfficeRecord>()
            .eq("schedule_no", scheduleNo)
            .likeRight("acct_month", year + "-")
            .orderByAsc("acct_month").orderByAsc("id"));
    }
    // 删某附表某年(acct_month 前缀 year-)的 source='import' 行(清空本期导入);返回删除行数
    default int deleteImported(int scheduleNo, int year) {
        return delete(new QueryWrapper<OfficeRecord>()
            .eq("schedule_no", scheduleNo)
            .likeRight("acct_month", year + "-")
            .eq("source", "import"));
    }
    // 删某附表指定记账月集合的行(任意来源)——导入按「每月一行」upsert:先清该月(种子/手动/导入)再插新行。
    // uk_office(schedule_no,acct_month) 唯一,故导入某月即覆盖该月;不波及未导入的月。返回删除行数。
    default int deleteByScheduleAndMonths(int scheduleNo, List<String> acctMonths) {
        if (acctMonths == null || acctMonths.isEmpty()) return 0;
        return delete(new QueryWrapper<OfficeRecord>()
            .eq("schedule_no", scheduleNo)
            .in("acct_month", acctMonths));
    }
}
