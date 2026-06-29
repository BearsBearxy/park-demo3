package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.ChargingCat;
import java.util.List;
public interface ChargingCatMapper extends BaseMapper<ChargingCat> {
    // 某附表(7/8)的类别,按 sort_no 升序
    default List<ChargingCat> selectBySchedule(int scheduleNo) {
        return selectList(new QueryWrapper<ChargingCat>()
            .eq("schedule_no", scheduleNo).orderByAsc("sort_no").orderByAsc("cat_id"));
    }
}
