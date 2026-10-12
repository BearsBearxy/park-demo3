/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.controller;
import com.park.demo3.dto.TenantCategoryDTO;
import com.park.demo3.service.TenantService;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;
import java.util.List;
@Tag(name = "租户分类")
@RestController
@RequestMapping("/api/tenant-categories")
public class TenantCategoryController {
    private final TenantService svc;
    public TenantCategoryController(TenantService svc) { this.svc = svc; }
    @GetMapping public List<TenantCategoryDTO> list() { return svc.categoriesList(); }
}
