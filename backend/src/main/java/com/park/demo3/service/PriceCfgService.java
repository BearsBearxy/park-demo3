package com.park.demo3.service;
import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.dto.PriceCfgDTO;
import com.park.demo3.entity.Tenant;
import com.park.demo3.entity.TenantPriceCfg;
import com.park.demo3.mapper.TenantMapper;
import com.park.demo3.mapper.TenantPriceCfgMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import java.math.BigDecimal;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

// 价目管理(PRICE-CFG-SPEC v2):派生引擎取价的单一事实源。acct_month=版本生效起点(''=初始版本),
// 每 (scope,cfg_key) 行序列构成版本链(§3):常数键沿链前滚(<=ym 最大者),月变键(电价6键)仅命中当月版本。
// S21:判据从「键属于 MONTHLY_KEYS」改为「行的 mode」(from=前滚/month=仅该月),取值走 VersionResolver(与 alloc_cfg 同一实现);
// 白名单与写入 mode 缺省都来自 ParamRegistry(S21-PARAM-CENTER-SPEC §2.3:两表唯一注册表),旧语义一格不变;
// 写路径(单行 upsert/删版本行)已归 ParamService.write(注册表门 + 变更日志),本类只剩读/取价/复制上月电价。
@Service
public class PriceCfgService {
    private static final Pattern YM = Pattern.compile("\\d{4}-(0[1-9]|1[0-2])");

    // §2 cfg_key 受控白名单 = 注册表里 table=PRICE 的全部键(S21 起唯一来源;spec §3.4 新键 lamp_rate/fire_amount_fixed/
    // loss_base_form(_b{bid})/loss_base_park_meter|amount 放行,退役键 loss_rate/green_rate_live/lamp_rate_live 出局)。
    // ⚠BOOK-REBUILD-SPEC §H3 的四个「2023 冻结参数」(隐藏表『公共电分摊』M99/M109/L24/L99)**刻意不进
    // 本白名单、也不进 tenant_price_cfg**:它们不是价目输入,而是绑定在具体池上的历史事实 —— V62(用户
    // 2026-07-27 拍板)已把五个月推单价键清出价目簿。它们由 V83__frozen_params.sql 落成 alloc_cfg 的 rule:{id} 默认行
    // (cfg_key='frozen_2023',acct_month='' 即「不随月份变」=冻结,真实年月写 note),由公共电核算屏
    // 「分摊标准」列 title 披露(前端 poolLedgerLogic.FROZEN_CFG_KEY)。找 2023 冻结价请去那里。
    static final Set<String> CFG_KEYS = ParamRegistry.keysOf(ParamRegistry.Table.PRICE);
    // ⚠ share_elec_fixed 是 elevator_package 改名(2026-08-09):后者建键时以为包干只替电梯,源册
    // (一期2024年2月水电费.xlsx 各户缴费通知单 + 两张总表)证明它替「楼层公共、消防照明+电梯+路灯公摊」
    // 三项;水侧同一纸单第二个包干替「绿化水公摊」=share_water_fixed。改名时 elevator_package 全库 0 行。

