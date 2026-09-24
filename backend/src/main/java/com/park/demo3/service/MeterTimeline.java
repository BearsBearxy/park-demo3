package com.park.demo3.service;

import com.park.demo3.entity.MeterAssign;
import com.park.demo3.entity.MeterStatus;

import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.function.Function;

/**
 * 表档案按月记录的纯函数(METER-TIMELINE-SPEC §2 §3.2 §4)。不碰库,MeterTimelineServiceTest 直接测。
 *
 * 一段的覆盖区间 = [from_ym, 下一行的 from_ym);没有下一行 = 链尾,一直到以后。
 * YYYY-MM 的字典序就是时间序,全程按字符串比。
 */
public final class MeterTimeline {
    private MeterTimeline() {}

    /** 「最新一行」的哨兵月:没有月份语境的读取(档案枚举)站在这里看。 */
    public static final String LATEST = "9999-12";

    /** from ≤ ym 的最后一行;没有则 null。rows 须按 from 升序(viewAt / rows 装出来就是)。 */
    public static <T> T pick(List<T> rows, Function<T, String> from, String ym) {
        T hit = null;
        for (T r : rows) {
            if (from.apply(r).compareTo(ym) > 0) break;
            hit = r;
        }
        return hit;
    }

    /** §2 assignAt:早于第一行时取第一行(防御,正常路径不会发生 —— 状态早于第一行 = 不在册)。 */
    public static MeterAssign assignAt(List<MeterAssign> rows, String ym) {
        MeterAssign a = pick(rows, MeterAssign::getFromYm, ym);
        return a != null || rows.isEmpty() ? a : rows.get(0);
    }

    /** §2 statusAt:早于第一行 = 不在册,回 null。 */
    public static MeterStatus statusAt(List<MeterStatus> rows, String ym) {
        return pick(rows, MeterStatus::getFromYm, ym);
    }

    /** from 这一段的下一行起始月(本段覆盖到它的前一个月);没有 = 链尾,回 null。froms 不要求有序。 */
    public static String until(List<String> froms, String from) {
        return froms.stream().filter(f -> f.compareTo(from) > 0).min(Comparator.naturalOrder()).orElse(null);
    }

    /**
     * 改动一段影响到的月份(§4:按受影响区间逐月查冻结、逐月记 data_change_log)。
     *   · 有下一行:[from, until) —— R4:改前面的段穿不过后面已有的行;
     *   · 链尾:[from, max(maxGenYm, from)] —— 取到「库里最大已生成月」,不退化成只有 from 一个月。
     */
    public static List<String> affectedMonths(String from, String until, String maxGenYm) {
        YearMonth a = YearMonth.parse(from);
        YearMonth end = until != null ? YearMonth.parse(until).minusMonths(1)
            : maxGenYm != null && maxGenYm.compareTo(from) > 0 ? YearMonth.parse(maxGenYm) : a;
        List<String> out = new ArrayList<>();
        for (YearMonth m = a; !m.isAfter(end); m = m.plusMonths(1)) out.add(m.toString());
        return out;
    }

    /**
     * §3.2「变了」的判据:回变了的字段名(tenant buildingId ownership area spot floorLabel side roomNo subName contractId)。
     *   · 租户:两边都有 id 比 id,否则比规范化名;
     *   · 推导列(楼栋 / 楼层 / 方位 / 房号,由区域与位置原文解析而来)任一边为空 = 未知,不参与比较 —— 解析不出来不是「变了」;
     *   · 文本一律先规范化(去首尾空白、压空白、全角转半角)。
     */
    public static List<String> diff(MeterAssign a, MeterAssign b) {
        List<String> out = new ArrayList<>();
        boolean sameTenant = a.getTenantId() != null && b.getTenantId() != null
            ? a.getTenantId().equals(b.getTenantId())
            : canon(a.getTenantName()).equals(canon(b.getTenantName()));
        if (!sameTenant) out.add("tenant");
        if (derivedDiffers(a.getBuildingId(), b.getBuildingId())) out.add("buildingId");
        if (textDiffers(a.getOwnership(), b.getOwnership())) out.add("ownership");
        if (textDiffers(a.getArea(), b.getArea())) out.add("area");
        if (textDiffers(a.getSpot(), b.getSpot())) out.add("spot");
        if (derivedDiffers(a.getFloorLabel(), b.getFloorLabel())) out.add("floorLabel");
        if (derivedDiffers(a.getSide(), b.getSide())) out.add("side");
        if (derivedDiffers(a.getRoomNo(), b.getRoomNo())) out.add("roomNo");
        if (textDiffers(a.getSubName(), b.getSubName())) out.add("subName");
        if (!Objects.equals(a.getContractId(), b.getContractId())) out.add("contractId");
        return out;
    }

    /** 规范化:全角转半角(U+FF01–FF5E、全角空格)→ 压空白 → 去首尾。null 当空串。 */
    public static String canon(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length());
        for (char c : s.toCharArray())
            b.append(c == '\u3000' ? ' ' : c >= '\uFF01' && c <= '\uFF5E' ? (char) (c - 0xFEE0) : c);
        return b.toString().replaceAll("(?U)\\s+", " ").strip();
    }

    private static boolean textDiffers(String x, String y) { return !canon(x).equals(canon(y)); }

    private static boolean derivedDiffers(Object x, Object y) {
        String cx = x == null ? "" : canon(x.toString()), cy = y == null ? "" : canon(y.toString());
        return !cx.isEmpty() && !cy.isEmpty() && !cx.equals(cy);
    }
}
