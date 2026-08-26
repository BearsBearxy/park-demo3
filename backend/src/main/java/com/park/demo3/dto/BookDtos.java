package com.park.demo3.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDateTime;
import java.util.List;

/** 账册工作台 HTTP 契约(BOOK-WORKBENCH-SPEC)。definition 以 JSON 树透传,内部模型见 TemplateDef。 */
public final class BookDtos {
    private BookDtos() {}

    public record BookDTO(Integer id, String screen, Integer companyId, Integer phase,
                          String name, int ver, int latestVer, JsonNode definition) {}

    /** 保存模板:year/月必填 —— 编辑从该月生效的那版长出新版,只把该月切过去(spec P4)。 */
    public record TemplateSaveReq(@NotNull JsonNode definition, String note,
                                  @NotNull Integer year, @NotNull Integer month) {}

    /** saved 后回传。structural 自 2026-08-26 起恒 true(spec P5:版本不可变,任何保存都升版)——
     *  字段留着只为不动前端契约,新代码不要再拿它分支。 */
    public record TemplateSaveResultDTO(BookDTO book, boolean structural, String changeSummary) {}

    public record TemplateVersionDTO(long id, int ver, String note, String createdBy,
                                     LocalDateTime createdAt, boolean current) {}

    /** 钉本月的版本(选择器)。取代 AdoptReq:指针从「每册一个」变成「每册每月一个」。 */
    public record PinReq(@NotNull Integer ver, @NotNull Integer year, @NotNull Integer month) {}

    /** 归档列:该月有非零值、但生效模板不渲染的自定义列(spec §2)。 */
    public record ArchivedColDTO(String id, String label) {}

    public record VersionListDTO(List<TemplateVersionDTO> versions) {}
}
