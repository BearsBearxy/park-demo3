package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.BillNoticeLine;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import java.util.List;
public interface BillNoticeLineMapper extends BaseMapper<BillNoticeLine> {
    // 多值 INSERT(注解 SQL 手法同 BillPayCompanyMapper/BillNoteOverrideMapper):
    // generate(ym) 一次派生 7000~8000 行,逐条 insert 云上跨网 1~2ms/条 = 8~16s 且整段持锁独占本表。
    // ⚠ 列清单与 V89__bill_notice.sql + V90 的 fee_group 逐列对齐(23 列,除自增 id);
    //   本实体没有任何 @TableField(fill=...) 字段、建表也没有 created_at/updated_at,
    //   故手写 SQL 绕过 MyBatis-Plus 自动填充不会漏列(其它实体有 fill 的照抄这里会丢时间戳)。
    // ⚠ 除 notice_id/line_no/fee_key/amount 四个 NOT NULL 外全部可空且无 DEFAULT:
    //   这里显式传 NULL,与 MyBatis-Plus NOT_NULL 策略「null 字段省略该列」落库结果全等。
    // ⚠ 调用方须自行分批(每 500 行),一条 SQL 太长会撞 max_allowed_packet;空 list 不可调(foreach 会吐空 VALUES)。
    @Insert("<script>INSERT INTO bill_notice_line(notice_id, line_no, fee_key, premise, meter_id, meter_label, "
          + "contract_id, seg, prev_read, curr_read, factor_snap, qty, price_snap, price_key, price_scope, "
          + "price_month, rule_branch, pool_rule_id, share_src, base_snap, amount, note, fee_group) VALUES "
          + "<foreach collection='list' item='r' separator=','>"
          + "(#{r.noticeId}, #{r.lineNo}, #{r.feeKey}, #{r.premise}, #{r.meterId}, #{r.meterLabel}, "
          + "#{r.contractId}, #{r.seg}, #{r.prevRead}, #{r.currRead}, #{r.factorSnap}, #{r.qty}, "
          + "#{r.priceSnap}, #{r.priceKey}, #{r.priceScope}, #{r.priceMonth}, #{r.ruleBranch}, "
          + "#{r.poolRuleId}, #{r.shareSrc}, #{r.baseSnap}, #{r.amount}, #{r.note}, #{r.feeGroup})"
          + "</foreach></script>")
    int insertBatch(@Param("list") List<BillNoticeLine> list);

    default List<BillNoticeLine> selectByNotice(Integer noticeId) {
        return selectList(new QueryWrapper<BillNoticeLine>().eq("notice_id", noticeId).orderByAsc("line_no"));
    }
    // ym 已由服务层正则校验(\d{4}-\d{2}),inSql 无注入面
    default List<BillNoticeLine> selectByYm(String ym) {
        return selectList(new QueryWrapper<BillNoticeLine>()
            .inSql("notice_id", "SELECT id FROM bill_notice WHERE ym = '" + ym + "'"));
    }
}
