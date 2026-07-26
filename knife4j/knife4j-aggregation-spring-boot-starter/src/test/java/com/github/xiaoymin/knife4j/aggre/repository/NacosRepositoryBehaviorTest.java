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


package com.github.xiaoymin.knife4j.aggre.repository;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.time.Duration;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

class NacosRepositoryBehaviorTest {

    @Test
    void executorAndHeartbeatCloseKeepExistingBehavior() throws ReflectiveOperationException {
        NacosRepository repository = new NacosRepository(null);
        try {
            assertEquals(5, repository.threadPoolExecutor.getCorePoolSize());
            assertEquals(5, repository.threadPoolExecutor.getMaximumPoolSize());
            assertEquals(60, repository.threadPoolExecutor.getKeepAliveTime(TimeUnit.SECONDS));
            assertEquals(1024, repository.threadPoolExecutor.getQueue().remainingCapacity());
            assertTrue(repository.threadPoolExecutor.getRejectedExecutionHandler() instanceof ThreadPoolExecutor.AbortPolicy);

            repository.start();
            Thread heartbeat = heartbeatThread(repository);
            assertTimeoutPreemptively(Duration.ofSeconds(2), () -> {
                while (heartbeat.getState() != Thread.State.TIMED_WAITING) {
                    Thread.yield();
                }
            });
            assertTimeoutPreemptively(Duration.ofSeconds(2), repository::close);
            assertFalse(heartbeat.isAlive());
        } finally {
            repository.threadPoolExecutor.shutdownNow();
        }
    }

    private static Thread heartbeatThread(NacosRepository repository) throws ReflectiveOperationException {
        Field field = NacosRepository.class.getDeclaredField("thread");
        field.setAccessible(true);
        return (Thread) field.get(repository);
    }
}
