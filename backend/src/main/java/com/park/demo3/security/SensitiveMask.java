package com.park.demo3.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Arrays;
import java.util.Collection;
import java.util.function.UnaryOperator;
import java.util.stream.Collectors;

/**
 * 敏感字段的服务端打码(RBAC-SPEC §11 规则 5)。调用者没有该字段所属模块的查看点时,回包里给打码值。
 *
 * **在服务端做,前端不靠隐藏**:读规则为了跨模块能用放宽了(合同屏、催缴单、分析屏都要读租户和公司列表),
 * 放宽的代价由这里兜 —— 联系人电话、姓名归「租户管理 · 查看」,收款账号归「催缴单 · 查看」,没有的人拿到的是掩码。
 *
 * 判定只看本人角色给的权限点(含编辑隐含的查看),**不看提权**:查看点不可提权(规则 6)。
 */
public final class SensitiveMask {
    private SensitiveMask() {}

    /** 当前请求的账号是否持有该点。没有登录上下文(单测、定时任务)= 不持有 → 打码,宁紧勿松。 */
    public static boolean holds(String perm) {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        if (a == null) return false;
        for (GrantedAuthority g : a.getAuthorities()) if (perm.equals(g.getAuthority())) return true;
        return false;
    }

    /** 当前请求的账号是否持有其中任一点。 */
    public static boolean holdsAny(Collection<String> perms) {
        for (String p : perms) if (holds(p)) return true;
        return false;
    }

    /**
     * 电话:≥11 位前 3 + **** + 后 4(138****5678);8–10 位只留后 4(****6666);更短给 ****;null 与空串原样。
     * 7–8 位的座机套「前 3 后 4」等于全露(1234567 → 123****4567),所以短号只留后 4。
     */
    public static String phone(String s) {
        if (s == null || s.isEmpty()) return s;
        if (s.length() >= 11) return s.substring(0, 3) + "****" + s.substring(s.length() - 4);
        return s.length() >= 8 ? "****" + s.substring(s.length() - 4) : "****";
    }

    /** 租户别名(V86,逗号 / 中文逗号分隔,里面是老板个人姓名):逐项按 {@link #name} 打码,统一用半角逗号连。 */
    public static String aliases(String s) {
        if (s == null || s.isEmpty()) return s;
        return Arrays.stream(s.split("[,，]", -1)).map(a -> name(a.trim())).collect(Collectors.joining(","));
    }

    /** 账号:只留后 4 位(****5678);不超过 4 位给 ****;null 与空串原样。 */
    public static String account(String s) {
        if (s == null || s.isEmpty()) return s;
        return s.length() > 4 ? "****" + s.substring(s.length() - 4) : "****";
    }

    /** 姓名:只留第一个字,其余每个字换成 *(王**);null 与空串原样。 */
    public static String name(String s) {
        if (s == null || s.isEmpty()) return s;
        int first = s.offsetByCodePoints(0, 1);
        return s.substring(0, first) + "*".repeat(s.codePointCount(first, s.length()));
    }

    /**
     * 写回守卫:提交上来的值正是现值的掩码 → 当作没改,保留现值。
     * 靠提权拿到编辑权的人(查看不可提权)表单里回填的是掩码,不拦的话一保存就把真号码冲成星号。
     */
    public static String keepIfMasked(String incoming, String current, UnaryOperator<String> mask) {
        return incoming != null && current != null && incoming.equals(mask.apply(current)) ? current : incoming;
    }
}
