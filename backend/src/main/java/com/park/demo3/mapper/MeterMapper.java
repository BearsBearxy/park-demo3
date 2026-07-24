package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.Meter;
import java.util.List;
public interface MeterMapper extends BaseMapper<Meter> {
    // 档案列表(可选 kind/zone 过滤),sort_no→id 稳定序
    default List<Meter> selectFiltered(String kind, String zone) {
        return selectList(new QueryWrapper<Meter>()
            .eq(kind != null, "kind", kind).eq(zone != null, "zone", zone)
            .orderByAsc("sort_no", "id"));
    }
    // uk(kind,zone,name) 单行;无则 null(导入 upsert/重名守卫用)
    default Meter selectByKey(String kind, String zone, String name) {
        return selectOne(new QueryWrapper<Meter>()
            .eq("kind", kind).eq("zone", zone).eq("name", name));
    }
    default int maxSortNo() {
        Meter m = selectOne(new QueryWrapper<Meter>().orderByDesc("sort_no").last("limit 1"));
        return m == null || m.getSortNo() == null ? 0 : m.getSortNo();
    }
}
