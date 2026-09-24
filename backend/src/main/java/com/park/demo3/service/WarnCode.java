package com.park.demo3.service;

/**
 * 催缴单告警类别(BILL-NOTICE-WARN-SPEC §1)。
 *
 * <p><b>库里、DTO 里只有常量名,一个汉字都不存。</b>文案全部住在前端
 * {@code frontend/src/utils/billNoticeWarnCopy.ts} 的 WARN_COPY 一张表里 ——
 * 后端一个字都不拼。这是 2026-09-23 定的口径:告警文案写歪了没人发现,
 * 是因为它散在产地、没有一张能被门禁扫的表。
 *
 * <p>两道门禁盯着这个枚举:
 * <ul>
 *   <li>{@code arch/BillNoticeWarnTest} —— 常量清单与写死的 EXPECTED 全等;
 *       每个常量在 {@link BillNoticeService} 里作为产地恰好出现一次。</li>
 *   <li>{@code billNoticeWarnCopy.spec.ts} G2 —— 前端直接读本文件解析常量,
 *       与 WARN_COPY 的键双向全等。加常量不写文案 = 红。</li>
 * </ul>
 *
 * <p><b>payload 必须在同一张单内唯一地指向一个实例</b>(uk_warn 是断路器不是去重器,
 * 见 V126 迁移头注)。后端去重键也只认 {@code (code, payload)},不把 hint 算进去 ——
 * 两边口径一差就是一次整月回滚。
 */
public enum WarnCode {

    /**
     * 有表未归属合同。
     * 判据:{@code "manual".equals(row.status())} —— 绑定解析没给这块表定出合同。
     * 影响:行照出、金额一分不变;contract_id 快照为空、premise 落不上。
     * payload = meterId;hint = 表名。
     */
    W_METER_NO_CONTRACT,

    /**
     * 表绑的合同本月用不上。
     * 两种成因(METER-TIMELINE-SPEC §3.6 之后):① 指错了期(下面的判据);② 钉的是别户的合同(换户后没重钉)——
     * 不采用、自动也定不出,同样是 override_stale,此时 contract_id 快照为空。
     * 判据:{@code "override_stale".equals(row.status())} —— 有人给这块表指认过一份合同,
     * 但那份本月不在租期内,它所在的递增段/续签链上也没有覆盖本月的段,自动归属同样定不出替代。
     * 影响:行照出、金额一分不变;contract_id 快照落的是<b>本月并未生效的那一份</b>,
     * 于是租金行挂 A 段、水电行挂 B 段 —— 事后按合同对账时这几块表的钱对不上任何一期。
     * payload = meterId;hint = 表名(同 W_METER_NO_CONTRACT 的 meterTag 口径)。
     * <p>与 W_METER_NO_CONTRACT 分开:那一类是<b>没人指认过</b>(去挂合同),
     * 这一类是<b>指认过但指错了期</b>(去改绑定或补那一期的合同),动作不同,不共用一句话。
     */
    W_METER_BIND_STALE,

    /**
     * 表本月已在别户锁定的单上收过(METER-TIMELINE-SPEC §5,2026-09-24 补的第十类)。
     * 判据:{@code lockedMeters.contains(m.getId()) && !lockedTenants.contains(tid)} —— 这块表出现在本月
     * 某张已确认 / 已导出(含历史 issued)单的明细里,而当月档案现在把它挂在另一户(tid)名下。
     * 影响:这一户的草稿<b>不出这块表的任何行</b>(电/水/管理费),量只算在已锁的那张单上一次 ——
     * 否则档案改了归属再重生成,新户会把同一块表同一个月再收一遍(J5-1 换户后重算双收)。
     * payload = meterId;hint = 表名(同 W_METER_NO_CONTRACT 的 meterTag 口径)。
     * <p>要让它进这一户:先把那张已锁的单作废,再重新生成本月。
     */
    W_METER_BILLED_ELSEWHERE,

    /**
     * 房号对不上合同。
     * 判据:{@code Pin.undecided()} = {@code tokens>0 && cands>0 && candTokens>0 && hits==0}
     * —— 表上抽得出房号、合同计费行上也抽得出房号,一条都对不上。
     * 它<b>分不出</b>是合同漏录这间房还是这块表挂错了人,所以文案只写测量不写定性。
     * 影响:premise 回退合同级长串,行照出,金额不变。
     * payload = 房号 token;hint = 表名(表名是裸数字时为空串)。
     */
    W_ROOM_MISMATCH,

    /**
     * 合同缺起止日期。
     * 判据:{@code c.getStartDate() == null || c.getEndDate() == null}。
     * 影响:该合同<b>整份</b>不出租金行。
     * payload = contract_no;hint = 空串。
     */
    W_CONTRACT_NO_DATES,

    /**
     * 计费行参数不全。
     * 判据:{@code ContractService.lineMonthly(t, kva) == null} ——
     * 按 bill_mode 该填的字段有空的(按㎡缺面积或单价 / 按间缺单价或间数 / 按 kVA 缺合同容量 / 其余缺固定金额)。
     * 影响:<b>只跳该行</b>,其余租金行照出。
     * payload = 计费行 id;hint = {@code contract_no + " · " + fee_name}。
     * <p>⚠ payload 取行 id 而不是合同号:实测合同 145 有 5 条缺参数计费行、其中两条同名「厂房租金」,
     * 取合同号会撞 uk_warn 导致整月出不了单(2026-09-23 对抗复查)。
     */
    W_TERM_NO_PARAMS,

    /**
     * 免租期读不出来。
     * 判据:rent_free JSON 解析抛异常。
     * 影响:免租扣减按 0 算,本月租金<b>金额偏高</b>。
     * payload = contract_no;hint = 空串。
     */
    W_RENT_FREE_BAD,

    /**
     * 包干行没挂上池。
     * 判据:{@code poolId == null} —— 找不到这笔包干该记到哪个池。
     * 影响:行照出、金额=固定价;这笔钱进不了 alloc_pool_result.allocated_amount,
     * 对应池的未分摊差额会比实际高。
     * payload = feeKey;hint = 空串(中文名由前端 billFeeLabel 出)。
     */
    W_PACKAGE_NO_POOL,

    /**
     * 这个月缺价。
     * 判据:{@code price.resolveHit(key, ym, tid, zone) == null}。
     * 影响:跳该行,该项费用整项不出。
     * payload = 价目键(闭集 7 个:elec_sharp/peak/flat/valley/resident/commercial + water);hint = 空串。
     * <p>payload 不带 ym:三个调用点传的 ym 全是 generate(ym) 的形参,与单头 bill_notice.ym 恒等。
     */
    W_PRICE_MISSING,

    /**
     * 本期合计为负。
     * 判据:{@code total.signum() < 0} —— <b>唯一按单算</b>的一类(写在 groups 循环体内),
     * 其余各类按户算然后拷给该户每张单。
     * 影响:无。负值本身合法。
     * payload = 空串;hint = 空串。前端 {@code drawer:false}:它不是数据缺口而是一个结论,
     * 清除路径不存在,给不出 FPAlertPanel §6-3 要求的可执行动作。
     */
    W_TOTAL_NEGATIVE,
}
