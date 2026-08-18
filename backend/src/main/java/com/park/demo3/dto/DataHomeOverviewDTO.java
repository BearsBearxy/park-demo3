package com.park.demo3.dto;
import java.util.List;
public record DataHomeOverviewDTO(
    Period period,
    int progressDone, int progressTotal, int pct,
    List<DataHomeKpiDTO> kpis,
    List<DataHomeSourceDTO> sources,
    List<DataHomeTaskDTO> tasks,
    List<DataHomeRecentDTO> recent
) {
    public record Period(int year, int month, String label) {}
    /** 前置条(spec §2.1):kind = contract-gap | param-stale。空数组 = 前端整条不渲染。 */
    public record Blocker(String kind, String text, String cta, String go) {}
    /** 出账链(spec §2.1)。currentIndex=-1 表示 4 步全部完成。 */
    public record Chain(int currentIndex, List<Step> steps) {}
    /** status: done | current | todo;go = 导航 value。 */
    public record Step(String key, String label, String status, String detail, String go) {}
}
