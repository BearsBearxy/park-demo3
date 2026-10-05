package com.park.demo3.service;

import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import com.park.demo3.mapper.AnalysisSettingMapper;
import com.park.demo3.security.NoReviewGuard;
import com.park.demo3.service.ChangeLogService.Cell;
import com.park.demo3.service.ChangeLogService.Tbl;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 经营分析「目标与阈值」(V138 analysis_setting)。用户 2026-10-05 拍板「2按你建议，3，4一起做」第 2 条:
 * 从各人浏览器挪进库 —— 全员看同一份;只有「账簿报表」编辑权能改(PermissionRegistry 的 PUT 规则);
 * 每改一项进操作日志(ChangeLogService,和保存同一个事务,记不进去就不存)。
 * 没存过的项不落行:屏上用前端 anaSettings.ts 的默认值。
 */
@Service
public class AnalysisSettingService {

    /**
     * 六项:屏上的名字、能填的范围、默认值。范围照 AnaShell 弹层输入框的 min/max;
     * 光伏投资框只写了 min 0,上限 1 亿万元是为了放得进 DECIMAL(16,4),不是业务口径。
     * ⚠ 默认值与 frontend/src/analysis/anaSettings.ts 的 ANA_SETTINGS_DEFAULT 同值,这里只用来写改动记录的「改前」:
     *   没存过的项屏上显示的就是默认值,改前记默认值才对得上人看到的。改默认值两边一起改。
     */
    enum Key {
        occTarget("出租率目标 (%)", "50", "100", "90"),
        collectTarget("收缴率目标 (%)", "50", "100", "96"),
        churnTh("风险线/流失预警 (分)", "30", "90", "60"),
        spikeTh("能耗突变阈值 (%)", "10", "200", "40"),
        breakevenFixedRatio("固定成本占比", "0", "1", "0.62"),
        pvInvestment("光伏投资 (万)", "0", "100000000", "0");

        final String label;
        final BigDecimal min, max, dflt;
        Key(String label, String min, String max, String dflt) {
            this.label = label; this.min = new BigDecimal(min); this.max = new BigDecimal(max); this.dflt = new BigDecimal(dflt);
        }
    }

    private final AnalysisSettingMapper mapper;
    private final ChangeLogService changes;

    public AnalysisSettingService(AnalysisSettingMapper mapper, ChangeLogService changes) {
        this.mapper = mapper; this.changes = changes;
    }

    /** 存过的项;没存过的不回(前端用默认值)。 */
    public Map<String, Double> get() {
        Map<String, Double> out = new LinkedHashMap<>();
        stored().forEach((k, v) -> out.put(k, v.doubleValue()));
        return out;
    }

    /**
     * 改几项。先全部校验,有一项不对整次不存;值没变的项不写也不记。
     * 只回送来的那几项(存进库的样子,四位小数):PUT 只要「账簿报表」,读要「经营分析 · 查看」——
     * 回整份的话,没有分析查看权的账号一次值没变的保存就能读走光伏投资额等(2026-10-05 对抗复查 SEC-7)。
     */
    @Transactional
    @NoReviewGuard(reason = "目标与阈值是分析屏的判断线(收缴率目标、风险线等),不是哪个月的账;"
                          + "analysis_setting 与 value_change_log 一列月份都没有,审核键的 period 套不上去")
    public Map<String, Double> save(Map<String, BigDecimal> patch) {
        if (patch == null || patch.isEmpty()) throw bad("没有要改的项");
        Map<Key, BigDecimal> next = new LinkedHashMap<>();
        for (Map.Entry<String, BigDecimal> e : patch.entrySet()) {
            Key k;
            try { k = Key.valueOf(e.getKey()); } catch (IllegalArgumentException x) { throw bad("没有「" + e.getKey() + "」这一项"); }
            BigDecimal v = e.getValue();
            if (v == null || v.compareTo(k.min) < 0 || v.compareTo(k.max) > 0)
                throw bad("「" + k.label + "」要在 " + k.min.toPlainString() + " 到 " + k.max.toPlainString() + " 之间");
            next.put(k, v.setScale(4, RoundingMode.HALF_UP));
        }
        Map<String, BigDecimal> now = stored();
        String me = AuditLogService.actor();
        LocalDateTime at = LocalDateTime.now();
        List<Cell> cells = new ArrayList<>();
        for (Map.Entry<Key, BigDecimal> e : next.entrySet()) {
            Key k = e.getKey();
            BigDecimal before = now.getOrDefault(k.name(), k.dflt), after = e.getValue();
            if (before.compareTo(after) == 0) continue;
            mapper.upsert(k.name(), after, me, at);
            cells.add(new Cell("经营分析", k.label, shown(k, before), shown(k, after)));
        }
        changes.record(Tbl.ANALYSIS_SETTING, cells, null);
        Map<String, Double> out = new LinkedHashMap<>();
        next.forEach((k, v) -> out.put(k.name(), v.doubleValue()));
        return out;
    }

    private Map<String, BigDecimal> stored() {
        Map<String, BigDecimal> out = new LinkedHashMap<>();
        for (Map<String, Object> r : mapper.all()) out.put((String) r.get("k"), (BigDecimal) r.get("v"));
        return out;
    }

    /** 光伏投资 0 的意思是「按各期工程成本合计」(PvRoiView),记成 0 人看不懂。 */
    private static Object shown(Key k, BigDecimal v) {
        return k == Key.pvInvestment && v.signum() == 0 ? "按各期工程成本合计" : v;
    }

    private static BizException bad(String msg) { return new BizException(ResultCode.BAD_REQUEST, msg); }
}
