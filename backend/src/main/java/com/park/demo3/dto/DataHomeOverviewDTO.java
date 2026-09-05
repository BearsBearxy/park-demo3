package com.park.demo3.dto;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/**
 * 数据中心首页只读聚合(DATA-HOME-REDESIGN spec §3)。首页 = 录入工作台,只回答「现在该干什么」。
 *
 * 2026-08-18 重设计:旧契约有 kpis/tasks/recent/progress* 四组字段,但整页把同一批信息说了三遍 ——
 * 4 个 KPI 卡里 3 个是下方栏目的重复,而「本期待办」本身是「完整度」的子集(旧 DataHomeService
 * 直接遍历同一个 sources 生成 tasks)。用户反馈「无从下手、信息量过多、没有主次」即源于此,
 * 那是信息架构问题不是排版问题,故整组删除而非重排。
 *
 * 现在只剩两段:chain(出账链,有先后依赖 → 画成流水线) + schedules(附表,互相独立 → 画成清单),
 * 外加 blockers(前置条,**只在有问题时非空**)。信息不丢:待办 = chain 非 done 步 ∪ schedules 未录项。
 */
public record DataHomeOverviewDTO(
    Period period,              // null = 库里一条数据都没有(全新库)
    List<String> months,        // 顶部下拉可切月份('YYYY-MM' 升序;链 ∪ 附表)
    List<Blocker> blockers,     // 空 = 前端整条不渲染
    Chain chain,
    Schedules schedules
) {
    public record Period(int year, int month, String label) {}
    /** 前置条(spec §2.1):kind = contract-gap | param-stale。空数组 = 前端整条不渲染。 */
    public record Blocker(String kind, String text, String cta, String go) {}
    /** 出账链(spec §2.1)。currentIndex=-1 表示 5 步全部完成。 */
    public record Chain(int currentIndex, List<Step> steps) {}
    /** status: done | current | todo;go = 导航 value。 */
    public record Step(String key, String label, String status, String detail, String go) {}
    /** 附表录入 9 项。 */
    public record Schedules(int done, int total, List<Item> items) {}
    /** companies/phases都可为null：只有台账(ledger)出companies、只有附10出phases；review位归R1。 */
    public record Item(String name, String tag, boolean done, String go,
                       List<Company> companies, List<Phase> phases) {}
    /** 台账公司清单：全集来自管理公司表，done = 该公司本月台账有没有行。 */
    public record Company(int id, @JsonProperty("short") String shortName, boolean done) {}
    /** 附10四个期区：no = phase(1一期/2二期/3三期/4宿舍)，done = 该slot本月有没有行。 */
    public record Phase(int no, boolean done) {}
}
