package com.park.demo3.controller;
import com.park.demo3.dto.ParamPutReq;
import com.park.demo3.dto.PriceCfgCopyReq;
import com.park.demo3.dto.PriceCfgDTO;
import com.park.demo3.dto.PriceCfgReq;
import com.park.demo3.service.ParamService;
import com.park.demo3.service.PriceCfgService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import java.util.List;

// 价目管理(PRICE-CFG-SPEC §4 v2)。GET=已登录可读,写=admin(SecurityConfig 全局门,权限零配置)。
// 错误语义:业务错(白名单外 key/月变键缺生效月)HTTP 200+body.code=400;校验错(@Valid)HTTP 400。
// S21:PUT 内部走 ParamService.write(注册表门 + param_change_log + 缓存失效);mode 缺省=注册表默认(电价 month、其余 from,=旧语义)。
@Tag(name = "价目管理")
@RestController
@RequestMapping("/api/price-cfg")
public class PriceCfgController {
    private final PriceCfgService svc;
    private final ParamService params;
    public PriceCfgController(PriceCfgService svc, ParamService params) { this.svc = svc; this.params = params; }

    @Operation(summary = "整表全量(行数<100,版本链解析与历史展示归前端;排序 scope,cfg_key,acct_month)") @GetMapping
    public List<PriceCfgDTO> list() {
        return svc.listAll();
    }

    @Operation(summary = "单行 upsert(acctMonth=版本生效起点,月变键必填;value=null 删该版本行;S21 起走 ParamService 同一写路径)") @PutMapping
    public void save(@Valid @RequestBody PriceCfgReq req) {
        params.write(new ParamPutReq(req.cfgKey(), req.scope(), req.acctMonth(), req.mode(), req.value(), req.note(), null), null);
    }

    @Operation(summary = "复制上月电价 fromYm→toYm(仅月变键,目标已有跳过,幂等)") @PostMapping("/copy")
    public PriceCfgService.CopyResult copy(@Valid @RequestBody PriceCfgCopyReq req) {
        return svc.copy(req.fromYm(), req.toYm());
    }
}
