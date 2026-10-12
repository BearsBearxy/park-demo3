/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.dto;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.LocalDateTime;
import java.util.List;

/** 导入中心(改稿 2026-10-10)两个读接口的回包。集中一个文件,同 SystemDtos。 */
public final class ImportCenterDtos {
    private ImportCenterDtos() {}

    /**
     * GET /api/import-log/coverage 一类一条,key 即前端 importRegistry 的 key。
     * kind:chips(公司 / 期区胶囊)| day(到 X月X日)| month(到 N月)| year(该年有没有)| has(有 / 没有)| na(不按月)。
     * 用不上的字段不出现(chips / upTo / has / last)。missing = 这一行算不算「还差」。
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CoverageItem(String key, String kind, List<Chip> chips, String upTo, Boolean has,
                               boolean missing, Last last) {}
    /** code:公司胶囊 = management_company.id;附表10 = 期号 1..4;园区抄表 = 期区码 p1/p2/p3/dorm。 */
    public record Chip(String label, String code, boolean done) {}
    /** 上次导入(被拒的不算):at 时间、operator 谁、rows 写进去的行数(import_log.ok;合同两类是户数)。 */
    public record Last(LocalDateTime at, String operator, int rows) {}

    /** GET /api/import-log/page。total = 当前页签 + 去处筛选下的条数;counts 只跟去处筛选走,不跟页签走。 */
    public record Page(List<ImportLogDTO> rows, long total, int page, int size, Counts counts) {}
    public record Counts(long all, long partial, long rejected) {}
}
