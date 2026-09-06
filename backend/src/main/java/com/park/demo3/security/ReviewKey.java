package com.park.demo3.security;

import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;

/**
 * 一把审核键:`kind[:scope]:period`(SIDEBAR-UX-REDESIGN §7.1)。
 *
 * 解析从**右边**切:kind 里有连字符但没有冒号,而 period 恒在末段、scope 恒在中段。
 * 从左切会把 `charging-ebike:2024-02` / `alloc-loss:2024-02` 切错。
 *
 * 任何拼键的地方都走 {@link #of},不要自己拼字符串 —— of() 顺手把 period 格式与
 * scope 形状一起校验了,自己拼就绕过了这道。
 */
public record ReviewKey(ReviewKind kind, String scope, String period) {

    public static ReviewKey parse(String raw) {
        if (raw == null || raw.isBlank()) throw new BizException(ResultCode.BAD_REQUEST, "审核键为空");
        int last = raw.lastIndexOf(':');
        if (last < 0) throw new BizException(ResultCode.BAD_REQUEST, "审核键格式错误:" + raw);
        String period = raw.substring(last + 1);
        String head = raw.substring(0, last);
        int mid = head.lastIndexOf(':');
        String kindCode = mid < 0 ? head : head.substring(0, mid);
        String scope    = mid < 0 ? null : head.substring(mid + 1);
        return of(ReviewKind.of(kindCode), scope, period);
    }

    /** 构造 + 全部校验。 */
    public static ReviewKey of(ReviewKind kind, String scope, String period) {
        if (!ReviewKind.PERIOD.matcher(period == null ? "" : period).matches())
            throw new BizException(ResultCode.BAD_REQUEST, "账期必须是 YYYY-MM(月份 01-12):" + period);
        switch (kind.scopeShape()) {
            case NONE -> {
                if (scope != null) throw new BizException(ResultCode.BAD_REQUEST,
                    kind.label() + " 是园区级表,不该带 scope:" + scope);
            }
            case COMPANY -> requireDigits(kind, scope);
            case PHASE -> {
                requireDigits(kind, scope);
                int n = Integer.parseInt(scope);
                if (n < 1 || n > 4) throw new BizException(ResultCode.BAD_REQUEST,
                    "附表10 只有 1..4 四个期区:" + scope);
            }
            case FIXED -> {
                // ⚠ scope == null 必须先挡:List.of(...) 是不可变列表,contains(null) 抛的是 NPE
                // 不是返回 false —— 少这一行,`utilities:2024-02` 这种漏带 scope 的键会 500 而不是 400。
                if (scope == null || !ReviewKind.FIXED_SCOPES.contains(scope))
                    throw new BizException(ResultCode.BAD_REQUEST,
                        kind.label() + " 的 scope 只能是 office / phase3:" + scope);
            }
        }
        return new ReviewKey(kind, scope, period);
    }

    private static void requireDigits(ReviewKind kind, String scope) {
        if (scope == null || scope.isEmpty() || !scope.chars().allMatch(Character::isDigit))
            throw new BizException(ResultCode.BAD_REQUEST, kind.label() + " 必须带数字 scope:" + scope);
    }

    /** 落库主键与对外键串。 */
    public String raw() {
        return scope == null ? kind.code() + ":" + period
                             : kind.code() + ":" + scope + ":" + period;
    }

    /** 错误文案用。公司名/期区名这类中间段由调用方自己补,这里只出「2024-02 月度台账」。 */
    public String human() { return period + " " + kind.label(); }
}
