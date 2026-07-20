package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.CpPowerUsage;
import java.time.LocalDate;
import java.util.List;
public interface CpPowerUsageMapper extends BaseMapper<CpPowerUsage> {
    // 某月全部电表行
    default List<CpPowerUsage> selectByPeriod(LocalDate period) {
        return selectList(new QueryWrapper<CpPowerUsage>().eq("period", period).orderByAsc("id"));
    }
    // 某年全部电表行(年视角/metrics-year 整年一次取数用,ENERGY-ANALYSIS §4)
    default List<CpPowerUsage> selectByYear(int year) {
        return selectList(new QueryWrapper<CpPowerUsage>()
            .ge("period", LocalDate.of(year, 1, 1)).lt("period", LocalDate.of(year + 1, 1, 1))
            .orderByAsc("period", "id"));
    }
    // uk(operator, vehicle_type, period) 单行(无则 null,upsert 用)
    default CpPowerUsage selectByKey(String operator, String vehicleType, LocalDate period) {
        return selectOne(new QueryWrapper<CpPowerUsage>()
            .eq("operator", operator).eq("vehicle_type", vehicleType).eq("period", period));
    }
}
