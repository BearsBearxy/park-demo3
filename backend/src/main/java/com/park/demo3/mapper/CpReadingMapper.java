package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.CpReading;
import java.time.LocalDate;
import java.util.List;
public interface CpReadingMapper extends BaseMapper<CpReading> {
    // 某年某月记录(month null=全年,ENERGY-ANALYSIS §4;可选按桩过滤),read_date 升序(同日不同桩按 id)
    default List<CpReading> selectByMonth(int year, Integer month, Integer stationId) {
        LocalDate from = LocalDate.of(year, month == null ? 1 : month, 1);
        return selectList(new QueryWrapper<CpReading>()
            .ge("read_date", from).lt("read_date", month == null ? from.plusYears(1) : from.plusMonths(1))
            .eq(stationId != null, "station_id", stationId)
            .orderByAsc("read_date", "id"));
    }
    // 该桩该日记录(uk 单行;无则 null)
    default CpReading selectByStationAndDate(Integer stationId, LocalDate date) {
        return selectOne(new QueryWrapper<CpReading>()
            .eq("station_id", stationId).eq("read_date", date));
    }
    // 该桩充电记录数(删桩 409 守卫用)
    default long countByStation(Integer stationId) {
        return selectCount(new QueryWrapper<CpReading>().eq("station_id", stationId));
    }
    // 有记录的 distinct 年份升序(年份下拉数据驱动;selectObjs 只取一列,Java 侧排序)
    default List<Integer> selectDistinctYears() {
        return selectObjs(new QueryWrapper<CpReading>().select("distinct year(read_date)"))
            .stream().map(o -> ((Number) o).intValue()).sorted().toList();
    }
    // 有记录的 distinct 账期升序('YYYY-MM')。本表按日记条没有 ym 列,date_format 直接出补零串
    // ——别在 Java 侧拼 year+"-"+month,那样 '2025-2' 会排到 '2025-12' 后面。
    // 表达式吃不到松散扫描(与上面 year() 同一档),33 行亚毫秒,不为此加索引。
    default List<String> selectDistinctYms() {
        return selectObjs(new QueryWrapper<CpReading>().select("distinct date_format(read_date,'%Y-%m')"))
            .stream().map(String::valueOf).sorted().toList();
    }
}
