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


package com.github.xiaoymin.knife4j.smoke.boot4;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.After;
import org.junit.Assert;
import org.junit.Test;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.context.event.ApplicationStartedEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.support.StaticApplicationContext;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Exercises discovery from the starter, without @EnableKnife4j or component scanning.
 */
public class Knife4jBannerSmokeTest {

    private static final String LOGGER_NAME =
            "com.github.xiaoymin.knife4j.spring.configuration.Knife4jBannerAutoConfiguration";

    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();
    private ConfigurableApplicationContext context;
    private Logger logger;

    @After
    public void closeContext() {
        if (context != null) {
            context.close();
        }
        if (logger != null) {
            logger.detachAppender(appender);
        }
        appender.stop();
    }

    @Test
    public void shouldPrintByDefaultWithoutEnhancedModeAndOnlyOnce() throws Exception {
        start();
        String output = banner();
        Assert.assertTrue(output.contains("Enhanced   : disabled"));
        Assert.assertTrue(output.contains("Production : disabled"));
        Assert.assertTrue(output.contains("Basic Auth : disabled, credentials=not configured"));
        Assert.assertTrue(output.contains("启用 Knife4j 文档屏蔽需同时设置 knife4j.enable=true 和 knife4j.production=true。"));
        Assert.assertFalse(output.contains("生产部署请确认文档访问控制"));
        Assert.assertTrue("Version should be populated by Maven, including exploded-class launches",
                output.matches("(?s).*\\(v[0-9]+\\.[0-9]+\\.[0-9]+[^)]*\\).*"));
        Assert.assertFalse(output.contains("${project.version}"));

        // Neither logging nor enhanced=false should disable the existing documentation.
        assertDocument("/doc.html", "webjars/knife4j-ui-react/");
        assertDocument("/v3/api-docs", "\"openapi\"");

        context.publishEvent(readyEvent(context));
        try (StaticApplicationContext child = new StaticApplicationContext()) {
            context.publishEvent(readyEvent(child));
        }
        Assert.assertEquals("Repeated or child-context events must not repeat the banner", 1, banners().size());
    }

    @Test
    public void shouldAllowOptingOutIndependentlyOfEnhancedMode() {
        start("--knife4j.banner=false", "--knife4j.enable=true");
        Assert.assertTrue(banners().isEmpty());
    }

    @Test
    public void shouldMarkConfiguredProtectionInactiveWithoutEnhancedModeAndHideCredentials() {
        start("--knife4j.production=true", "--knife4j.basic.enable=true",
                "--knife4j.basic.username=banner-private-user", "--knife4j.basic.password=banner-private-password");
        String output = banner();
        Assert.assertTrue(output.contains("Enhanced   : disabled"));
        Assert.assertTrue(output.contains("Production : configured, inactive (knife4j.enable=false)"));
        Assert.assertTrue(output.contains("Basic Auth : configured, inactive (knife4j.enable=false), credentials=configured"));
        assertNoCredentials(output);
    }

    @Test
    public void shouldReportConfiguredProtectionWithEnhancedMode() {
        start("--knife4j.enable=true", "--knife4j.production=true", "--knife4j.basic.enable=true",
                "--knife4j.basic.username=banner-private-user", "--knife4j.basic.password=banner-private-password");
        String output = banner();
        Assert.assertTrue(output.contains("Enhanced   : enabled"));
        Assert.assertTrue(output.contains("Production : configured"));
        Assert.assertTrue(output.contains("Basic Auth : configured, credentials=configured"));
        Assert.assertFalse(output.contains("inactive"));
        assertNoCredentials(output);
    }

    @Test
    public void shouldDistinguishIncompleteCredentialsAndKeepBasicSwitchSeparate() {
        start("--knife4j.enable=true", "--knife4j.basic.enable=false",
                "--knife4j.basic.username=banner-private-user");
        String output = banner();
        Assert.assertTrue(output.contains("Basic Auth : disabled, credentials=incomplete"));
        assertNoCredentials(output);
    }

    @Test
    public void shouldFollowTheApplicationLogLevel() {
        start("--logging.level." + LOGGER_NAME + "=ERROR");
        Assert.assertTrue(banners().isEmpty());
    }

    private void start(String... args) {
        context = new SpringApplicationBuilder(BannerApplication.class)
                .web(WebApplicationType.SERVLET)
                .properties("server.port=0", "logging.level.root=ERROR",
                        "logging.level." + LOGGER_NAME + "=INFO",
                        "spring.mvc.pathmatch.matching-strategy=ant_path_matcher")
                .listeners((ApplicationListener<ApplicationStartedEvent>) event -> {
                    logger = (Logger) LoggerFactory.getLogger(LOGGER_NAME);
                    appender.start();
                    logger.addAppender(appender);
                })
                .run(args);
    }

    private List<String> banners() {
        return appender.list.stream().map(ILoggingEvent::getFormattedMessage)
                .filter(message -> message.contains(":: Knife4j Next ::")).collect(Collectors.toList());
    }

    private String banner() {
        List<String> output = banners();
        Assert.assertEquals("Exactly one startup configuration summary is expected", 1, output.size());
        return output.get(0);
    }

    private static void assertNoCredentials(String output) {
        Assert.assertFalse(output.contains("banner-private-user"));
        Assert.assertFalse(output.contains("banner-private-password"));
    }

    private static ApplicationReadyEvent readyEvent(ConfigurableApplicationContext applicationContext) {
        return new ApplicationReadyEvent(new SpringApplication(BannerApplication.class), new String[0],
                applicationContext, Duration.ZERO);
    }

    private void assertDocument(String path, String expected) throws Exception {
        int port = context.getEnvironment().getRequiredProperty("local.server.port", Integer.class);
        HttpURLConnection connection = (HttpURLConnection) new URL("http://localhost:" + port + path).openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        try {
            Assert.assertEquals(200, connection.getResponseCode());
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[1024];
                int length;
                while ((length = input.read(buffer)) != -1) {
                    output.write(buffer, 0, length);
                }
                Assert.assertTrue(output.toString(StandardCharsets.UTF_8.name()).contains(expected));
            }
        } finally {
            connection.disconnect();
        }
    }

    @EnableAutoConfiguration
    public static class BannerApplication {
    }
}
