ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG DEMO_PORT
ARG SOURCE_REVISION
WORKDIR /app
COPY app.jar /app/app.jar
COPY DemoProbe.class /opt/demo-probe/DemoProbe.class
ENV DEMO_PORT=${DEMO_PORT}
LABEL org.opencontainers.image.source="https://github.com/songxychn/knife4j-next" \
      org.opencontainers.image.revision=${SOURCE_REVISION} \
      org.opencontainers.image.description="Validated master Demo image; not a Maven release"
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD ["java", "-Xms8m", "-Xmx32m", "-cp", "/opt/demo-probe", "DemoProbe", "health"]
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
