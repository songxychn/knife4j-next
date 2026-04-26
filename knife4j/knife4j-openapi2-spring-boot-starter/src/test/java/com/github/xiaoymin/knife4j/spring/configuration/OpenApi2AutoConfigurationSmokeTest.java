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


package com.github.xiaoymin.knife4j.spring.configuration;

import org.junit.Assert;
import org.junit.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class OpenApi2AutoConfigurationSmokeTest {

    @Test
    public void shouldExposeBoot2AndBoot3AutoConfigurationMetadata() throws IOException {
        String springFactories = readResource("META-INF/spring.factories");
        Assert.assertTrue(springFactories.contains("org.springframework.boot.autoconfigure.EnableAutoConfiguration"));
        Assert.assertTrue(springFactories.contains(Knife4jAutoConfiguration.class.getName()));
        Assert.assertTrue(springFactories.contains("com.github.xiaoymin.knife4j.spring.configuration.insight.Knife4jInsightAutoConfiguration"));
        Assert.assertTrue(springFactories.contains("org.springframework.boot.env.EnvironmentPostProcessor"));

        String autoConfigurationImports = readResource("META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports");
        Assert.assertTrue(autoConfigurationImports.contains(Knife4jAutoConfiguration.class.getName()));
        Assert.assertTrue(autoConfigurationImports.contains("com.github.xiaoymin.knife4j.spring.configuration.insight.Knife4jInsightAutoConfiguration"));
    }

    private String readResource(String path) throws IOException {
        try (InputStream input = Thread.currentThread().getContextClassLoader().getResourceAsStream(path)) {
            Assert.assertNotNull("Missing auto-configuration metadata: " + path, input);
            byte[] bytes = input.readAllBytes();
            return new String(bytes, StandardCharsets.UTF_8);
        }
    }
}