    // 月变键=注册表默认 month 的价目键(电价6键 + 永龙照抄金额 loss_base_park_amount):逐月变,不前滚,
    // acctMonth 必填(禁 '' 行);电价缺当月版本=null→派生门禁拦截
    static final Set<String> MONTHLY_KEYS = CFG_KEYS.stream()
        .filter(k -> "month".equals(ParamRegistry.defaultMode(k))).collect(Collectors.toUnmodifiableSet());
    // 「复制上月电价」只搬电价 6 键(照抄金额类月参不复制)
    static final Set<String> ELEC_KEYS = Set.of(
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
            return new PriceCfgDTO(c.getId(), c.getScope(), c.getCfgKey(), c.getAcctMonth(), c.getMode(),
                c.getCfgValue(), c.getNote(), c.getUpdatedAt(), name);
        }).toList();
    }

    // ── 写:S21 起单行 upsert / 删版本行统一走 ParamService.write(注册表门 + param_change_log + evict);
    //    PUT /api/price-cfg 在 PriceCfgController 直接转调(本类不依赖 ParamService,免 bean 环)。 ──

    public record CopyResult(int copied, int skipped) {}

    // ── 复制上月电价:仅月变键的 fromYm 版本→toYm,目标已有跳过=幂等二跑 copied=0(§4) ──
    @Transactional
    public CopyResult copy(String fromYm, String toYm) {
        requireYm(fromYm); requireYm(toYm);
        int copied = 0, skipped = 0;
        for (TenantPriceCfg src : cfgs.selectList(new QueryWrapper<TenantPriceCfg>()
                .eq("acct_month", fromYm).in("cfg_key", ELEC_KEYS).orderByAsc("scope", "cfg_key"))) {
            String mode = src.getMode() == null ? "month" : src.getMode();
            if (cfgs.selectByKey(src.getScope(), src.getCfgKey(), toYm, mode) != null) { skipped++; continue; }
            TenantPriceCfg row = new TenantPriceCfg();
            row.setScope(src.getScope()); row.setCfgKey(src.getCfgKey()); row.setAcctMonth(toYm); row.setMode(mode);
            row.setCfgValue(src.getCfgValue()); row.setNote(src.getNote());
            cfgs.insert(row); copied++;
        }
        if (copied > 0) evict();
        return new CopyResult(copied, skipped);
    }

    // ── §3 取价 v2 版本链,scope 级联 tenant:{id}→zone→'' 首中即返:
    //    行 mode=month 仅命中 acct_month==ym;mode=from 取 acct_month<=ym 最大者(''最小,版本自动前滚)。
    //    规则实现在 VersionResolver(alloc_cfg 同一份)。public 供派生引擎复用。 ──
    public BigDecimal resolve(String key, String ym, Integer tenantId, String zone) {
        PriceHit hit = resolveHit(key, ym, tenantId, zone);
        return hit == null ? null : hit.value();
    }

    // S4-0.1:命中行带 scope+版本生效月(bill_notice_line 的 price_scope/price_month 审计链);查无=null 同 resolve
    public record PriceHit(BigDecimal value, String scope, String acctMonth) {}

    public PriceHit resolveHit(String key, String ym, Integer tenantId, String zone) {
        requireYm(ym);
        List<String> scopes = new ArrayList<>();
        if (tenantId != null) scopes.add("tenant:" + tenantId);
        if (zone != null && !zone.isEmpty()) scopes.add(zone);
        scopes.add("");
        VersionResolver.Hit hit = VersionResolver.resolve(index(), key, ym, scopes);
        return hit == null ? null : new PriceHit(hit.value(), hit.scope(), hit.acctMonth());
    }

    // 整表<300行,一次载入按 cfg_key→scope 分组(派生是 户×费项 量级的 resolve,逐次单查是 N+1)。
    // 简单 volatile 快照,本 service 写路径失效;写在事务里时提交/回滚后再失效一次,
    // 防止事务内重建把未提交行缓过事务边界(IT 全程 @Transactional 回滚,靠这条不串档)。
    private volatile Map<String, Map<String, List<VersionResolver.Row>>> index;

    private Map<String, Map<String, List<VersionResolver.Row>>> index() {
        Map<String, Map<String, List<VersionResolver.Row>>> idx = index;
        if (idx == null) {
            idx = new HashMap<>();
            for (TenantPriceCfg c : cfgs.selectList(null))
                idx.computeIfAbsent(c.getCfgKey(), k -> new HashMap<>())
                   .computeIfAbsent(c.getScope(), s -> new ArrayList<>())
                   .add(new VersionResolver.Row(c.getScope(), c.getCfgKey(), c.getAcctMonth(), c.getMode(), c.getCfgValue(), c.getId()));
            index = idx;
        }
        return idx;
    }

    // 写路径(本类 copy / ParamService.write)失效缓存
    void evict() {
        index = null;
        if (TransactionSynchronizationManager.isSynchronizationActive())
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCompletion(int status) { index = null; }
            });
    }

    private static Integer tenantIdOf(String scope) {
        return scope != null && scope.startsWith("tenant:") ? Integer.valueOf(scope.substring(7)) : null;
    }

    private static void requireYm(String ym) {
        if (ym == null || !YM.matcher(ym).matches())
            throw new BizException(ResultCode.BAD_REQUEST, "月份格式须为 YYYY-MM");
    }
}
