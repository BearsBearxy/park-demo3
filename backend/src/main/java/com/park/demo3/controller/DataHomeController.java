package com.park.demo3.controller;
import com.park.demo3.dto.DataHomeOverviewDTO;
import com.park.demo3.service.DataHomeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

@Tag(name = "数据中心首页")
@RestController
@RequestMapping("/api/data-home")
public class DataHomeController {
    private final DataHomeService svc;
    public DataHomeController(DataHomeService svc) { this.svc = svc; }

    @Operation(summary = "数据中心首页只读聚合") @GetMapping("/overview")
    public DataHomeOverviewDTO overview() { return svc.overview(); }
}
