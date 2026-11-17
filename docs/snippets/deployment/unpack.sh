# 在 Maven 仓库中找到 knife4j-openapi3-ui 的 jar
knife4j_version="5.8.3"
# 保留 webjars/ 下的目录、Worker 和动态分块
knife4j_unpack_dir="$(mktemp -d)"
trap 'rm -rf "$knife4j_unpack_dir"' EXIT
knife4j_ui_jar="${KNIFE4J_UI_JAR:-$HOME/.m2/repository/com/baizhukui/knife4j-openapi3-ui/$knife4j_version/knife4j-openapi3-ui-$knife4j_version.jar}"
knife4j_static_dir="${KNIFE4J_STATIC_DIR:-/opt/knife4j-static}"
unzip "$knife4j_ui_jar" \
  "META-INF/resources/*" -d "$knife4j_unpack_dir"
mkdir -p "$knife4j_static_dir"
cp -R "$knife4j_unpack_dir/META-INF/resources/." "$knife4j_static_dir/"
