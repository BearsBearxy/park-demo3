package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 写入类 IT 统一 @Transactional 回滚:共享单例容器,不污染种子(SeedIT 精确断言 unit=126)
@AutoConfigureMockMvc
@Transactional
class BuildingWriteApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login")
                .contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
    }

    @Test
    void create_withAutoUnits_fieldsAndUnitAreasMatch() throws Exception {
        // 3 层 × 4 单元 = 12 个,可租 2800 → 均摊 233.33,末个补差 233.37,合计精确 2800
        String body = mvc.perform(post("/api/buildings")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"name\":\"IT写入-自动单元栋\",\"phase\":2,\"floorCount\":3,\"perFloor\":4," +
                        "\"totalArea\":3000,\"rentableArea\":2800,\"remark\":\"IT\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.name").value("IT写入-自动单元栋"))
                .andExpect(jsonPath("$.data.phase").value(2))
                .andExpect(jsonPath("$.data.floorCount").value(3))
                .andExpect(jsonPath("$.data.status").value(1))
                .andExpect(jsonPath("$.data.unitCount").value(12))
                .andExpect(jsonPath("$.data.vacantCount").value(12))
                .andReturn().getResponse().getContentAsString();
        int id = JsonPath.read(body, "$.data.id");

        String detail = mvc.perform(get("/api/buildings/" + id)
                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andReturn().getResponse().getContentAsString();
        List<Object> areas = JsonPath.read(detail, "$.data.units[*].area");
        assertThat(areas).hasSize(12); // floorCount × perFloor
        BigDecimal sum = areas.stream().map(a -> new BigDecimal(a.toString()))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        assertThat(sum).isEqualByComparingTo(new BigDecimal("2800"));
        // unit_no 沿用 seed 惯例 floor*100+seq
        List<String> unitNos = JsonPath.read(detail, "$.data.units[*].unitNo");
        assertThat(unitNos).contains("101", "104", "201", "301", "304");
    }

    @Test
    void create_duplicateName_returns409InBody() throws Exception {
        String json = "{\"name\":\"IT写入-重名栋\",\"phase\":1,\"floorCount\":2,\"perFloor\":0," +
                "\"totalArea\":1000,\"rentableArea\":900}";
        mvc.perform(post("/api/buildings")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json").content(json))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0));
        // 业务错口径: HTTP 200 + body.code=409
        mvc.perform(post("/api/buildings")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json").content(json))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(409));
    }

    @Test
    void create_zeroFloorCount_returnsHttp400() throws Exception {
        // 校验错口径: HTTP 400 + body.code=400
        mvc.perform(post("/api/buildings")
                .header("Authorization", "Bearer " + token)
                .contentType("application/json")
                .content("{\"name\":\"IT写入-校验栋\",\"phase\":1,\"floorCount\":0,\"perFloor\":0," +
                        "\"totalArea\":1000,\"rentableArea\":900}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
    }
}
