package com.park.demo3.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDateTime;
import java.util.List;

/** 账册工作台 HTTP 契约(BOOK-WORKBENCH-SPEC)。definition 以 JSON 树透传,内部模型见 TemplateDef。 */
public final class BookDtos {
    private BookDtos() {}

    public record BookDTO(Integer id, String screen, Integer companyId, Integer phase,
                          String name, int ver, JsonNode definition) {}

    public record TemplateSaveReq(@NotNull JsonNode definition, String note) {}

    /** saved 后回传:structural=本次是否升了版本(轻改动 false,原版号不变)。 */
    public record TemplateSaveResultDTO(BookDTO book, boolean structural, String changeSummary) {}

    public record TemplateVersionDTO(long id, int ver, String note, String createdBy,
                                     LocalDateTime createdAt, boolean current) {}

    public record RollbackReq(@NotNull Integer ver) {}

    public record VersionListDTO(List<TemplateVersionDTO> versions) {}
}
