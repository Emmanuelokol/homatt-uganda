package ug.homatt.health;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Android's answer to "did they actually add it?".
 *
 * <p>{@code requestPinAppWidget} returns as soon as the DIALOG is shown, so
 * from the app's side "the person tapped Add" and "the person dismissed it"
 * look identical. Without this the Settings screen would congratulate somebody
 * who had just declined — which is a small lie, and the kind that makes a
 * clinic stop believing the rest of the screen.
 *
 * <p>This fires only on success. It writes a flag the web side reads, so the
 * message a clinician sees is about what happened rather than about what was
 * asked for.
 */
public class WidgetPinnedReceiver extends BroadcastReceiver {

    static final String PREFS = "homatt_widget";
    static final String KEY_PINNED_AT = "pinned_at";

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putLong(KEY_PINNED_AT, System.currentTimeMillis())
                .apply();
        } catch (Exception e) { /* the widget is on the screen either way */ }
        // Draw it now rather than waiting for the system's first update, so it
        // does not sit blank for a moment on a slow phone.
        try { HomattWidgetProvider.refreshAll(context); } catch (Exception e) {}
    }
}
