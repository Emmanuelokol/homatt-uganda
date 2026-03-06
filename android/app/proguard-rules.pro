# Homatt Health ProGuard Rules

# Keep line number info for crash reporting
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Capacitor
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.annotation.JavascriptInterface <methods>;
}

# Capacitor plugins
-keep class com.capacitorjs.** { *; }

# WebView JS bridge
-keepclassmembers class * extends android.webkit.WebViewClient {
    public void *(android.webkit.WebView, java.lang.String, android.graphics.Bitmap);
    public boolean *(android.webkit.WebView, java.lang.String);
}
-keepclassmembers class * extends android.webkit.WebChromeClient {
    public void *(android.webkit.WebView, java.lang.String);
}

# AndroidX
-keep class androidx.** { *; }
-dontwarn androidx.**

# Supabase / OkHttp (used via WebView network)
-dontwarn okhttp3.**
-dontwarn okio.**

# Keep all annotations
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes Exceptions

# Don't warn about missing classes in optional features
-dontwarn com.google.android.gms.**
-dontwarn com.google.firebase.**
