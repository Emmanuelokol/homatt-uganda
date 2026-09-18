package ug.homatt.health;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        /* BEFORE super.onCreate, which is where Capacitor 6 builds its bridge
         * and reads the plugin list. Registered after it, the plugin exists in
         * Java and is simply not there for JavaScript — which fails as a
         * missing method rather than as an error anybody could act on. */
        registerPlugin(HomattWidgetPlugin.class);
        registerPlugin(HomattChromePlugin.class);

        // Install splash screen BEFORE super.onCreate
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        // Keep splash visible until WebView is ready (Capacitor signals this)
        splashScreen.setKeepOnScreenCondition(() -> false);

        // Edge-to-edge: let content draw behind status/nav bars.
        // Do NOT use FLAG_LAYOUT_NO_LIMITS — it breaks soft keyboard resize on
        // Android 11+ and causes a black screen when any input is focused.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        /* The bars, the colour this clinic last chose, BEFORE the WebView has
         * drawn anything. The page works the colour out and hands it over, but
         * that costs a WebView boot, a stylesheet and a script — a second or
         * more on these phones — and until then the compiled green shows. A
         * green flash on every launch is the reported bug in miniature.
         * AFTER setDecorFitsSystemWindows, which itself touches the window. */
        HomattChromePlugin.applyRemembered(this);
    }
}
