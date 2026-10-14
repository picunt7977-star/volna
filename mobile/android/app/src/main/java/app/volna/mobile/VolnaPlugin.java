package app.volna.mobile;

import android.annotation.SuppressLint;
import android.app.Dialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Всё, что на ПК делал главный процесс Electron:
 *  - запросы к api-v2 SoundCloud без CORS, с куками сайта (datadome — «не бот»);
 *  - client_id: невидимый WebView открывает soundcloud.com и мы ловим его из запросов самого сайта;
 *  - вход и капча: сайт SoundCloud во весь экран, ждём куку oauth_token / новую datadome.
 */
@CapacitorPlugin(name = "Volna")
public class VolnaPlugin extends Plugin {

    // Обычный мобильный Chrome: с «; wv)» в UA вход через Google не пускает
    static final String UA =
        "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36";
    // Невидимой вкладке — десктопный UA: с мобильным сайт уводит на m.soundcloud.com,
    // а тот ходит не в api-v2 и client_id оттуда не поймать
    static final String DESKTOP_UA =
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
    private static final String SITE = "https://soundcloud.com";

    private final ExecutorService pool = Executors.newFixedThreadPool(6);
    private final Handler ui = new Handler(Looper.getMainLooper());

    private Dialog siteDialog;       // открытый сайт (вход/капча)
    private PluginCall siteCall;
    private Runnable sitePoll;

