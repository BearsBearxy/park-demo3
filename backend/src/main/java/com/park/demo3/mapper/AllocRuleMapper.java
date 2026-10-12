/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocRule;
import java.util.List;
public interface AllocRuleMapper extends BaseMapper<AllocRule> {
    default List<AllocRule> selectByZone(String zone) {
        QueryWrapper<AllocRule> qw = new QueryWrapper<AllocRule>().orderByAsc("sort_no", "id");
        if (zone != null) qw.eq("zone", zone);
        return selectList(qw);
    }
    default int maxSortNo() {
        Object v = selectObjs(new QueryWrapper<AllocRule>().select("max(sort_no)")).stream()
            .filter(java.util.Objects::nonNull).findFirst().orElse(0);
        return ((Number) v).intValue();
    }
}
