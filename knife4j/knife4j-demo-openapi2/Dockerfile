FROM eclipse-temurin:8-jre-alpine
WORKDIR /app
COPY target/knife4j-demo-openapi2-*.jar app.jar
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "app.jar"]

