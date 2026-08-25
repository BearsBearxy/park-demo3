package com.park.demo3.service;

import com.park.demo3.service.TemplateDef.Col;
import com.park.demo3.service.TemplateDef.Def;
import com.park.demo3.service.TemplateDef.Group;

import java.util.List;

/**
 * 部署初始模板种子(BOOK-WORKBENCH-SPEC §8/§9)。
 * 内容 = 现行 lgColumns / s10 layout.ts 的 1:1 迁移(含 LEDGER_ALIASES 与 s10 别名),
 * 迁入数据后这里就是「部署初始值」——换园区只换种子,代码不再写死任何列中文名(§9)。
 * 追加:shopRent 别名「宿舍区租金」(2024-01 源册 29 万丢列事故词条,SPEC §4 的起因)。
 * 组名约定:电费/水费组名存 'MON' 占位(=layout.ts 现约定),前端 toLedgerColumns/S10Table 替换为「N月」。
 */
final class BookTemplates {
    private BookTemplates() {}

    private static Col std(String id, String label, String slot, int w, String... aliases) {
        return new Col(id, true, label, List.of(aliases), slot, false, w);
    }

    /** 台账标准模板(21 列,分组与列序 = lgColumns 现状)。 */
    static String ledgerStandard() {
        Def d = new Def(List.of(
            new Group("g_rent", "租金", List.of(
                std("factoryRent", "厂房租金", "rent", 96),
                std("factoryMgmtFee", "厂房企业管理服务费", "mgmt", 130),
                std("shopRent", "商铺、宿舍租金", "rent", 112, "商铺租金", "宿舍区租金"),
                std("dormRent", "宿舍租金", "rent", 88),
                std("dormFacilitiesFee", "宿舍配套费", "misc", 96, "宿舍配套设施费"),
                std("shopMgmtFee", "商铺企业管理服务费", "mgmt", 130))),
            new Group("g_infra", "基础设施维护费", List.of(
                std("factoryInfraMaint", "厂房基础设施维护费", "infra", 130),
                std("shopInfraMaint", "商铺、宿舍基础设施维护费", "infra", 152, "商铺基础设施维护费"),
                std("dormInfraMaint", "宿舍基础设施维护费", "infra", 130))),
            new Group("g_office", "办公室、厂房费用", List.of(
                std("elevatorMaint", "电梯维护费", "common", 96),
                std("transformerMaint", "变压器维护费", "common", 104),
                std("landUseTax", "土地使用税", "misc", 96),
                std("networkFee", "网络通讯费", "misc", 96),
                std("accessCtrlMaint", "门禁设施维护费", "common", 112),
                std("officeOtherFee", "其他费用", "misc", 88))),
            new Group("g_dorm", "宿舍费用", List.of(
                std("dormOtherFee", "宿舍其他费用", "misc", 104))),
            new Group("g_elec", "MON电费", List.of(
                std("basicElectricity", "基本用电费", "elec", 96),
                std("standardElectricity", "基准电费", "elec", 88),
                std("electricityMaint", "电维护费", "elec", 88))),
            new Group("g_water", "MON水费", List.of(
                std("standardWater", "基准水费", "water", 88),
                std("waterMaint", "水维护费", "water", 88)))));
        return TemplateDef.write(d);
    }

    /** 附表10 office 版面(一期/宿舍,25 列 = layout.ts OFFICE 1:1)。 */
    static String s10Office() {
        Def d = new Def(List.of(
            new Group("g_a", "A座租金", List.of(
                std("officeRent", "办公室租金", "rent", 104),
                std("officeMgmtFee", "办公室企业管理服务费", "mgmt", 140))),
            new Group("g_bg", "B-G座租金", List.of(
                std("factoryRent", "厂房租金", "rent", 96),
                std("factoryMgmtFee", "厂房企业管理服务费", "mgmt", 130))),
            new Group("g_land", null, List.of(
                std("landRent", "空地租金", "rent", 96))),
            new Group("g_dormrent", "宿舍区租金", List.of(
                std("shopRent", "商铺租金", "rent", 96),
                std("dormRent", "宿舍租金", "rent", 88),
                std("dormFacilityFee", "宿舍配套设施费", "misc", 112),
                std("shopMgmtFee", "商铺企业管理服务费", "mgmt", 130))),
            new Group("g_infra", "基础设施维护费", List.of(
                std("infraOffice", "办公室基础设施维护费", "infra", 140),
                std("infraFactory", "厂房基础设施维护费", "infra", 130),
                std("infraShop", "商铺基础设施维护费", "infra", 130),
                std("infraDorm", "宿舍基础设施维护费", "infra", 130))),
            new Group("g_office", "办公室、厂房费用", List.of(
                std("elevatorMaint", "电梯维护费", "common", 96),
                std("transformerMaint", "变压器维护费", "common", 104),
                std("landUseTax", "土地使用税", "misc", 96))),
            new Group("g_dorm", "宿舍费用", List.of(
                std("networkFee", "网络通讯费", "misc", 96),
                std("accessMaint", "门禁设施维护费", "common", 112))),
            new Group("g_other", null, List.of(
                std("otherFee", "其他费用", "misc", 88))),
            new Group("g_elec", "MON电费", List.of(
                std("elecBasic", "基本用电费", "elec", 96),
                std("elecStd", "基准电费", "elec", 88),
                std("elecMaint", "电维护费", "elec", 88))),
            new Group("g_water", "MON水费", List.of(
                std("waterStd", "基准水费", "water", 88),
                std("waterMaint", "水维护费", "water", 88))),
            new Group("g_guarantee", "保障房", List.of(
                std("guaranteeRent", "一栋保障房租金", "rent", 112)))));
        return TemplateDef.write(d);
    }

    /** 附表10 factory 版面(二期/三期,20 列 = layout.ts FACTORY 1:1,含三期措辞别名)。 */
    static String s10Factory() {
        Def d = new Def(List.of(
            new Group("g_rent", "租金", List.of(
                std("factoryRent", "厂房租金", "rent", 96),
                std("factoryMgmtFee", "企业管理服务费", "mgmt", 120, "厂房企业管理服务费"),
                std("shopRent", "商铺租金", "rent", 96),
                std("shopMgmtFee", "商铺企业管理服务费", "mgmt", 130),
                std("dormRent", "宿舍租金", "rent", 88),
                std("dormFacilityFee", "宿舍配套设施费", "misc", 112))),
            new Group("g_infra", "基础设施维护费", List.of(
                std("infraFactory", "厂房基础设施维护费", "infra", 130),
                std("infraShop", "商铺基础设施维护费", "infra", 130),
                std("infraDorm", "宿舍基础设施维护费", "infra", 130))),
            new Group("g_factory", "厂房费用", List.of(
                std("elevatorMaint", "电梯维护费", "common", 96),
                std("transformerMaint", "变压器维护费", "common", 104),
                std("landUseTax", "土地使用税、房产税", "misc", 120))),
            new Group("g_dorm", "宿舍费用", List.of(
                std("networkFee", "网络通讯费", "misc", 96),
                std("accessMaint", "门禁设施维护费", "common", 112))),
            new Group("g_other", null, List.of(
                std("otherFee", "其他费用", "misc", 88))),
            new Group("g_elec", "MON电费", List.of(
                std("elecBasic", "基本用电费", "elec", 96),
                std("elecStd", "基准电费", "elec", 88),
                std("elecMaint", "电维护费", "elec", 88))),
            new Group("g_water", "MON水费", List.of(
                std("waterStd", "基准水费", "water", 88),
                std("waterMaint", "水维护费", "water", 88)))));
        return TemplateDef.write(d);
    }
}
