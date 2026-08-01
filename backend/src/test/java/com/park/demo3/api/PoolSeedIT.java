package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

// V65 池种子校验(POOL-ENGINE-SPEC §5):规则/绑定/links/cfg 月行与 extract_pool_expected.py 输出全等。
// 本 IT 只读校验种子月 2024-02 配置(数据由迁移落库,非 2099 槽写入),期望数字来自脚本运行输出
// (pool-expected-2024-02.json counts 节)。表名映射必须逐条命中:零绑定规则仅允许白名单 4 条。
// ⚠V69 断言口径改注:池名 V69 起由定位自动生成、并将由并行刀 B 的 V70 位置化改名(「A4西侧走廊灯」→
// 「一期A座·四楼西侧·走廊灯」),故本 IT 一律**按 sort_no 定位规则**(=原册行序,改名不动),不再按 name 查。
// 注释里保留 2024-02 原册名只为可读。
class PoolSeedIT extends AbstractMysqlIT {

    @Autowired JdbcTemplate jdbc;

    // extract_pool_expected.py 输出:规则 90(p1 67/p2 21/dorm 2)|绑定 113|links 4|rule月参 46
    // V81(§H4.2e)补回原册 4 个无表行(r12 联塑精铟 / r47-49 C座一楼西侧三户)→ p1 67+4=71,绑定数不变
    // V84(刀I §I1)把原册块1 的「园区公共电」池拆成 r5/r6/r7/r9 四条独立行 → p1 71−1+4=74;
    //   四条各绑原池的那 1 块表(绑定数 113 不变);fold_qty 招商中心→园区公共电 随池删 → links 4−1=3
    private static final int RULES_P1 = 74, RULES_P2 = 21, RULES_DORM = 2;
    private static final int BINDINGS = 113, LINKS = 3, RULE_CFG_ROWS = 46;
    // 合法零绑定(sort_no):90 宿舍绿化水(manual_qty 无表) + 40/41/50 一期园区电无此表的 3 条幽灵户对户行
    //   + 91–94 V81 的 4 条 method=manual 无表行(原册就没有电表,零绑定是它们的定义)
    private static final Set<Integer> NO_METER_OK = Set.of(90, 40, 41, 50, 91, 92, 93, 94);

    @Test
    void ruleCounts_byZone() {
        assertThat(jdbc.queryForObject("select count(*) from alloc_rule where zone='p1'", Integer.class)).isEqualTo(RULES_P1);
        assertThat(jdbc.queryForObject("select count(*) from alloc_rule where zone='p2'", Integer.class)).isEqualTo(RULES_P2);
        assertThat(jdbc.queryForObject("select count(*) from alloc_rule where zone='dorm'", Integer.class)).isEqualTo(RULES_DORM);
    }

    @Test
    void meterBindings_zeroLoss() {
        assertThat(jdbc.queryForObject("select count(*) from alloc_rule_meter", Integer.class)).isEqualTo(BINDINGS);
        // 表名映射逐条命中:零绑定规则只允许白名单(其余任何一条掉绑定即 fail)
        List<Integer> zero = jdbc.queryForList(
                "select r.sort_no from alloc_rule r left join alloc_rule_meter m on m.rule_id=r.id"
                        + " where m.id is null", Integer.class);
        assertThat(zero).hasSize(NO_METER_OK.size());
        assertThat(Set.copyOf(zero)).isEqualTo(NO_METER_OK);
    }

