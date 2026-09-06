package com.park.demo3.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 「这个写方法**故意**不挂审核守卫」的白名单(SIDEBAR-UX-REDESIGN §7.4)。
 *
 * 为什么白名单是产品代码里的注解而不是测试里的常量数组:照抄 PermissionCoverageTest 复用
 * SecurityPaths.PERMIT_ALL 的理由 —— 豁免必须是**显眼、可 review、跟着代码走**的动作。
 * 写在测试里的名单,改代码的人看不见,于是「漏挂」和「故意豁免」长得一模一样。
 *
 * reason 必填且不许空串,ReviewGuardCoverageTest 会断言这一点。
 * 理由要写实(为什么这个方法不该进审核),不是写「不需要」。
 *
 * ⚠ 这是全仓第一个自定义注解(此前 backend/src 全树 `@interface` 零命中)。别顺手再造第二个。
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface NoReviewGuard {
    String reason();
}
