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


package com.github.xiaoymin.knife4j.smoke.boot4aggregation;

import com.github.xiaoymin.knife4j.aggre.repository.PolarisRepository;
import com.github.xiaoymin.knife4j.aggre.spring.configuration.Knife4jAggregationAutoConfiguration;
import com.github.xiaoymin.knife4j.aggre.spring.support.PolarisSetting;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.MapPropertySource;

import java.util.LinkedHashMap;
import java.util.Map;

public class PolarisSettingConditionSmokeTest {

    @Test
    public void shouldStartWithKebabCaseServiceUrl() {
        assertStarts("knife4j.polaris.service-url");
    }

    @Test
    public void shouldKeepCamelCaseServiceUrlWorking() {
        assertStarts("knife4j.polaris.serviceUrl");
    }

    @Test
    public void shouldRejectMissingAndEmptyServiceUrl() {
        Map<String, Object> properties = validProperties();
        properties.remove("knife4j.polaris.serviceUrl");
        assertRejected(properties, "knife4j.polaris.serviceUrl");
        properties.put("knife4j.polaris.serviceUrl", "");
        properties.put("knife4j.polaris.service-url", "");
        assertRejected(properties, "knife4j.polaris.serviceUrl");
    }

    @Test
    public void shouldStartWithoutAuthentication() {
        Map<String, Object> properties = validProperties();
        properties.keySet().removeIf(key -> key.startsWith("knife4j.polaris.service-auth."));
        assertStarts(properties);
        properties.put("knife4j.polaris.service-auth.enable", "false");
        assertStarts(properties);
    }

    @Test
    public void shouldKeepCredentialsRequired() {
        for (String field : new String[]{"username", "password"}) {
            Map<String, Object> properties = validProperties();
            String key = "knife4j.polaris.service-auth." + field;
            properties.remove(key);
            assertRejected(properties, key);
            properties.put(key, "");
            assertRejected(properties, key);
        }
    }

    @Test
    public void shouldValidateCamelCaseAuthenticationLikeBoundSettings() {
        Map<String, Object> properties = new LinkedHashMap<>();
        validProperties().forEach((key, value) -> properties.put(key.replace(".service-auth.", ".serviceAuth."), value));
        assertStarts(properties);
        properties.remove("knife4j.polaris.serviceAuth.password");
        assertRejected(properties, "knife4j.polaris.service-auth.password");
    }

    private void assertStarts(String urlKey) {
        Map<String, Object> properties = validProperties();
        Object serviceUrl = properties.remove("knife4j.polaris.serviceUrl");
        properties.put(urlKey, serviceUrl);
        assertStarts(properties);
    }

    private void assertStarts(Map<String, Object> properties) {
        try (AnnotationConfigApplicationContext context = context(properties)) {
            context.refresh();
            Assert.assertNotNull(context.getBean(PolarisRepository.class));
            Object serviceUrl = properties.get("knife4j.polaris.serviceUrl");
            if (serviceUrl == null) {
                serviceUrl = properties.get("knife4j.polaris.service-url");
            }
            Assert.assertEquals(serviceUrl, context.getBean(PolarisSetting.class).getServiceUrl());
        }
    }

    private void assertRejected(Map<String, Object> properties, String missingProperty) {
        try (AnnotationConfigApplicationContext context = context(properties)) {
            try {
                context.refresh();
                Assert.fail("Expected missing configuration: " + missingProperty);
            } catch (RuntimeException exception) {
                Throwable cause = exception;
                while (cause.getCause() != null) {
                    cause = cause.getCause();
                }
                Assert.assertEquals("Lack of knife4j.polaris configuration: " + missingProperty, cause.getMessage());
            }
        }
    }

    private AnnotationConfigApplicationContext context(Map<String, Object> properties) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("polaris-test", properties));
        context.register(Knife4jAggregationAutoConfiguration.class);
        return context;
    }

    private Map<String, Object> validProperties() {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("knife4j.enable-aggregation", "true");
        properties.put("knife4j.polaris.enable", "true");
        properties.put("knife4j.polaris.serviceUrl", "http://127.0.0.1:1");
        properties.put("knife4j.polaris.service-auth.enable", "true");
        properties.put("knife4j.polaris.service-auth.username", "test-user");
        properties.put("knife4j.polaris.service-auth.password", "test-password");
        // No routes: exercise startup and binding without contacting a Polaris server.
        return properties;
    }
}
