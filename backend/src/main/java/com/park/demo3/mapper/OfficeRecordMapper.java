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
    // 删某附表某年(acct_month 前缀 year-)的 source='import' 行(重导替换 / 清空本期导入);返回删除行数
    default int deleteImported(int scheduleNo, int year) {
        return delete(new QueryWrapper<OfficeRecord>()
            .eq("schedule_no", scheduleNo)
            .likeRight("acct_month", year + "-")
            .eq("source", "import"));
    }
}
