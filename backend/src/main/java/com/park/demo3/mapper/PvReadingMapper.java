package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.PvReading;
import java.time.LocalDate;
import java.util.List;
public interface PvReadingMapper extends BaseMapper<PvReading> {
    // 某年某月记录(month null=全年,ENERGY-ANALYSIS §4;可选按站过滤),read_date 升序(同日不同站按 id)
    default List<PvReading> selectByMonth(int year, Integer month, Integer stationId) {
        LocalDate from = LocalDate.of(year, month == null ? 1 : month, 1);
        return selectList(new QueryWrapper<PvReading>()
            .ge("read_date", from).lt("read_date", month == null ? from.plusYears(1) : from.plusMonths(1))
            .eq(stationId != null, "station_id", stationId)
            .orderByAsc("read_date", "id"));
    }
    // 该站该日记录(uk 单行;无则 null)
    default PvReading selectByStationAndDate(Integer stationId, LocalDate date) {
        return selectOne(new QueryWrapper<PvReading>()
            .eq("station_id", stationId).eq("read_date", date));
    }
    // 该站抄表记录数(删站 409 守卫用)
    default long countByStation(Integer stationId) {
        return selectCount(new QueryWrapper<PvReading>().eq("station_id", stationId));
    }
    // 有记录的 distinct 年份升序(年份下拉数据驱动;selectObjs 只取一列,Java 侧排序)
    default List<Integer> selectDistinctYears() {
        return selectObjs(new QueryWrapper<PvReading>().select("distinct year(read_date)"))
            .stream().map(o -> ((Number) o).intValue()).sorted().toList();
    }
}
