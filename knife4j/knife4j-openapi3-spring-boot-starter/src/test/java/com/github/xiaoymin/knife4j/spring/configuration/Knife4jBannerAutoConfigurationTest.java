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
import org.slf4j.Logger;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.support.StaticApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

import java.lang.reflect.Proxy;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class Knife4jBannerAutoConfigurationTest {

    @Test
    public void shouldExposeOptOutConditionMetadata() {
        ConditionalOnProperty condition = Knife4jBannerAutoConfiguration.class.getAnnotation(ConditionalOnProperty.class);
        Assert.assertNotNull(condition);
        Assert.assertArrayEquals(new String[]{"knife4j.banner"}, condition.name());
        Assert.assertEquals("true", condition.havingValue());
        Assert.assertTrue(condition.matchIfMissing());
    }

    @Test
    public void shouldPrintDefaultBannerOnceAndIgnoreRepeatedOrChildContextEvents() {
        List<String> messages = new ArrayList<>();
        Logger logger = recordingLogger(true, messages);
        try (StaticApplicationContext context = new StaticApplicationContext(); StaticApplicationContext child = new StaticApplicationContext()) {
            Knife4jBannerAutoConfiguration banner = new Knife4jBannerAutoConfiguration(context, environment());
            banner.emitBanner(readyEvent(child), logger);
            Assert.assertTrue("Child context event must be ignored", messages.isEmpty());

            banner.emitBanner(readyEvent(context), logger);
            banner.emitBanner(readyEvent(context), logger);

            Assert.assertEquals("Repeated events must not repeat the banner", 1, messages.size());
            String output = messages.get(0);
            Assert.assertTrue(output.contains("Enhanced   : disabled"));
            Assert.assertTrue(output.contains("Production : disabled"));
            Assert.assertTrue(output.contains("Basic Auth : disabled, credentials=not configured"));
            Assert.assertTrue(output.contains("启用 Knife4j 文档屏蔽需同时设置 knife4j.enable=true 和 knife4j.production=true。"));
            Assert.assertTrue(output.matches("(?s).*\\(v[0-9]+\\.[0-9]+\\.[0-9]+[^)]*\\).*"));
            Assert.assertFalse(output.contains("${project.version}"));
        }
    }

    @Test
    public void shouldMarkConfiguredProtectionInactiveWithoutEnhancedModeAndHideCredentials() {
        StandardEnvironment env = environment(
                "knife4j.production", "true",
                "knife4j.basic.enable", "true",
                "knife4j.basic.username", "banner-private-user",
                "knife4j.basic.password", "banner-private-password");
        String output = fireBanner(env);
        Assert.assertTrue(output.contains("Enhanced   : disabled"));
        Assert.assertTrue(output.contains("Production : configured, inactive (knife4j.enable=false)"));
        Assert.assertTrue(output.contains("Basic Auth : configured, inactive (knife4j.enable=false), credentials=configured"));
        assertNoCredentials(output);
    }

    @Test
    public void shouldReportConfiguredProtectionWithEnhancedMode() {
        StandardEnvironment env = environment(
                "knife4j.enable", "true",
                "knife4j.production", "true",
                "knife4j.basic.enable", "true",
                "knife4j.basic.username", "banner-private-user",
                "knife4j.basic.password", "banner-private-password");
        String output = fireBanner(env);
        Assert.assertTrue(output.contains("Enhanced   : enabled"));
        Assert.assertTrue(output.contains("Production : configured"));
        Assert.assertTrue(output.contains("Basic Auth : configured, credentials=configured"));
        Assert.assertFalse(output.contains("inactive"));
        assertNoCredentials(output);
    }

    @Test
    public void shouldDistinguishIncompleteCredentialsAndKeepBasicSwitchSeparate() {
        StandardEnvironment env = environment(
                "knife4j.enable", "true",
                "knife4j.basic.enable", "false",
                "knife4j.basic.username", "banner-private-user");
        String output = fireBanner(env);
        Assert.assertTrue(output.contains("Basic Auth : disabled, credentials=incomplete"));
        assertNoCredentials(output);
    }

    @Test
    public void shouldRespectLoggerLevel() {
        List<String> messages = new ArrayList<>();
        Logger logger = recordingLogger(false, messages);
        try (StaticApplicationContext context = new StaticApplicationContext()) {
            new Knife4jBannerAutoConfiguration(context, environment()).emitBanner(readyEvent(context), logger);
            Assert.assertTrue(messages.isEmpty());
        }
    }

    private String fireBanner(StandardEnvironment env) {
        List<String> messages = new ArrayList<>();
        try (StaticApplicationContext context = new StaticApplicationContext()) {
            new Knife4jBannerAutoConfiguration(context, env).emitBanner(readyEvent(context), recordingLogger(true, messages));
            Assert.assertEquals("Exactly one startup configuration summary is expected", 1, messages.size());
            return messages.get(0);
        }
    }

    private static Logger recordingLogger(boolean infoEnabled, List<String> messages) {
        return (Logger) Proxy.newProxyInstance(
                Logger.class.getClassLoader(),
                new Class<?>[]{Logger.class},
                (proxy, method, args) -> {
                    if ("isInfoEnabled".equals(method.getName())) {
                        return infoEnabled;
                    }
                    if ("info".equals(method.getName()) && args != null && args.length > 0 && args[0] instanceof String) {
                        messages.add((String) args[0]);
                        return null;
                    }
                    if (method.getReturnType() == boolean.class) {
                        return false;
                    }
                    return null;
                });
    }

    private static StandardEnvironment environment(String... kv) {
        Map<String, Object> values = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            values.put(kv[i], kv[i + 1]);
        }
        StandardEnvironment env = new StandardEnvironment();
        env.getPropertySources().addFirst(new MapPropertySource("test", values));
        return env;
    }

    private static ApplicationReadyEvent readyEvent(ConfigurableApplicationContext context) {
        return new ApplicationReadyEvent(new SpringApplication(Knife4jBannerAutoConfigurationTest.class),
                new String[0], context, Duration.ZERO);
    }

    private static void assertNoCredentials(String output) {
        Assert.assertFalse(output.contains("banner-private-user"));
        Assert.assertFalse(output.contains("banner-private-password"));
    }
}
