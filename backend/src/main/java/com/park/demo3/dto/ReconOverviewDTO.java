package com.park.demo3.dto;
import java.util.List;
// 月卡层:12 个月的实体/状态计数(hasData=两侧任一有数据)
public record ReconOverviewDTO(int year, List<MonthMeta> months) {
    public record MonthMeta(int month, boolean hasData, int entityCount,
                            int okCount, int diffCount, int missCount) {}
}
