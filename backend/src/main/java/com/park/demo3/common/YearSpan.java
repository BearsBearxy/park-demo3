package com.park.demo3.common;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Collection;
import java.util.Collections;

/**
 * 附表类屏「年份概览」的年份范围 [lo..hi] 与当前年,七个 service 共用
 * (附表6 光伏 / 附表11 电费 / 附表7·8 充电 / 附表13·14 办公水电 / 附表10 / 附表12 工资 / 损益附表)。
 *
 * 有数据:[min(2024, 最小数据年) .. 最大数据年+1],当前年 = 最大数据年 —— 和改前逐字一样,不读时钟(确定性)。
 * 一条数据都没有:[去年 .. 明年],当前年 = 今年。改前这里写死 [2024..2025](2024 是我园台账的起点),
 * 新园区空库打开每张附表都落在 2024 年。2026-10-05 用户拍板「按你建议修改」:只在没数据时读时钟取今年。
 * 带上去年:各录入抽屉的月份上下限取这个范围,只给 [今年..明年] 的话新园区年初补录不了上一年 12 月(2026-10-05 复查)。
 */
public record YearSpan(int lo, int hi, int current) {
    /** 我园台账起点。有数据时仍是范围下界:去掉它我园各附表年份条前面的空年会消失。 */
    static final int BASE_YEAR = 2024;
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    public static YearSpan of(Collection<Integer> dataYears) {
        if (dataYears.isEmpty()) {
            int y = thisYear();
            return new YearSpan(y - 1, y + 1, y);
        }
        int max = Collections.max(dataYears);
        return new YearSpan(Math.min(BASE_YEAR, Collections.min(dataYears)), max + 1, max);
    }

    /** 没数据时的落点:今年(北京时间)。只给「库里一条数据都没有」的分支用,有数据的路径不许读它。 */
    public static int thisYear() {
        return LocalDate.now(ZONE).getYear();
    }
}
