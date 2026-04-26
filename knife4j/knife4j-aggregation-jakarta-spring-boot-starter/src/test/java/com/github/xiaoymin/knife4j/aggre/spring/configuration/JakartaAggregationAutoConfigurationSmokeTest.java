/*
 * Copyright © 2017-2023 Knife4j(xiaoymin@foxmail.com)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


package com.github.xiaoymin.knife4j.aggre.spring.configuration;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

class JakartaAggregationAutoConfigurationSmokeTest {

    @Test
    void shouldExposeBoot2AndBoot3AutoConfigurationMetadata() throws IOException {
        String springFactories = readResource("META-INF/spring.factories");
        Assertions.assertTrue(springFactories.contains("org.springframework.boot.autoconfigure.EnableAutoConfiguration"));
        Assertions.assertTrue(springFactories.contains(Knife4jAggregationAutoConfiguration.class.getName()));

        String autoConfigurationImports = readResource("META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports");
        Assertions.assertTrue(autoConfigurationImports.contains(Knife4jAggregationAutoConfiguration.class.getName()));
    }

    private String readResource(String path) throws IOException {
        try (InputStream input = Thread.currentThread().getContextClassLoader().getResourceAsStream(path)) {
            Assertions.assertNotNull(input, "Missing auto-configuration metadata: " + path);
            byte[] bytes = input.readAllBytes();
            return new String(bytes, StandardCharsets.UTF_8);
        }
    }
}
