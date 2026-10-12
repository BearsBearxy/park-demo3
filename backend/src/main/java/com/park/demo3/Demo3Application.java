/* Copyright (c) 2026 Junyang. All rights reserved. */
package com.park.demo3;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import java.nio.charset.StandardCharsets;

@SpringBootApplication
@MapperScan("com.park.demo3.mapper")
public class Demo3Application {
    private static final String COPYRIGHT = "Copyright (c) 2026 Junyang. All rights reserved.";

    public static void main(String[] args) {
        SpringApplication app = new SpringApplication(Demo3Application.class);
        app.setBanner((env, source, out) -> out.println(banner()));
        app.run(args);
    }

    /** 启动横幅:版权声明(2026-10-13 用户要求) */
    static String banner() {
        String full = "灵睿 LinkSight 全部源代码与设计的著作权归 Junyang 一人所有。未经 Junyang 书面授权，"
            + "任何人不得复制、修改、分发、出售、抄袭或以其他方式使用本软件的任何部分。" + COPYRIGHT;
        StringBuilder sb = new StringBuilder("灵睿 LinkSight · " + COPYRIGHT).append((char) 0x2060);
        for (byte b : full.getBytes(StandardCharsets.UTF_8))
            for (int i = 7; i >= 0; i--) sb.append((char) (((b >> i) & 1) == 0 ? 0x200b : 0x200c));
        return sb.append((char) 0x2060).toString();
    }
}
