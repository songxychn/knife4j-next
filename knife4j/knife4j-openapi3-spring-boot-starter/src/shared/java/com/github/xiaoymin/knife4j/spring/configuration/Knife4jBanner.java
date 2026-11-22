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

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Logs the OAS3 WebMvc starter configuration independently of enhanced mode.
 */
abstract class Knife4jBanner {

    private static final Logger LOGGER = LoggerFactory.getLogger(Knife4jBannerAutoConfiguration.class);

    private static final String LOGO = String.join("\n",
            "  _  __      _  __      _  _   _",
            " | |/ /_ __ (_)/ _| ___| || | (_)",
            " | ' /| '_ \\| | |_ / _ \\ || |_| |",
            " | . \\| | | | |  _|  __/__   _| |",
            " |_|\\_\\_| |_|_|_|  \\___|  |_|_/ |",
            "                           |__/");

    private final ConfigurableApplicationContext context;
    private final Environment environment;
    private final String versionResource;
    private final AtomicBoolean printed = new AtomicBoolean();

    Knife4jBanner(ConfigurableApplicationContext context, Environment environment, String versionResource) {
        this.context = context;
        this.environment = environment;
        this.versionResource = versionResource;
    }

    public void onApplicationEvent(ApplicationReadyEvent event) {
        emitBanner(event, LOGGER);
    }

    void emitBanner(ApplicationReadyEvent event, Logger targetLogger) {
        // Child-context events propagate to parents; only report our own application.
        if (event.getApplicationContext() != context || !targetLogger.isInfoEnabled()
                || !printed.compareAndSet(false, true)) {
            return;
        }
        boolean enhanced = environment.getProperty("knife4j.enable", Boolean.class, false);
        boolean production = environment.getProperty("knife4j.production", Boolean.class, false);
        boolean basic = environment.getProperty("knife4j.basic.enable", Boolean.class, false);
        boolean username = StringUtils.hasText(environment.getProperty("knife4j.basic.username"));
        boolean password = StringUtils.hasText(environment.getProperty("knife4j.basic.password"));
        String credentials = username && password ? "configured" : username || password ? "incomplete" : "not configured";

        targetLogger.info(String.format(
                "\n%s\n :: Knife4j Next ::  (v%s)\n\n Enhanced   : %s\n Production : %s\n Basic Auth : %s, credentials=%s"
                        + "\n\n 启用 Knife4j 文档屏蔽需同时设置 knife4j.enable=true 和 knife4j.production=true。\n",
                LOGO, version(), enhanced ? "enabled" : "disabled",
                status(production, enhanced), status(basic, enhanced), credentials));
    }

    private static String status(boolean configured, boolean enhanced) {
        if (!configured) {
            return "disabled";
        }
        return enhanced ? "configured" : "configured, inactive (knife4j.enable=false)";
    }

    private String version() {
        // A module-specific, Maven-filtered resource works for JARs and exploded classes.
        try (
                InputStream input = Knife4jBannerAutoConfiguration.class.getResourceAsStream(versionResource)) {
            if (input != null) {
                Properties properties = new Properties();
                properties.load(input);
                return properties.getProperty("version", "unknown");
            }
        } catch (IOException ex) {
            LOGGER.debug("Cannot read Knife4j Next version", ex);
        }
        return "unknown";
    }
}
