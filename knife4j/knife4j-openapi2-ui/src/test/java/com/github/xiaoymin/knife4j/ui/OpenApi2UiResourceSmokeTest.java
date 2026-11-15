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


package com.github.xiaoymin.knife4j.ui;

import org.junit.Assert;
import org.junit.Test;

import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class OpenApi2UiResourceSmokeTest {

    private static final Pattern ASSET_REFERENCE = Pattern.compile("(?:href|src)=[\"']?([^\"'\\s>]+)[\"']?");

    @Test
    public void shouldPackageDocHtmlAndReferencedAssets() throws IOException {
        String docHtml = readResource("META-INF/resources/doc.html");

        assertReferencedWebjarAssets(docHtml);
        assertResource("META-INF/resources/knife4j-next-mark.svg");
        assertResource("META-INF/resources/webjars/oauth/oauth2.html");
    }

    private void assertReferencedWebjarAssets(String docHtml) {
        Matcher matcher = ASSET_REFERENCE.matcher(docHtml);
        int cssAssets = 0;
        int jsAssets = 0;
        while (matcher.find()) {
            String asset = matcher.group(1);
            // vite emits `./webjars/...` relative references; strip the leading `./` so the
            // path can be resolved against META-INF/resources.
            if (asset.startsWith("./")) {
                asset = asset.substring(2);
            }
            if (asset.startsWith("webjars/css/") || asset.startsWith("webjars/js/")) {
                assertResource("META-INF/resources/" + asset);
                if (asset.startsWith("webjars/css/")) {
                    cssAssets++;
                }
                if (asset.startsWith("webjars/js/")) {
                    jsAssets++;
                }
            }
        }
        Assert.assertTrue("doc.html should reference packaged CSS assets", cssAssets > 0);
        Assert.assertTrue("doc.html should reference packaged JS assets", jsAssets > 0);
    }

    @Test
    public void shouldStartPackagedUiInSpringfoxDesktopMode() throws Exception {
        URL doc = Thread.currentThread().getContextClassLoader().getResource("META-INF/resources/doc.html");
        Assert.assertNotNull("Missing packaged doc.html", doc);
        Assert.assertEquals("Surefire must execute the packaged classes directory", "file", doc.getProtocol());
        Path resources = Path.of(doc.toURI()).getParent();
        Path moduleDir = Path.of(System.getProperty("basedir")).toAbsolutePath();
        Path script = moduleDir.resolve("../../front/vue3/scripts/check-webjar-smoke.test.mjs").normalize();
        Path undiciPreload = script.getParent().resolve("use-npm-undici.cjs");
        Path jsdomPreload = script.getParent().resolve("fixtures/preload-jsdom.cjs");
        Path log = moduleDir.resolve("target/vue3-webjar-behavior.log");
        ProcessBuilder builder = new ProcessBuilder("bun", "test", "--preload", undiciPreload.toString(), "--preload",
                jsdomPreload.toString(), script.toString());
        builder.environment().put("KNIFE4J_WEBJAR_ROOT", resources.toString());
        Process process = builder
                .redirectErrorStream(true)
                .redirectOutput(log.toFile())
                .start();
        try {
            boolean completed = process.waitFor(60, TimeUnit.SECONDS);
            Assert.assertTrue("Packaged Vue3 behavior smoke timed out; see " + log, completed);
            Assert.assertEquals(Files.readString(log), 0, process.exitValue());
        } finally {
            if (process.isAlive()) {
                process.destroyForcibly();
                process.waitFor(5, TimeUnit.SECONDS);
            }
        }
    }

    private String readResource(String path) throws IOException {
        try (InputStream input = Thread.currentThread().getContextClassLoader().getResourceAsStream(path)) {
            Assert.assertNotNull("Missing packaged UI resource: " + path, input);
            byte[] bytes = input.readAllBytes();
            return new String(bytes, StandardCharsets.UTF_8);
        }
    }

    private void assertResource(String path) {
        URL resource = Thread.currentThread().getContextClassLoader().getResource(path);
        Assert.assertNotNull("Missing packaged UI resource: " + path, resource);
    }
}
