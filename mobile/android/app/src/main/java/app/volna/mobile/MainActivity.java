package app.volna.mobile;

import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VolnaPlugin.class);
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new CorsClient(bridge));
        preferHighRefreshRate();
    }

    /**
     * Android по умолчанию держит WebView-приложение на 60 Гц, а экран умеет 120 —
     * после других приложений анимации кажутся дёрганными. Просим самый частый режим
     * с тем же разрешением.
     */
    private void preferHighRefreshRate() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        Display display = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? getDisplay() : getWindowManager().getDefaultDisplay();
        if (display == null) return;
        Display.Mode cur = display.getMode();
        Display.Mode best = cur;
        for (Display.Mode m : display.getSupportedModes()) {
            if (m.getPhysicalWidth() == cur.getPhysicalWidth() && m.getPhysicalHeight() == cur.getPhysicalHeight()
                && m.getRefreshRate() > best.getRefreshRate()) best = m;
        }
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.preferredDisplayModeId = best.getModeId();
        lp.preferredRefreshRate = best.getRefreshRate();
        getWindow().setAttributes(lp);
    }

    /**
     * Интерфейс живёт на https://localhost, а аудио/обложки/волноформы — на CDN SoundCloud.
     * Как на ПК (onHeadersReceived), отдаём их через себя с Access-Control-Allow-Origin: *,
     * чтобы работали hls.js, цвет из обложки и волноформа.
     */
    static class CorsClient extends BridgeWebViewClient {

        CorsClient(Bridge bridge) {
            super(bridge);
        }

        static boolean ours(String host) {
            return host != null && (host.endsWith(".sndcdn.com") || host.equals("lrclib.net"));
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            if (!"GET".equals(req.getMethod()) || !ours(req.getUrl().getHost())) {
                return super.shouldInterceptRequest(view, req);
            }
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(req.getUrl().toString()).openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                for (Map.Entry<String, String> h : req.getRequestHeaders().entrySet()) {
                    String k = h.getKey();
                    // Accept-Encoding не передаём: тогда HttpURLConnection сам распакует gzip
                    if (k.equalsIgnoreCase("Origin") || k.equalsIgnoreCase("Referer") || k.equalsIgnoreCase("Accept-Encoding")) continue;
                    c.setRequestProperty(k, h.getValue());
                }
                c.setRequestProperty("User-Agent", VolnaPlugin.DESKTOP_UA);
                int status = c.getResponseCode();
                Map<String, String> out = new HashMap<>();
                for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                    String k = e.getKey();
                    if (k == null || e.getValue().isEmpty()) continue;
                    String low = k.toLowerCase();
                    if (low.startsWith("access-control-") || low.equals("content-encoding") || low.equals("transfer-encoding")) continue;
                    // после распаковки gzip длина уже другая
                    if (low.equals("content-length") && c.getHeaderField("Content-Encoding") != null) continue;
                    out.put(k, e.getValue().get(0));
                }
                out.put("Access-Control-Allow-Origin", "*");
                out.put("Access-Control-Allow-Headers", "*");
                out.put("Access-Control-Expose-Headers", "*");
                String type = c.getContentType();
                String mime = "application/octet-stream", enc = null;
                if (type != null) {
                    String[] parts = type.split(";");
                    mime = parts[0].trim();
                    for (String p : parts) if (p.trim().toLowerCase().startsWith("charset=")) enc = p.trim().substring(8);
                }
                InputStream body = status >= 400 ? c.getErrorStream() : c.getInputStream();
                String reason = c.getResponseMessage();
                if (reason == null || reason.isEmpty()) reason = status < 400 ? "OK" : "Error";
                return new WebResourceResponse(mime, enc, status, reason, out, body);
            } catch (Exception e) {
                return null; // пусть WebView попробует сам
            }
        }
    }
}
