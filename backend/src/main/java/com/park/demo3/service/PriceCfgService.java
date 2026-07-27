package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.PriceCfgDTO;
import com.park.demo3.dto.PriceCfgReq;
import com.park.demo3.entity.Tenant;
import com.park.demo3.entity.TenantPriceCfg;
import com.park.demo3.mapper.TenantMapper;
import com.park.demo3.mapper.TenantPriceCfgMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.util.*;
import java.util.regex.Pattern;

// 价目管理(PRICE-CFG-SPEC v2):派生引擎取价的单一事实源。acct_month=版本生效起点(''=初始版本),
// 每 (scope,cfg_key) 行序列构成版本链(§3):常数键沿链前滚(<=ym 最大者),月变键(电价6键)仅命中当月版本。
@Service
public class PriceCfgService {
    private static final Pattern YM = Pattern.compile("\\d{4}-(0[1-9]|1[0-2])");

    // §2 cfg_key 受控白名单(V62 定格 19 键;前端 utils/priceCfgLogic.ts PRICE_KEYS 镜像)
    static final Set<String> CFG_KEYS = Set.of(
        "elec_peak", "elec_sharp", "elec_flat", "elec_valley", "elec_resident", "elec_commercial",   // 电价·月变
        "mgmt_fee", "mgmt_fee_commercial", "sharp_as_peak_ratio",                                     // 附加与开关
        "capacity_fee", "water", "water_pipe",                                                        // 容量与水
        "lamp_area_base", "green_area_base", "area_base", "elevator_area_base",                       // 月推参数
        "loss_rate", "elec_package", "elevator_package");                                             // 特殊轨道

    // 月变键=电价6键(registry monthly:true):逐月变,不前滚,缺当月版本=null→派生门禁拦截
    static final Set<String> MONTHLY_KEYS = Set.of(
        "elec_peak", "elec_sharp", "elec_flat", "elec_valley", "elec_resident", "elec_commercial");

    private final TenantPriceCfgMapper cfgs;
    private final TenantMapper tenants;

    public PriceCfgService(TenantPriceCfgMapper cfgs, TenantMapper tenants) {
        this.cfgs = cfgs; this.tenants = tenants;
    }

    // ── 读:整表全量(行数<100,版本链解析与历史展示归前端);tenantName 联租户表解析(§4) ──
    public List<PriceCfgDTO> listAll() {
        List<TenantPriceCfg> rows = cfgs.selectList(new QueryWrapper<TenantPriceCfg>()
                .orderByAsc("scope", "cfg_key", "acct_month"));
        Set<Integer> tids = new HashSet<>();
        for (TenantPriceCfg c : rows) { Integer t = tenantIdOf(c.getScope()); if (t != null) tids.add(t); }
        Map<Integer, String> nameById = new HashMap<>();
        if (!tids.isEmpty()) for (Tenant t : tenants.selectBatchIds(tids)) nameById.put(t.getId(), t.getCompanyName());
        return rows.stream().map(c -> {
            Integer t = tenantIdOf(c.getScope());
            String name = t == null ? null : nameById.getOrDefault(t, "已删租户#" + t);
            return new PriceCfgDTO(c.getId(), c.getScope(), c.getCfgKey(), c.getAcctMonth(),
                c.getCfgValue(), c.getNote(), c.getUpdatedAt(), name);
        }).toList();
    }

    // ── 写:单行 upsert(§4);月变键 acctMonth 必填非空(禁 '' 行);value=null 删该版本行(有行删、无行零操作) ──
    public void upsert(PriceCfgReq req) {
        String key = req.cfgKey().trim();
        if (!CFG_KEYS.contains(key)) throw new BizException(ResultCode.BAD_REQUEST, "费项键不在白名单：" + key);
        String scope = req.scope() == null ? "" : req.scope().trim();
        String month = req.acctMonth() == null ? "" : req.acctMonth().trim();
        if (MONTHLY_KEYS.contains(key) && month.isEmpty())
            throw new BizException(ResultCode.BAD_REQUEST, "月变键须指定生效月：" + key);
        TenantPriceCfg row = cfgs.selectByKey(scope, key, month);
        if (req.value() == null) {
            if (row != null) cfgs.deleteById(row.getId());
            return;
        }
        if (row == null) {
            row = new TenantPriceCfg();
            row.setScope(scope); row.setCfgKey(key); row.setAcctMonth(month);
        }
        row.setCfgValue(req.value());
        row.setNote(req.note() == null || req.note().isBlank() ? null : req.note().trim());
        if (row.getId() == null) cfgs.insert(row); else cfgs.updateById(row);
    }

    public record CopyResult(int copied, int skipped) {}

    // ── 复制上月电价:仅月变键的 fromYm 版本→toYm,目标已有跳过=幂等二跑 copied=0(§4) ──
    @Transactional
    public CopyResult copy(String fromYm, String toYm) {
        requireYm(fromYm); requireYm(toYm);
        int copied = 0, skipped = 0;
        for (TenantPriceCfg src : cfgs.selectList(new QueryWrapper<TenantPriceCfg>()
                .eq("acct_month", fromYm).in("cfg_key", MONTHLY_KEYS).orderByAsc("scope", "cfg_key"))) {
            if (cfgs.selectByKey(src.getScope(), src.getCfgKey(), toYm) != null) { skipped++; continue; }
            TenantPriceCfg row = new TenantPriceCfg();
            row.setScope(src.getScope()); row.setCfgKey(src.getCfgKey()); row.setAcctMonth(toYm);
            row.setCfgValue(src.getCfgValue()); row.setNote(src.getNote());
            cfgs.insert(row); copied++;
        }
        return new CopyResult(copied, skipped);
    }

    // ── §3 取价 v2 版本链,scope 级联 tenant:{id}→zone→'' 首中即返:
    //    月变键仅命中 acct_month==ym;常数键取 acct_month<=ym 最大者(''最小,版本自动前滚)。
    //    字符串比较即可(YYYY-MM 字典序=时间序)。public 供 S3 派生引擎复用。
    //    ponytail: S3 落 bill_notice 需 price_snap+版本生效月时,返回值再扩成 record。 ──
    public BigDecimal resolve(String key, String ym, Integer tenantId, String zone) {
        requireYm(ym);
        List<String> scopes = new ArrayList<>();
        if (tenantId != null) scopes.add("tenant:" + tenantId);
        if (zone != null && !zone.isEmpty()) scopes.add(zone);
        scopes.add("");
        List<TenantPriceCfg> rows = cfgs.selectList(new QueryWrapper<TenantPriceCfg>()
                .in("scope", scopes).eq("cfg_key", key));
        boolean monthly = MONTHLY_KEYS.contains(key);
        for (String scope : scopes) {
            TenantPriceCfg hit = null;
            for (TenantPriceCfg c : rows) {
                if (!scope.equals(c.getScope())) continue;
                String m = c.getAcctMonth();
                if (monthly ? !m.equals(ym) : m.compareTo(ym) > 0) continue;
                if (hit == null || m.compareTo(hit.getAcctMonth()) > 0) hit = c;
            }
            if (hit != null) return hit.getCfgValue();
        }
        return null;
    }

    private static Integer tenantIdOf(String scope) {
        return scope != null && scope.startsWith("tenant:") ? Integer.valueOf(scope.substring(7)) : null;
    }

    private static void requireYm(String ym) {
        if (ym == null || !YM.matcher(ym).matches())
            throw new BizException(ResultCode.BAD_REQUEST, "月份格式须为 YYYY-MM");
    }
}
