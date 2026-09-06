package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.ReviewState;
import java.util.List;

public interface ReviewStateMapper extends BaseMapper<ReviewState> {

    /** 某月全部审核键的落库行。没有行 = 该键处于派生态「录入中」。 */
    default List<ReviewState> byPeriod(String period) {
        return selectList(new QueryWrapper<ReviewState>().eq("period", period));
    }

    /**
     * 某个 kind(+scope) 的全部月份,按期升序。
     * 跨月写(rechain、参数默认行)要靠它反查「有没有已审月」—— 见计划裁定 R-2 / R-4。
     */
    default List<ReviewState> byKindAndScope(String kind, String scope) {
        QueryWrapper<ReviewState> q = new QueryWrapper<ReviewState>().eq("kind", kind);
        if (scope == null) q.isNull("scope"); else q.eq("scope", scope);
        return selectList(q.orderByAsc("period"));
    }
}
