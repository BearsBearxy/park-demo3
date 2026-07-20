package db.migration;

import com.park.demo3.service.ReconService;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;

/**
 * V35 — bill_pay_company 默认值一次性种子(BILLS-SPEC §5)。
 * 列对映射单一事实源 = ReconService.RECON_FEES(台账列 ↔ 附表10 colId),禁另抄一份:
 * 每租户 × 每台账费用列,取该租户该列历史金额绝对值合计最大的记账公司写为默认收款公司
 * (并列时按 company_id 升序取,稳定确定);仅台账↔附表10 配对列种默认,
 * 台账独有列(无 s10 colId 不可存)与 s10 独有列(无台账事实可推)均不种,前端显示「未设置」。
 */
public class V35__Bill_pay_company_seed extends BaseJavaMigration {
    @Override
    public void migrate(Context ctx) throws Exception {
        Connection c = ctx.getConnection();
        try (PreparedStatement ins = c.prepareStatement(
                "INSERT INTO bill_pay_company (tenant_id, fee_key, company_id) VALUES (?, ?, ?)")) {
            for (ReconService.Fee f : ReconService.RECON_FEES) {
                if (f.lGet() == null || f.s10Key() == null) continue;   // 仅台账↔s10 配对列
                // 台账字段名(camelCase)→列名(snake_case),与 map-underscore-to-camel-case 同一规则
                String col = camelToSnake(f.key());
                String sql = "SELECT tenant_id, company_id, SUM(ABS(" + col + ")) AS t FROM monthly_ledger "
                           + "GROUP BY tenant_id, company_id HAVING t > 0 "
                           + "ORDER BY tenant_id, t DESC, company_id";
                int lastTenant = -1;
                try (Statement s = c.createStatement(); ResultSet rs = s.executeQuery(sql)) {
                    while (rs.next()) {
                        int tenantId = rs.getInt(1);
                        if (tenantId == lastTenant) continue;           // 每租户首行 = 绝对值合计最大公司
                        lastTenant = tenantId;
                        ins.setInt(1, tenantId);
                        ins.setString(2, f.s10Key());
                        ins.setInt(3, rs.getInt(2));
                        ins.addBatch();
                    }
                }
            }
            ins.executeBatch();
        }
    }

    private static String camelToSnake(String s) {
        return s.replaceAll("([a-z0-9])([A-Z])", "$1_$2").toLowerCase();
    }
}
