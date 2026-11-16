import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.ExpressionTree;
import com.sun.source.tree.LiteralTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.JavacTask;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Path;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import javax.lang.model.element.Modifier;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaFileObject;
import javax.tools.ToolProvider;

/** Parse declarations with javac, without resolving third-party dependencies. */
class SettingFacts {
    private static String json(Object value) {
        if (value == null) return "null";
        if (value instanceof Boolean || value instanceof Number) return value.toString();
        StringBuilder result = new StringBuilder("\"");
        for (char c : value.toString().toCharArray()) {
            switch (c) {
                case '"': result.append("\\\""); break;
                case '\\': result.append("\\\\"); break;
                case '\n': result.append("\\n"); break;
                case '\r': result.append("\\r"); break;
                case '\t': result.append("\\t"); break;
                default:
                    if (c < 32) result.append(String.format("\\u%04x", (int) c));
                    else result.append(c);
            }
        }
        return result.append('"').toString();
    }

    private static Object declaredDefault(VariableTree field) {
        ExpressionTree expression = field.getInitializer();
        if (expression instanceof LiteralTree) return ((LiteralTree) expression).getValue();
        if (expression instanceof MemberSelectTree && field.getType().toString().endsWith("Enums")) {
            return ((MemberSelectTree) expression).getIdentifier().toString();
        }
        if (expression != null) throw new IllegalArgumentException("unsupported default expression for " + field.getName() + ": " + expression);
        switch (field.getType().toString()) {
            case "boolean": return false;
            case "int": case "long": case "short": case "byte": return 0;
            case "float": case "double": return 0.0;
            case "char": return String.valueOf((char) 0);
            default: return null;
        }
    }

    public static void main(String[] args) throws Exception {
        // --compiled ROOT also compares declarations with independently compiled beans.
        boolean compiled = args.length > 1 && args[0].equals("--compiled");
        Path root = compiled ? Path.of(args[1]).toAbsolutePath() : null;
        int first = compiled ? 2 : 0;
        if (args.length == first) throw new IllegalArgumentException("expected Knife4jSetting.java sources");
        var compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new IllegalStateException("JDK 17+ required");
        try (var manager = compiler.getStandardFileManager(null, null, null)) {
            for (int index = first; index < args.length; index++) {
                Path path = Path.of(args[index]).toAbsolutePath();
                var diagnostics = new DiagnosticCollector<JavaFileObject>();
                var task = (JavacTask) compiler.getTask(null, manager, diagnostics,
                        List.of("-proc:none"), null, manager.getJavaFileObjects(path.toFile()));
                var units = task.parse();
                List<String> fields = new ArrayList<>();
                Object bean = null;
                URLClassLoader loader = null;
                if (compiled) {
                    Path module = path;
                    while (!module.getParent().equals(root.resolve("knife4j"))) module = module.getParent();
                    Path classes = module.resolve("target/classes");
                    if (!Files.isRegularFile(classes.resolve("com/github/xiaoymin/knife4j/spring/configuration/Knife4jSetting.class"))) {
                        throw new IllegalStateException("build Java first: " + classes);
                    }
                    loader = new URLClassLoader(new URL[]{classes.toUri().toURL(), root.resolve("knife4j/knife4j-core/target/classes").toUri().toURL()}, null);
                    bean = Class.forName("com.github.xiaoymin.knife4j.spring.configuration.Knife4jSetting", true, loader).getConstructor().newInstance();
                }
                try {
                    for (CompilationUnitTree unit : units) {
                        for (Tree declaration : unit.getTypeDecls()) {
                            if (!(declaration instanceof ClassTree)) continue;
                            ClassTree clazz = (ClassTree) declaration;
                            if (!clazz.getSimpleName().contentEquals("Knife4jSetting")) continue;
                            for (Tree member : clazz.getMembers()) {
                                if (!(member instanceof VariableTree)) continue;
                                VariableTree field = (VariableTree) member;
                                if (field.getModifiers().getFlags().contains(Modifier.STATIC)) continue;
                                Object value = declaredDefault(field);
                                if (bean != null) {
                                    var reflected = bean.getClass().getDeclaredField(field.getName().toString());
                                    reflected.setAccessible(true);
                                    Object actual = reflected.get(bean);
                                    if (actual instanceof Enum<?>) actual = ((Enum<?>) actual).name();
                                    if (!json(actual).equals(json(value))) throw new IllegalStateException(path + ": compiled default differs for " + field.getName());
                                }
                                fields.add("{\"name\":" + json(field.getName()) + ",\"type\":" + json(field.getType()) + ",\"default\":" + json(value) + "}");
                            }
                        }
                    }
                } finally {
                    if (loader != null) loader.close();
                }
                if (diagnostics.getDiagnostics().stream().anyMatch(d -> d.getKind() == Diagnostic.Kind.ERROR)) throw new IllegalStateException("invalid Java source: " + path + " " + diagnostics.getDiagnostics());
                if (fields.isEmpty()) throw new IllegalStateException("no settings fields: " + path);
                System.out.println("{\"source\":" + json(path) + ",\"fields\":[" + String.join(",", fields) + "]}");
            }
        }
    }
}
