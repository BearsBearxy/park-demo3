package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.BookMonthPin;

public interface BookMonthPinMapper extends BaseMapper<BookMonthPin> {
    default BookMonthPin at(String screen, Integer ownerId, int year, int month) {
        return selectOne(new QueryWrapper<BookMonthPin>().eq("screen", screen)
            .eq("owner_id", ownerId).eq("period_year", year).eq("period_month", month));
    }
    /** 严格早于 (year,month) 的最近一条(解析规则第 2 步:沿用上月,跨空月继续往前找)。 */
    default BookMonthPin latestBefore(String screen, Integer ownerId, int year, int month) {
        return selectOne(new QueryWrapper<BookMonthPin>().eq("screen", screen).eq("owner_id", ownerId)
            .apply("(period_year * 12 + period_month) < {0}", year * 12 + month)
            .orderByDesc("period_year").orderByDesc("period_month").last("LIMIT 1"));
    }
    default boolean existsAny() { return selectCount(new QueryWrapper<>()) > 0; }
}
