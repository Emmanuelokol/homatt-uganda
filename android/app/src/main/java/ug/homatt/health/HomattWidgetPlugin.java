package ug.homatt.health;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Putting the widget on the home screen from INSIDE the app.
 *
 * <p>A clinic asked for this in as many words: "is there a way to add that
 * widget in the app itself instead of searching for it in the widgets". They
 * are right to ask. The launcher's widget drawer is several gestures deep, it
 * is in a different place on every Android skin sold in this market, and a
 * clinic that cannot find it concludes the feature does not exist.
 *
 * <p>{@link AppWidgetManager#requestPinAppWidget} is the platform's answer:
 * the app asks, Android shows its own confirmation, and the person taps once.
 *
 * <h3>Two reasons it can legitimately refuse, and they need different words</h3>
 *
 * <ul>
 *   <li><b>Android 7 or older.</b> The API arrived in Android 8 (API 26), and
 *       this app runs back to Android 5.1. On those phones there is no way for
 *       an app to place a widget at all and the only route is the drawer.
 *   <li><b>The launcher does not support it.</b>
 *       {@code isRequestPinAppWidgetSupported()} is a question about the
 *       LAUNCHER, not about Android — several of the skins common here answer
 *       no. The call would silently do nothing.
 * </ul>
 *
 * <p>Both are asked BEFORE anything is offered, because a button that does
 * nothing when tapped is worse than a sentence explaining where to look. The
 * screen says which of the two it is, so the answer fits the phone in the
 * clinic's hand rather than being generic advice.
 *
 * <p>There is no permission to request and nothing is placed without the
 * person confirming Android's own dialog — the app cannot put anything on
 * somebody's home screen by itself, which is as it should be.
 */
@CapacitorPlugin(name = "HomattWidget")
public class HomattWidgetPlugin extends Plugin {

    /** Distinct from every request code in the widget provider. */
    private static final int RC_PINNED = 200;

    /**
     * Can this phone place the widget from inside the app? Asked before the
     * button is shown, and answered with WHY, so the screen can say something
     * useful instead of hiding a control with no explanation.
     */
    @PluginMethod
    public void canPin(PluginCall call) {
        JSObject out = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            out.put("supported", false);
            out.put("reason", "android-too-old");
            call.resolve(out);
            return;
        }
        Context context = getContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        boolean supported = false;
        try {
            supported = manager.isRequestPinAppWidgetSupported();
        } catch (Exception e) {
            // Some launchers throw rather than answer. Treated as "no", which
            // is the safe direction: the manual route always works.
            supported = false;
        }
        out.put("supported", supported);
        out.put("reason", supported ? "" : "launcher-refuses");
        call.resolve(out);
    }

    /**
     * Ask Android to place the widget. It shows its own confirmation; the
     * person taps Add, or does not. This resolves as soon as the REQUEST was
     * accepted — not when the widget appears, because Android does not tell us
     * that synchronously and pretending otherwise would have the screen claim
     * something it does not know.
     */
    @PluginMethod
    public void pin(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("This phone's Android is too old to add a widget from inside an app.",
                "android-too-old");
            return;
        }
        Context context = getContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        try {
            if (!manager.isRequestPinAppWidgetSupported()) {
                call.reject("This phone's home screen does not let an app add a widget.",
                    "launcher-refuses");
                return;
            }
            ComponentName provider = new ComponentName(context, HomattWidgetProvider.class);

            /* A callback so the app can tell the difference between "the
             * person added it" and "the person dismissed the dialog" — which
             * otherwise look identical from here, and would have the screen
             * congratulate somebody who declined. */
            Intent done = new Intent(context, WidgetPinnedReceiver.class);
            done.setPackage(context.getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent callback = PendingIntent.getBroadcast(context, RC_PINNED, done, flags);

            boolean asked = manager.requestPinAppWidget(provider, null, callback);
            JSObject out = new JSObject();
            out.put("asked", asked);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("The home screen would not take the widget.", "failed", e);
        }
    }
}
