package com.park.demo3.controller;
import com.park.demo3.dto.BookDtos.*;
import com.park.demo3.service.BookService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Pattern;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@Tag(name = "账册与模板")
@RestController
@Validated
@RequestMapping("/api/books")
public class BookController {
    private final BookService svc;
    public BookController(BookService svc) { this.svc = svc; }

    @Operation(summary = "本屏账册清单(含现行版模板定义)") @GetMapping
    public List<BookDTO> list(@RequestParam @Pattern(regexp = "ledger|s10") String screen) {
        return svc.list(screen);
    }

    @Operation(summary = "保存模板(任何保存都升版;只把 body 里的 year/month 那个月切到新版;标准列不可删 409)")
    @PutMapping("/{id}/template")
    public TemplateSaveResultDTO saveTemplate(@PathVariable Integer id,
                                              @Valid @RequestBody TemplateSaveReq req) {
        return svc.saveTemplate(id, req);
    }

    @Operation(summary = "某月生效的模板(按 pin 解析:本月→最近更早月→链尾)")
    @GetMapping("/{id}/template/at/{year}/{month}")
    public BookDTO templateAt(@PathVariable Integer id, @PathVariable int year, @PathVariable int month) {
        return svc.templateAt(id, year, month);
    }

    @Operation(summary = "模板版本链") @GetMapping("/{id}/template/versions")
    public VersionListDTO versions(@PathVariable Integer id) { return svc.versionList(id); }

    @Operation(summary = "历史版本定义(只读预览列名与布局)")
    @GetMapping("/{id}/template/versions/{ver}")
    public com.fasterxml.jackson.databind.JsonNode versionDefinition(
            @PathVariable Integer id, @PathVariable Integer ver) {
        return svc.versionDefinition(id, ver);
    }

}
