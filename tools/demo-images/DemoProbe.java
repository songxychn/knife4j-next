import java.io.FileInputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.KeyStore;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/** Java 8-compatible health and offline trust-store contract probe. */
public final class DemoProbe {
    public static void main(String[] args) throws Exception {
        if (args[0].equals("health")) {
            String port = System.getenv("DEMO_PORT");
            if (!"8080".equals(port) && !"8081".equals(port)) throw new IllegalArgumentException("port");
            HttpURLConnection connection = (HttpURLConnection) new URL(
                    "http://127.0.0.1:" + port + "/doc.html").openConnection();
            connection.setConnectTimeout(3000);
            connection.setReadTimeout(3000);
            connection.setInstanceFollowRedirects(false);
            try {
                if (connection.getResponseCode() != 200) throw new IllegalStateException("not ready");
            } finally {
                connection.disconnect();
            }
        } else if (args[0].equals("trust")) {
            TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            factory.init((KeyStore) null);
            X509TrustManager trust = null;
            for (TrustManager manager : factory.getTrustManagers()) {
                if (manager instanceof X509TrustManager) trust = (X509TrustManager) manager;
            }
            if (trust == null) throw new IllegalStateException("trust manager missing");
            X509Certificate cert;
            try (FileInputStream input = new FileInputStream(args[1])) {
                cert = (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(input);
            }
            boolean accepted = true;
            try { trust.checkServerTrusted(new X509Certificate[]{cert}, "RSA"); }
            catch (CertificateException rejected) { accepted = false; }
            if (accepted != Boolean.parseBoolean(args[2])) throw new IllegalStateException("trust mismatch");
            System.out.println(accepted ? "ACCEPTED" : "REJECTED");
        } else throw new IllegalArgumentException("mode");
    }
}
