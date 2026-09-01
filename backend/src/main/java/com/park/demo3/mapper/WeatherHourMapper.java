package com.park.demo3.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.WeatherHour;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

@Mapper
public interface WeatherHourMapper extends BaseMapper<WeatherHour> {

    // 日聚合(PV-ANALYSIS-SPEC §03.2)。**不落第二张表**:一个坐标点 24×365=8760 行/年,扫描聚合毫秒级,
    // 没有性能理由;更要紧的是口径写在这条 SQL 里,改了立刻生效不用重导。
    //
    // ghi_kwh:GHI 是 W/m2 的瞬时功率,逐小时 × 1h ÷ 1000 = kWh/m2。忘了除 1000 整屏的「应发多少度」差三个数量级。
    // hours / hour_mask:护栏,不是装饰。如实报数,既不补齐(日累计会虚高)也不整日丢弃
    //       (「今天数据不全」这件事会消失)。
    // ⚠ 光有 hours 不够:真实天气源常常只给白天那几个小时,而且日照长度按季节变 ——
    //   「有几个小时」分不清「当天日照短」和「漏了几行」。hour_mask 是 24 位位图
    //   (第 h 位 = 该整点有记录),前端靠它判**连不连续**:清晨黄昏太阳贴地平线、GHI 近乎 0,
    //   缺了不影响日累计;**中间时段缺一小时**才是真丢能量。判据是位置,不是个数。
    @Select("""
        SELECT DATE(obs_time)      AS d,
               SUM(ghi) / 1000     AS ghi_kwh,
               SUM(precip_mm)      AS rain_mm,
               MAX(temp_c)         AS t_max,
               MIN(temp_c)         AS t_min,
               COUNT(*)            AS hours,
               BIT_OR(1 << HOUR(obs_time)) AS hour_mask,
               MAX(CASE WHEN weather_txt LIKE '%雨%' THEN 1 ELSE 0 END) AS is_rain
        FROM weather_hour
        WHERE obs_time >= #{from} AND obs_time < #{to}
        GROUP BY DATE(obs_time)
        ORDER BY d
        """)
    List<Map<String, Object>> selectDaily(@Param("from") String from, @Param("to") String to);
}
