package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.MeterReading;
import java.util.List;
public interface MeterReadingMapper extends BaseMapper<MeterReading> {
    default List<MeterReading> selectByYm(String ym) {
        return selectList(new QueryWrapper<MeterReading>().eq("ym", ym).orderByAsc("meter_id"));
    }
    // 某表逐月历史(抽屉用),ym 升序
    default List<MeterReading> selectByMeter(Integer meterId) {
        return selectList(new QueryWrapper<MeterReading>().eq("meter_id", meterId).orderByAsc("ym"));
    }
    default MeterReading selectByMeterAndYm(Integer meterId, String ym) {
        return selectOne(new QueryWrapper<MeterReading>().eq("meter_id", meterId).eq("ym", ym));
    }
    // 该表读数条数(删表 409 守卫 + 档案列表条数列)
    default long countByMeter(Integer meterId) {
        return selectCount(new QueryWrapper<MeterReading>().eq("meter_id", meterId));
    }
    // 有读数的 distinct 年份升序(年下拉数据驱动)
    default List<Integer> selectDistinctYears() {
        return selectObjs(new QueryWrapper<MeterReading>().select("distinct left(ym,4)"))
            .stream().map(o -> Integer.parseInt(String.valueOf(o))).sorted().toList();
    }
}
