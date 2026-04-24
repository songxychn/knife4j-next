FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY target/knife4j-demo-*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
