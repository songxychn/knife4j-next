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


package com.baizhukui.knife4j.demo.openapi2;

import ch.qos.logback.core.net.HardenedObjectInputStream;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.classgraph.ClassGraph;
import org.apache.logging.log4j.message.MapMessage;
import org.junit.Assert;
import org.junit.Assume;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.web.util.UriComponentsBuilder;
import org.yaml.snakeyaml.error.YAMLException;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InvalidClassException;
import java.io.ObjectOutputStream;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/** Bounded, local-only probes; these do not imply that each library API is exposed over HTTP. */
public class DependencySecurityTest {

    @Rule
    public TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test
    public void doesNotTrustHostBeforeMalformedUserInfo() {
        // CVE-2024-22243: browsers interpret the host after '@'. Rejection is also safe.
        try {
            String host = UriComponentsBuilder.fromUriString("https://trusted.example[@untrusted.example/path")
                    .build().getHost();
            Assert.assertNotEquals("trusted.example", host);
        } catch (IllegalArgumentException rejected) {
            // Invalid authority must not be accepted as the trusted host.
        }
    }

    @Test
    public void bootYamlRejectsExcessiveDepth() {
        // 100 levels is deliberately bounded: old SnakeYAML accepts it, patched versions reject it.
        String yaml = "value: " + String.join("", Collections.nCopies(100, "[")) + "0"
                + String.join("", Collections.nCopies(100, "]"));
        YAMLException error = Assert.assertThrows(YAMLException.class, () -> loadYaml(yaml));
        Assert.assertTrue(error.getMessage(), error.getMessage().contains("Nesting Depth"));
    }

    @Test
    public void bootYamlRejectsJavaObjectTags() {
        // CVE-2022-1471 remains in SnakeYAML 1.x; Boot's SafeConstructor is the relevant boundary.
        Assert.assertThrows(YAMLException.class, () -> loadYaml("value: !!java.net.URL [https://example.invalid]"));
    }

    @Test
    public void logbackRejectsDeepGraphsOnJava9OrLater() throws Exception {
        // Logback 1.2.13 explicitly does not install this filter on Java 8.
        Assume.assumeFalse(System.getProperty("java.specification.version").equals("1.8"));
        List<Object> root = new ArrayList<>();
        List<Object> cursor = root;
        for (int i = 0; i < 40; i++) {
            List<Object> child = new ArrayList<>();
            cursor.add(child);
            cursor = child;
        }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ObjectOutputStream output = new ObjectOutputStream(bytes)) {
            output.writeObject(root);
        }
        try (
                HardenedObjectInputStream input = new HardenedObjectInputStream(
                        new ByteArrayInputStream(bytes.toByteArray()), new String[0])) {
            Assert.assertThrows(InvalidClassException.class, input::readObject);
        }
    }

    @Test
    public void log4jMapMessageProducesValidJsonForNonFiniteNumbers() throws Exception {
        for (double number : new double[]{Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY}) {
            String json = new MapMessage<>().with("number", number).getFormattedMessage(new String[]{"JSON"});
            Assert.assertTrue(new ObjectMapper().readTree(json).has("number"));
        }
    }

    @Test
    public void classGraphVersionDiscoveryDoesNotExpandExternalEntities() throws Exception {
        // Recreate the exploded-class development path in an isolated directory and classloader.
        // The external entity points only to a marker file created by this test, never real user data.
        Path classes = temporaryFolder.newFolder("classes").toPath();
        Path marker = temporaryFolder.newFile("marker.txt").toPath();
        Files.write(marker, "entity-expanded".getBytes(StandardCharsets.UTF_8));
        String pom = "<!DOCTYPE project [<!ENTITY marker SYSTEM '" + marker.toUri()
                + "'>]><project><version>&marker;</version></project>";
        Files.write(classes.resolve("pom.xml"), pom.getBytes(StandardCharsets.UTF_8));
        try (
                JarFile jar = new JarFile(new java.io.File(ClassGraph.class.getProtectionDomain()
                        .getCodeSource().getLocation().toURI()))) {
            Enumeration<JarEntry> entries = jar.entries();
            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();
                if (!entry.isDirectory() && entry.getName().endsWith(".class")) {
                    Path target = classes.resolve(entry.getName()).normalize();
                    Assert.assertTrue(target.startsWith(classes));
                    Files.createDirectories(target.getParent());
                    try (InputStream input = jar.getInputStream(entry)) {
                        Files.copy(input, target);
                    }
                }
            }
        }
        try (URLClassLoader isolated = new URLClassLoader(new URL[]{classes.toUri().toURL()}, null)) {
            Class<?> scanner = isolated.loadClass("io.github.classgraph.ClassGraph");
            Assert.assertNotEquals("entity-expanded", scanner.getMethod("getVersion").invoke(null));
        }
    }

    private static void loadYaml(String yaml) throws Exception {
        new YamlPropertySourceLoader().load("security-probe",
                new ByteArrayResource(yaml.getBytes(StandardCharsets.UTF_8)));
    }
}
