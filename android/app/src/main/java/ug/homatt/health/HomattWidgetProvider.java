package ug.homatt.health;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;

/**
 * The Homatt Clinic home-screen widget.
 *
 * <p>Three things a clinic does all day, one tap from the home screen: start a
 * treatment, look at who is still being treated, sell something over the
 * counter. Otherwise each of those is unlock, open the app, wait for the
 * dashboard to build itself, find the button — four taps while somebody is
 * standing in front of you, which are four taps of not listening to them.
 *
 * <h3>How a tap reaches the right screen</h3>
 *
 * <p>Through the deep link the manifest has advertised all along:
 * {@code homatt://app/…} on MainActivity, with {@code launchMode="singleTask"}.
 * Nothing in the web app had ever listened for it, so every such link arrived
 * and was dropped; {@code clinic-open.js} is the other half and now answers.
 *
 * <p>{@code singleTask} is what makes this behave: a tap on the widget while
 * the app is already open is delivered to the running activity through
 * {@code onNewIntent} rather than starting a second copy of the clinic on top
 * of the first — which, in an app holding a half-typed patient, would be its
 * own kind of harm.
 *
 * <h3>Two details that would otherwise fail on real phones</h3>
 *
 * <ul>
 *   <li><b>FLAG_IMMUTABLE is API 23, and this app's minSdk is 22.</b> From
 *       Android 12 a PendingIntent must declare mutability or the app crashes
 *       the moment it builds one; on 22 the constant does not exist. So it is
 *       added conditionally rather than unconditionally, which would not
 *       compile against minSdk, or omitted, which would crash on modern
 *       phones. Both halves matter and only one of them is obvious.
 *   <li><b>Each button needs its own request code.</b> PendingIntents that
 *       differ only in their extras are considered <i>equal</i> by the system,
 *       so three buttons built with the same request code collapse into one and
 *       every tap opens whichever was created last. This is the classic widget
 *       bug and it looks like a routing fault rather than a PendingIntent one.
 *       The data URI differs too, which is belt and braces.
 * </ul>
 */
public class HomattWidgetProvider extends AppWidgetProvider {

    /** The three targets, exactly as {@code clinic-open.js} names them. */
    private static final String GO_NEW    = "new-treatment";
    private static final String GO_ACTIVE = "active";
    private static final String GO_SALE   = "quick-sale";

    /** Distinct per button — see the note above about PendingIntent equality. */
    private static final int RC_APP    = 100;
    private static final int RC_NEW    = 101;
    private static final int RC_ACTIVE = 102;
    private static final int RC_SALE   = 103;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            manager.updateAppWidget(id, build(context));
        }
    }

    /**
     * Rebuild every placed copy of the widget. Called from
     * {@link #onUpdate} and available to the app itself, so that a change of
     * theme or language is not stuck on the home screen until Android decides
     * to refresh it.
     */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName me = new ComponentName(context, HomattWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(me);
        if (ids == null || ids.length == 0) return;
        for (int id : ids) {
            manager.updateAppWidget(id, build(context));
        }
    }

    private static RemoteViews build(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_homatt);
        views.setOnClickPendingIntent(R.id.widget_header, open(context, null,     RC_APP));
        views.setOnClickPendingIntent(R.id.widget_new,    open(context, GO_NEW,    RC_NEW));
        views.setOnClickPendingIntent(R.id.widget_active, open(context, GO_ACTIVE, RC_ACTIVE));
        views.setOnClickPendingIntent(R.id.widget_sale,   open(context, GO_SALE,   RC_SALE));
        return views;
    }

    /**
     * A tap that opens the app at one target. {@code target} of null is the
     * plain launch — the header strip keeps the ordinary way in available, so
     * somebody who wants the dashboard is not forced to choose one of three.
     */
    private static PendingIntent open(Context context, String target, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setPackage(context.getPackageName());
        if (target != null) {
            // The scheme the manifest already declares, and the shape
            // clinic-open.js parses.
            intent.setAction(Intent.ACTION_VIEW);
            intent.setData(Uri.parse("homatt://app/" + target));
        } else {
            intent.setAction(Intent.ACTION_MAIN);
        }
        /* FLAG_ACTIVITY_NEW_TASK because a widget tap comes from the launcher's
         * process and has no task of its own to attach to. SINGLE_TOP alongside
         * singleTask so an already-open app is handed the intent rather than
         * being torn down and rebuilt — which would lose a half-typed patient. */
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // Immutable: nothing outside this app may rewrite where it goes.
            // Required from Android 12, and unavailable before Android 6 —
            // which is why this is a runtime check and not a constant.
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(context, requestCode, intent, flags);
    }
}