    // --- запрос к api-v2 -------------------------------------------------------
    @PluginMethod
    public void request(PluginCall call) {
        pool.execute(() -> {
            HttpURLConnection c = null;
            try {
                String url = call.getString("url");
                String method = call.getString("method", "GET");
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestMethod(method);
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                c.setRequestProperty("User-Agent", DESKTOP_UA);
                // запросы оформляем как запросы самого сайта — иначе запись (лайки) отклоняется
                c.setRequestProperty("Origin", SITE);
                c.setRequestProperty("Referer", SITE + "/");
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) c.setRequestProperty("Cookie", cookies);
                JSObject headers = call.getObject("headers", new JSObject());
                for (Iterator<String> it = headers.keys(); it.hasNext(); ) {
                    String k = it.next();
                    c.setRequestProperty(k, headers.getString(k));
                }
                String body = call.getString("body");
                if (body != null) {
                    c.setDoOutput(true);
                    try (OutputStream os = c.getOutputStream()) {
                        os.write(body.getBytes(StandardCharsets.UTF_8));
                    }
                }
                int status = c.getResponseCode();
                saveCookies(url, c.getHeaderFields());
                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("data", in == null ? "" : readAll(in));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Нет связи с SoundCloud — проверь интернет/VPN (" + e.getClass().getSimpleName() + ")");
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    // Set-Cookie из ответов API (DataDome обновляет так свою куку) — в общее хранилище WebView
    static void saveCookies(String url, Map<String, List<String>> fields) {
        CookieManager cm = CookieManager.getInstance();
        for (Map.Entry<String, List<String>> e : fields.entrySet()) {
            if (e.getKey() == null || !e.getKey().equalsIgnoreCase("Set-Cookie")) continue;
            for (String v : e.getValue()) cm.setCookie(url, v);
        }
    }

    static String readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        try (InputStream s = in) {
            while ((n = s.read(buf)) > 0) out.write(buf, 0, n);
        }
        return out.toString("UTF-8");
    }

    static String cookie(String name) {
        String all = CookieManager.getInstance().getCookie(SITE);
        if (all == null) return null;
        for (String part : all.split(";")) {
            String p = part.trim();
            if (p.startsWith(name + "=")) return p.substring(name.length() + 1);
        }
        return null;
    }

    @PluginMethod
    public void getCookie(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("value", cookie(call.getString("name", "")));
        call.resolve(ret);
    }

    // --- невидимый сайт: client_id и кука datadome ---------------------------------
    // want: "clientId" — ждём client_id из запросов сайта; "datadome" — ждём новую куку «не бот»
    @PluginMethod
    public void visitSite(PluginCall call) {
        String want = call.getString("want", "clientId");
        String before = cookie("datadome");
        boolean force = Boolean.TRUE.equals(call.getBoolean("force", false));
        ui.post(() -> {
            final String[] cid = { null };
            WebView w = makeWebView();
            w.getSettings().setUserAgentString(DESKTOP_UA);
            w.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                    Uri u = r.getUrl();
                    if ("api-v2.soundcloud.com".equals(u.getHost()) && cid[0] == null) {
                        String c = u.getQueryParameter("client_id");
                        if (c != null && !c.isEmpty()) cid[0] = c;
                    }
                    return null;
                }
            });
            w.getSettings().setMediaPlaybackRequiresUserGesture(true);
            // крошечный и невидимый, но в иерархии окна — так сайт живёт как обычная вкладка
            ViewGroup root = getActivity().findViewById(android.R.id.content);
            root.addView(w, new FrameLayout.LayoutParams(1, 1));
            w.setAlpha(0f);
            w.loadUrl(SITE + "/discover");

            final long start = System.currentTimeMillis();
            Runnable tick = new Runnable() {
                @Override
                public void run() {
                    String dd = cookie("datadome");
                    boolean ok = "datadome".equals(want)
                        ? dd != null && (!force || !dd.equals(before))
                        : cid[0] != null;
                    boolean timeout = System.currentTimeMillis() - start > 30000;
                    if (!ok && !timeout) {
                        ui.postDelayed(this, 250);
                        return;
                    }
                    CookieManager.getInstance().flush();
                    // ещё секунду даём скрипту защиты дописать своё
                    ui.postDelayed(() -> {
                        root.removeView(w);
                        w.destroy();
                    }, 1000);
                    if (!ok && "clientId".equals(want)) {
                        call.reject("SoundCloud не ответил — проверь интернет/VPN");
                        return;
                    }
                    JSObject ret = new JSObject();
                    ret.put("clientId", cid[0]);
                    ret.put("datadome", dd);
                    call.resolve(ret);
                }
            };
            ui.postDelayed(tick, 250);
        });
    }

    // --- сайт во весь экран: вход или капча ---------------------------------------
    // waitFor: "token" — до появления oauth_token; "datadome" — до смены куки после капчи
    @PluginMethod
    public void openSite(PluginCall call) {
        String url = call.getString("url", SITE + "/signin");
        String waitFor = call.getString("waitFor", "token");
        String title = call.getString("title", "Вход в SoundCloud");
        String before = cookie("datadome");
        ui.post(() -> {
            if (siteDialog != null) closeSite(false, null);
            siteCall = call;
            final String[] cid = { null };

            Dialog d = new Dialog(getActivity(), android.R.style.Theme_DeviceDefault_NoActionBar);
            Window win = d.getWindow();
            if (win != null) {
                win.setStatusBarColor(Color.parseColor("#09090d"));
                win.setNavigationBarColor(Color.parseColor("#09090d"));
            }
            LinearLayout box = new LinearLayout(getContext());
            box.setOrientation(LinearLayout.VERTICAL);
            box.setBackgroundColor(Color.parseColor("#09090d"));

            LinearLayout bar = new LinearLayout(getContext());
            bar.setGravity(Gravity.CENTER_VERTICAL);
            int pad = dp(14);
            bar.setPadding(pad + dp(4), dp(6), dp(6), dp(6));
            TextView t = new TextView(getContext());
            t.setText(title);
            t.setTextColor(Color.WHITE);
            t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
            t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
            bar.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            Button cancel = new Button(getContext());
            cancel.setText("Отмена");
            cancel.setAllCaps(false);
            cancel.setTextColor(Color.WHITE);
            cancel.setBackgroundColor(Color.TRANSPARENT);
            cancel.setOnClickListener(v -> closeSite(false, null));
            bar.addView(cancel);
            box.addView(bar);

            FrameLayout frame = new FrameLayout(getContext());
            box.addView(frame, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
            WebView w = makeWebView();
            w.getSettings().setSupportMultipleWindows(true);
            w.getSettings().setJavaScriptCanOpenWindowsAutomatically(true);
            w.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                    Uri u = r.getUrl();
                    if ("api-v2.soundcloud.com".equals(u.getHost())) {
                        String c = u.getQueryParameter("client_id");
                        if (c != null && !c.isEmpty()) cid[0] = c;
                    }
                    return null;
                }
            });
            // всплывашки Google/Apple — поверх, в той же куке-банке
            w.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onCreateWindow(WebView view, boolean dialog, boolean user, Message msg) {
                    WebView pop = makeWebView();
                    pop.setWebViewClient(new WebViewClient());
                    pop.setWebChromeClient(new WebChromeClient() {
                        @Override
                        public void onCloseWindow(WebView win) {
                            frame.removeView(win);
                            win.destroy();
                        }
                    });
                    frame.addView(pop, new FrameLayout.LayoutParams(-1, -1));
                    ((WebView.WebViewTransport) msg.obj).setWebView(pop);
                    msg.sendToTarget();
                    return true;
                }
            });
            frame.addView(w, new FrameLayout.LayoutParams(-1, -1));
            w.loadUrl(url);

            // отступы под статус-бар и жестовую полоску
            ViewCompat.setOnApplyWindowInsetsListener(box, (v, insets) -> {
                Insets s = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
                v.setPadding(s.left, s.top, s.right, s.bottom);
                return WindowInsetsCompat.CONSUMED;
            });
            d.setContentView(box);
            d.setOnCancelListener(x -> closeSite(false, null));
            d.setOnKeyListener((dlg, code, ev) -> {
                // «назад» сначала листает историю сайта, потом закрывает
                if (code == android.view.KeyEvent.KEYCODE_BACK && ev.getAction() == android.view.KeyEvent.ACTION_UP) {
                    if (frame.getChildCount() > 1) {
                        View top = frame.getChildAt(frame.getChildCount() - 1);
                        frame.removeView(top);
                        ((WebView) top).destroy();
                    } else if (w.canGoBack()) w.goBack();
                    else closeSite(false, null);
                    return true;
                }
                return false;
            });
            siteDialog = d;
            d.show();

            sitePoll = new Runnable() {
                @Override
                public void run() {
                    if (siteDialog != d) return;
                    JSObject res = null;
                    if ("token".equals(waitFor)) {
                        String tok = cookie("oauth_token");
                        if (tok != null && !tok.isEmpty()) {
                            res = new JSObject();
                            res.put("token", tok);
                            res.put("clientId", cid[0]);
                        }
                    } else {
                        String dd = cookie("datadome");
                        if (dd != null && !dd.equals(before)) res = new JSObject();
                    }
                    if (res != null) closeSite(true, res);
                    else ui.postDelayed(this, 800);
                }
            };
            ui.postDelayed(sitePoll, 800);
        });
    }

    private void closeSite(boolean ok, JSObject res) {
        if (sitePoll != null) ui.removeCallbacks(sitePoll);
        sitePoll = null;
        Dialog d = siteDialog;
        siteDialog = null;
        if (d != null) {
            d.setOnCancelListener(null);
            d.dismiss();
        }
        CookieManager.getInstance().flush();
        PluginCall c = siteCall;
        siteCall = null;
        if (c == null) return;
        JSObject ret = res != null ? res : new JSObject();
        ret.put("ok", ok);
        c.resolve(ret);
    }

    @PluginMethod
    public void logout(PluginCall call) {
        ui.post(() -> {
            CookieManager.getInstance().removeAllCookies(v -> {
                CookieManager.getInstance().flush();
                call.resolve();
            });
            WebStorage.getInstance().deleteAllData();
        });
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        if (url.startsWith("https://")) {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void minimize(PluginCall call) {
        getActivity().moveTaskToBack(true);
        call.resolve();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView makeWebView() {
        WebView w = new WebView(getContext());
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUserAgentString(DESKTOP_UA);
        w.setBackgroundColor(Color.parseColor("#121212"));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);
        return w;
    }

    private int dp(int v) {
        return Math.round(v * getContext().getResources().getDisplayMetrics().density);
    }
}