    @Test
    void links_threeFolds_noFoldQty() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "select s.sort_no src, d.sort_no dst, l.link_type t from alloc_rule_link l"
                        + " join alloc_rule s on s.id=l.src_rule_id join alloc_rule d on d.id=l.dst_rule_id");
        assertThat(rows).hasSize(LINKS);
        Set<String> triples = rows.stream()
                .map(r -> r.get("src") + "->" + r.get("dst") + ":" + r.get("t")).collect(Collectors.toSet());
        // sort_no=原册行序(V69 起改按行序断言,改名不动);注释为 2024-02 原册名
        assertThat(triples).containsExactlyInAnyOrder(
                "20->8:fold_price",     // 六车间广告字灯（消防分表）→园区消防设施:V46=0.01+V113
                "14->12:fold_price",    // 五车间广告字灯（消防分表）→四车间绿化水泵:V65=0.001+V77
                "10->11:fold_price");   // 四车间电梯+低压电房照明→广联分摊:V64=层价+V58 折入
        // V84:全库不再有 fold_qty —— 招商中心那条是唯一的一条,它让 152.06 度在块1 合计里被计了两遍
        assertThat(jdbc.queryForObject(
                "select count(*) from alloc_rule_link where link_type='fold_qty'", Integer.class)).isZero();
    }

    // V84(刀I §I1/§I5):原册块1 r5–r9 五行各自独立,共用的只是 AG5:AG9 合并备注「计入园区损耗分摊」
    @Test
    void v84_parkLossRows_splitToFiveRows() {
        // 五条规则 = 原册 r5/r6/r7/r8/r9,且不再有 method='loss' 的合并池
        List<Map<String, Object>> rows = jdbc.queryForList(
                "select book_key, book_row, method, floor_label, book_block from alloc_rule"
                        + " where zone='p1' and fee_key='park_loss_pool' order by book_row");
        assertThat(rows.stream().map(r -> r.get("book_row") + ":" + r.get("book_key")).toList())
                .containsExactly("5:地下车库东侧照明", "6:地下车库西侧照明", "7:A1大堂",
                        "8:招商中心电1", "9:生活加压泵");
        assertThat(rows).allSatisfy(r -> assertThat(r.get("book_block")).isEqualTo("A座及园区公共表合计："));
        assertThat(rows.stream().map(r -> r.get("method")).collect(Collectors.toSet()))
                .containsExactly("direct");
        // 楼层逐行取原册 C 列(r7 是一楼,不是负一层)——刀前四行都取池级「负一层」,错三行
        assertThat(rows.stream().map(r -> r.get("floor_label")).toList())
                .containsExactly("负一层", "负一层", "一楼", "四楼", "负一层");
        // 拆出的 4 条各绑 1 块表(原册 G 列电表编码见 V84 注释;种子库的表无 code,故按名断言)
        List<Map<String, Object>> binds = jdbc.queryForList(
                "select r.book_key k, m.name n, rm.sign s from alloc_rule r"
                        + " join alloc_rule_meter rm on rm.rule_id=r.id join meter m on m.id=rm.meter_id"
                        + " where r.zone='p1' and r.fee_key='park_loss_pool' and r.book_key<>'招商中心电1'");
        assertThat(binds.stream().map(b -> b.get("k") + "=" + b.get("n") + ":" + b.get("s"))
                .collect(Collectors.toSet()))
                .containsExactlyInAnyOrder("地下车库东侧照明=地下车库东侧照明:1", "地下车库西侧照明=地下车库西侧照明:1",
                        "A1大堂=A1大堂:1", "生活加压泵=生活加压泵:1");
        // §I5 临时回退:『永龙反向有功』回到 tenant,等用户在 A/B/C 三选项里拍板(选项与后果见 V84 注释)。
        // ⚠该表只存在于真实数据库(dev/生产是导入进去的),迁移种子库里没有这一行 → 本断言在种子库上是空集
        // 通过,真正的证据在 dev 库;它在这里的作用是:哪天有人在真实数据库上把它改回 register,这条会红。
        assertThat(jdbc.queryForList(
                "select ownership from meter where kind='elec' and zone='p2' and name='永龙反向有功'",
                String.class)).doesNotContain("register");
    }

    @Test
    void spotCheck_fiveRules() {
        // 1) 五车间消防(sort_no 13):floor 6.5 层,+主表 -广告字分表
        Map<String, Object> r1 = jdbc.queryForMap(
                "select method, coefficient, round_scale, base_key from alloc_rule where sort_no=13");
        assertThat(r1.get("method")).isEqualTo("floor");
        assertThat((BigDecimal) r1.get("coefficient")).isEqualByComparingTo("6.5");
        assertThat(r1.get("base_key")).isNull();
        List<Map<String, Object>> b1 = jdbc.queryForList(
                "select m.name, rm.sign from alloc_rule_meter rm join meter m on m.id=rm.meter_id"
                        + " join alloc_rule r on r.id=rm.rule_id where r.sort_no=13");
        assertThat(b1.stream().map(x -> x.get("name") + ":" + x.get("sign")).collect(Collectors.toSet()))
                .containsExactlyInAnyOrder("五车间消防:1", "五车间装饰灯新表:-1");

        // 2) 园区消防设施(sort_no 8;V67 前名:园区生活水泵、消防控制室):area + area_base,ROUND 2 位(V46)
        Map<String, Object> r2 = jdbc.queryForMap(
                "select method, base_key, round_scale, coefficient from alloc_rule where sort_no=8");
        assertThat(r2.get("method")).isEqualTo("area");
        assertThat(r2.get("base_key")).isEqualTo("area_base");
        assertThat(r2.get("round_scale")).isEqualTo(2);

        // 3) B东侧货梯(sort_no 49):floor 3 层,双表合并,加170度走 rule 月行
        Map<String, Object> r3 = jdbc.queryForMap(
                "select id, method, coefficient from alloc_rule where sort_no=49");
        assertThat(r3.get("method")).isEqualTo("floor");
        assertThat((BigDecimal) r3.get("coefficient")).isEqualByComparingTo("3");
        assertThat(jdbc.queryForList(
                "select m.name from alloc_rule_meter rm join meter m on m.id=rm.meter_id where rm.rule_id=?",
                String.class, r3.get("id")))
                .containsExactlyInAnyOrder("B东侧货梯", "B西侧货梯");
        assertThat(jdbc.queryForObject(
                "select cfg_value from alloc_cfg where scope=concat('rule:', ?) and cfg_key='extra_qty' and acct_month='2024-02'",
                BigDecimal.class, r3.get("id"))).isEqualByComparingTo("170");

        // 4) A东侧货梯(sort_no 39,A座电梯池):area + elevator_area_base,四梯合并
        Map<String, Object> r4 = jdbc.queryForMap(
                "select id, method, base_key from alloc_rule where sort_no=39");
        assertThat(r4.get("method")).isEqualTo("area");
        assertThat(r4.get("base_key")).isEqualTo("elevator_area_base");
        assertThat(jdbc.queryForList(
                "select m.name from alloc_rule_meter rm join meter m on m.id=rm.meter_id where rm.rule_id=?",
                String.class, r4.get("id")))
                .containsExactlyInAnyOrder("A东侧货梯", "A西侧货梯", "A客梯1", "A客梯2");

        // 5) 宿舍路灯公摊(sort_no 89):5 块表 + 化石价 1.13156875 月行 + dorm 面积基数键
        Map<String, Object> r5 = jdbc.queryForMap(
                "select id, method, base_key from alloc_rule where sort_no=89");
        assertThat(r5.get("base_key")).isEqualTo("lamp_area_base");
        assertThat(jdbc.queryForList(
                "select m.name from alloc_rule_meter rm join meter m on m.id=rm.meter_id where rm.rule_id=?",
                String.class, r5.get("id")))
                .containsExactlyInAnyOrder("宿舍路灯", "三四路灯", "一二路灯2", "一栋电梯", "四栋电梯");
        assertThat(jdbc.queryForObject(
                "select cfg_value from alloc_cfg where scope=concat('rule:', ?) and cfg_key='price_override' and acct_month='2024-02'",
                BigDecimal.class, r5.get("id"))).isEqualByComparingTo("1.13156875");
    }

    // V66 损耗组结构修正:A座组C只取A座总电/G座变体2陈列/册Σ剔除表5块/招商中心电1、2挂A座share
    @Test
    void v66_lossStructureFix() {
        Integer aId = jdbc.queryForObject("select id from building where name='一期 A座'", Integer.class);
        Integer mA = jdbc.queryForObject(
                "select id from meter where kind='elec' and zone='p1' and name='A座总电'", Integer.class);
        assertThat(jdbc.queryForObject(
                "select cfg_value from alloc_cfg where scope=concat('building:', ?) and cfg_key='loss_c_meter' and acct_month=''",
                BigDecimal.class, aId).intValue()).isEqualTo(mA);
        assertThat(jdbc.queryForObject(
                "select c.cfg_value from alloc_cfg c join building b on c.scope=concat('building:',b.id)"
                        + " where b.name='一期 G座' and c.cfg_key='loss_variant' and c.acct_month=''",
                BigDecimal.class).intValue()).isEqualTo(2);
        List<String> excluded = jdbc.queryForList(
                "select m.name from alloc_cfg c join meter m on c.scope=concat('meter:',m.id)"
                        + " where c.cfg_key='loss_exclude' and c.cfg_value<>0", String.class);
        assertThat(excluded).containsExactlyInAnyOrder(
                "四车间工地", "力美C201电", "五车间装饰灯新表", "火炬园广告字电", "六车间广告字新表");
        List<Map<String, Object>> zs = jdbc.queryForList(
                "select building_id, ownership from meter where kind='elec' and zone='p1'"
                        + " and name in ('招商中心电1','招商中心电2')");
        assertThat(zs).hasSize(2);
        for (Map<String, Object> m : zs) {
            assertThat(m.get("building_id")).isEqualTo(aId);
            assertThat(m.get("ownership")).isEqualTo("share");
        }
    }

    @Test
    void cfgRows_ruleMonthly_lossParams_supplyMeter() {
        // rule:{id} 2024-02 月行全量(层数T/AA基数/加度/manual_qty/price_override/std_add)
        assertThat(jdbc.queryForObject(
                "select count(*) from alloc_cfg where scope like 'rule:%' and acct_month='2024-02'", Integer.class))
                .isEqualTo(RULE_CFG_ROWS);
        // 广联分摊(sort_no 11) std_add=100
        assertThat(jdbc.queryForObject(
                "select c.cfg_value from alloc_cfg c join alloc_rule r on c.scope=concat('rule:',r.id)"
                        + " where r.sort_no=11 and c.cfg_key='std_add' and c.acct_month='2024-02'",
                BigDecimal.class)).isEqualByComparingTo("100");
        // 一期 A座:g_adj=-1500(月行)+ H加点 0.003 + 独立链路排除对账(默认行)
        Integer aId = jdbc.queryForObject("select id from building where name='一期 A座'", Integer.class);
        assertThat(jdbc.queryForObject(
                "select cfg_value from alloc_cfg where scope=concat('building:', ?) and cfg_key='loss_g_adj' and acct_month='2024-02'",
                BigDecimal.class, aId)).isEqualByComparingTo("-1500");
        assertThat(jdbc.queryForObject(
                "select cfg_value from alloc_cfg where scope=concat('building:', ?) and cfg_key='loss_recon' and acct_month=''",
                BigDecimal.class, aId)).isEqualByComparingTo("0");
        // 二期 二/四车间 loss_head → 三车间(合并计损组);三车间 H=-2500
        Integer c3 = jdbc.queryForObject("select id from building where name='二期 三车间'", Integer.class);
        for (String b : List.of("二期 二车间", "二期 四车间")) {
            assertThat(jdbc.queryForObject(
                    "select c.cfg_value from alloc_cfg c join building bd on c.scope=concat('building:',bd.id)"
                            + " where bd.name=? and c.cfg_key='loss_head' and c.acct_month=''",
                    BigDecimal.class, b).intValue()).isEqualTo(c3);
        }
        assertThat(jdbc.queryForObject(
                "select cfg_value from alloc_cfg where scope=concat('building:', ?) and cfg_key='loss_adj_qty' and acct_month='2024-02'",
                BigDecimal.class, c3)).isEqualByComparingTo("-2500");
        // 供电局对账总表:p1=B-G座总电 / p2=二期总电
        for (String[] z : List.of(new String[]{"p1", "B-G座总电"}, new String[]{"p2", "二期总电"})) {
            Integer mid = jdbc.queryForObject(
                    "select id from meter where kind='elec' and zone=? and name=?", Integer.class, z[0], z[1]);
            assertThat(jdbc.queryForObject(
                    "select cfg_value from alloc_cfg where scope=? and cfg_key='loss_supply_meter' and acct_month=''",
                    BigDecimal.class, z[0]).intValue()).isEqualTo(mid);
        }
    }
}
