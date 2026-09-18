package ug.homatt.health;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The two strips the app does not draw: the one with the clock, and the one
 * with the back gesture.
 *
 * <p>A clinic chose Midnight blue and photographed a green bar above the app
 * and a green bar below it. Both were {@code #1B5E20}, and neither could
 * follow the setting, because:
 *
 * <ul>
 *   <li>{@code res/values/styles.xml} pins {@code android:statusBarColor} and
 *       {@code android:navigationBarColor} to {@code @color/colorPrimaryDark}.
 *       That is a COMPILED resource. Nothing served over the air can reach it
 *       — a fact worth stating plainly, because this whole app is built around
 *       screens that update themselves and it is easy to assume everything
 *       does.
 *   <li>{@code @capacitor/status-bar} can move the top bar at runtime, which
 *       is why the top one is fixable without a new install. It has no
 *       navigation-bar API at all, so the bottom one needs this.
 * </ul>
 *
 * <h3>Why the icons are a boolean and not a colour</h3>
 *
 * <p>Android draws the clock and the gesture pill itself and takes only
 * "light" or "dark" for them. The web side works that out from the chrome
 * colour's own luminance and passes it in, so the bar and the things drawn on
 * it cannot disagree — a stored pair can be half-updated, and a status bar
 * whose clock matches its own background is an invisible clock.
 *
 * <h3>Version floors, which are different for the two bars</h3>
 *
 * <ul>
 *   <li>Colouring either bar is API 21. minSdk here is 22, so both are always
 *       available.
 *   <li>DARK icons on the status bar are API 23; on the navigation bar API 26.
 *       {@link WindowInsetsControllerCompat} answers for both and simply does
 *       nothing below those floors — which is the correct behaviour rather
 *       than a compromise, because every skin this app ships has a dark
 *       chrome colour and therefore wants light icons, and light icons are
 *       what an older Android draws anyway.
 * </ul>
 *
 * <p>{@code FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS} has to be set and the two
 * TRANSLUCENT flags cleared, or the colour is accepted and silently ignored —
 * the system keeps drawing its own scrim over the top and nothing reports a
 * problem.
 */
@CapacitorPlugin(name = "HomattChrome")
public class HomattChromePlugin extends Plugin {

    private static final String PREFS = "homatt_chrome";
    private static final String KEY_COLOUR = "colour";
    private static final String KEY_LIGHT_ICONS = "lightIcons";

    /**
     * Paint the bars the colour this app was last set to, before the WebView
     * has drawn anything.
     *
     * <p>Without this every launch shows the compiled {@code colorPrimaryDark}
     * green for as long as the WebView takes to boot, load the stylesheet and
     * run a script — a second or more on the phones this runs on — and only
     * then snaps to the clinic's own colour. A green flash on every single
     * launch is exactly the thing that was reported, just briefer, and
     * "it fixed itself after a moment" is not a fix anybody should have to
     * notice.
     *
     * <p>Read from SharedPreferences rather than from the web app's own
     * storage because localStorage lives inside the WebView, which is the
     * thing that has not started yet. The two are kept in step by the plugin
     * writing here on every successful {@link #set}, so the remembered value
     * is always the last one actually shown.
     *
     * <p>Silent when nothing has been remembered — a brand-new install has no
     * skin yet, and the compiled colour is the right answer for that one
     * launch.
     */
    static void applyRemembered(Activity activity) {
        if (activity == null) return;
        try {
            android.content.SharedPreferences p =
                activity.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
            String colour = p.getString(KEY_COLOUR, null);
            if (colour == null) return;
            paint(activity, Color.parseColor(colour), p.getBoolean(KEY_LIGHT_ICONS, true));
        } catch (Exception e) {
            // A remembered colour that will not parse is not worth a crash on
            // launch. The compiled one shows instead, which is what happened
            // before any of this existed.
        }
    }

    /** The actual window work, shared by the remembered path and the live one. */
    private static void paint(Activity activity, int colour, boolean lightIcons) {
        Window window = activity.getWindow();

        /* Without these three the colour is accepted and ignored: the system
         * goes on drawing its own translucent scrim and nothing reports it. */
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

        window.setStatusBarColor(colour);
        window.setNavigationBarColor(colour);

        /* Android 10+ draws its own contrast scrim behind the gesture pill,
         * which turns a chosen colour into an approximation of it. The
         * contrast here is measured rather than guessed, so the colour asked
         * for is the one to show. */
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
        }

        WindowInsetsControllerCompat bars =
            new WindowInsetsControllerCompat(window, window.getDecorView());
        // "appearance light" means LIGHT BARS, i.e. DARK icons — the opposite
        // of what the parameter is called at the call site. Inverted once,
        // here, in writing, rather than at each of the places that ask.
        bars.setAppearanceLightStatusBars(!lightIcons);
        bars.setAppearanceLightNavigationBars(!lightIcons);
    }

    /**
     * Colour both bars and say which way the icons go.
     *
     * @param call {@code color} — "#RRGGBB" or "#RGB"; {@code lightIcons} —
     *             true for light content (the usual case here, since every
     *             skin's chrome is dark).
     */
    @PluginMethod
    public void set(PluginCall call) {
        final String colour = call.getString("color");
        final boolean lightIcons = Boolean.TRUE.equals(call.getBoolean("lightIcons", Boolean.TRUE));

        final int parsed;
        try {
            parsed = Color.parseColor(colour);
        } catch (Exception e) {
            // A colour that will not parse is a bug in the caller, and painting
            // a guess over somebody's screen is worse than refusing.
            call.reject("Not a colour this phone can read: " + colour, "bad-colour");
            return;
        }

        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("No window to paint.", "no-activity");
            return;
        }

        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    paint(activity, parsed, lightIcons);

                    /* Remembered only AFTER it has actually been applied, so
                     * the value read on the next launch is one this phone is
                     * known to accept rather than one it was merely asked for. */
                    activity.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
                        .edit()
                        .putString(KEY_COLOUR, colour)
                        .putBoolean(KEY_LIGHT_ICONS, lightIcons)
                        .apply();

                    JSObject out = new JSObject();
                    out.put("applied", true);
                    out.put("color", colour);
                    out.put("lightIcons", lightIcons);
                    call.resolve(out);
                } catch (Exception e) {
                    call.reject("The phone would not take the bar colour.", "failed", e);
                }
            }
        });
    }
}
