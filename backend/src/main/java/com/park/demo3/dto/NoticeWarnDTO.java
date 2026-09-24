package com.park.demo3.dto;

/**
 * 催缴单告警条目(BILL-NOTICE-WARN-SPEC §3.1)。
 *
 * <p><b>三列分开传,不拼串。</b>2026-09-23 的「场地未定:544.00」事故就是拼串拼出来的 ——
 * 标签说的是场地、塞进去的是表名,而前端拿到的只是一坨字符串,没有任何东西能发现口径不对。
 * 分列之后 payload/hint 是实例数据、文案由前端 WARN_COPY 按 code 出,两边职责分开。
 *
 * @param code    WarnCode 常量名;一个汉字都没有
 * @param payload 实例数据业务键(房号 / 价目键 / 计费行 id / 表 id / 费项键);无实例数据的类是空串
 * @param hint    第二段实例数据(表名 / 「合同号 · 费项名」);无则空串
 */
public record NoticeWarnDTO(String code, String payload, String hint) {}
