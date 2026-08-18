package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.BillNotice;
import java.util.List;
public interface BillNoticeMapper extends BaseMapper<BillNotice> {
    default List<BillNotice> selectByYm(String ym) {
        return selectList(new QueryWrapper<BillNotice>().eq("ym", ym)
            .orderByAsc("tenant_id", "notice_kind", "id"));
    }
    // 有单的 distinct 账期升序('YYYY-MM')。本域原先没有自己的年/月列表,借的是 /meters/years
    // (抄表年≠出单年,BillNoticesView 头注已自认)—— 前端「最新有单月」改用这个,不再逐月试探。
    // ym 是零补 CHAR(7) 且是 uk_notice 最左列,Java 排序与 SQL ORDER BY 等价。
    default List<String> selectDistinctYms() {
        return selectObjs(new QueryWrapper<BillNotice>().select("distinct ym"))
            .stream().map(String::valueOf).sorted().toList();
    }
}
