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

import com.github.xiaoymin.knife4j.core.conf.GlobalConstants;
import com.github.xiaoymin.knife4j.core.enums.OpenAPILanguageEnums;
import com.github.xiaoymin.knife4j.spring.extension.Knife4jOpenApiCustomizer;
import io.swagger.v3.core.util.Json;
import io.swagger.v3.oas.models.OpenAPI;
import org.junit.Assert;
import org.junit.Test;
import org.springdoc.core.properties.SpringDocConfigProperties;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class OpenApi3JakartaAutoConfigurationSmokeTest {

    @Test
    public void shouldExposeBoot3AutoConfigurationMetadata() throws IOException {
        String autoConfigurationImports = readResource("META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports");
        Assert.assertTrue(autoConfigurationImports.contains(Knife4jAutoConfiguration.class.getName()));
        Assert.assertTrue(autoConfigurationImports.contains("com.github.xiaoymin.knife4j.spring.configuration.insight.Knife4jInsightAutoConfiguration"));
    }

    @Test
    public void shouldBindJapaneseLanguageAndExposeItInXSetting() {
        Map<String, Object> values = new HashMap<>();
        values.put("knife4j.enable", "true");
        values.put("knife4j.setting.language", "ja-JP");
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource("test", values));

        Knife4jProperties properties =
                Binder.get(environment).bind("knife4j", Bindable.of(Knife4jProperties.class)).get();
        Assert.assertEquals(OpenAPILanguageEnums.JA_JP, properties.getSetting().getLanguage());

        OpenAPI openApi = new OpenAPI();
        new Knife4jOpenApiCustomizer(properties, new SpringDocConfigProperties()).customise(openApi);
        Assert.assertEquals(
                OpenAPILanguageEnums.JA_JP.getValue(),
                Json.mapper()
                        .valueToTree(openApi)
                        .path(GlobalConstants.EXTENSION_OPEN_API_NAME)
                        .path(GlobalConstants.EXTENSION_OPEN_SETTING_NAME)
                        .path("language")
                        .asText());
    }

    private String readResource(String path) throws IOException {
        try (InputStream input = Thread.currentThread().getContextClassLoader().getResourceAsStream(path)) {
            Assert.assertNotNull("Missing auto-configuration metadata: " + path, input);
            byte[] bytes = input.readAllBytes();
            return new String(bytes, StandardCharsets.UTF_8);
        }
    }
}
