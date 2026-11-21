FROM eclipse-temurin:8-jre-alpine
WORKDIR /app
COPY target/knife4j-demo-openapi2-*.jar app.jar
USER 10001:10001
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8081/doc.html || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
