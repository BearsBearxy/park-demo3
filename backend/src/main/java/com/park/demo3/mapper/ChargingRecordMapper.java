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
    // 某附表某年(acct_month 前4位==year)记录,按 acct_month 升序
    default List<ChargingRecord> selectByScheduleAndYear(int scheduleNo, int year) {
        return selectList(new QueryWrapper<ChargingRecord>()
            .eq("schedule_no", scheduleNo)
            .likeRight("acct_month", year + "-").orderByAsc("acct_month"));
    }
}
