FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY target/knife4j-demo-openapi3-*.jar app.jar
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/doc.html || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
