package ug.homatt.health;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Install splash screen BEFORE super.onCreate
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        // Keep splash visible until WebView is ready (Capacitor signals this)
        splashScreen.setKeepOnScreenCondition(() -> false);

        // Edge-to-edge: let content draw behind status/nav bars.
        // Do NOT use FLAG_LAYOUT_NO_LIMITS — it breaks soft keyboard resize on
        // Android 11+ and causes a black screen when any input is focused.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    }
}
