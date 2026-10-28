# ─────────────────────────────────────────────────────────────
# ProGuard / R8 规则（追加到 android/app/proguard-rules.pro）
# ─────────────────────────────────────────────────────────────
# build.gradle 里开了 minifyEnabled true，这些规则是配套的。
# 少了它们，release 包能装上、能打开，但所有 Capacitor 插件调用
# 都会永久挂起 —— 因为 Capacitor 靠注解 + 反射找方法，
# R8 把类名和方法名改掉之后就再也对不上了。
#
# 排查线索：logcat 里会有
#   "Unable to find plugin: AnyFrameLocalService"
# 或 JS 侧 promise 永远不 resolve。

# ── Capacitor 核心 ──────────────────────────────────────────
# 插件注册、桥接方法全靠反射
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-dontwarn com.getcapacitor.**

# 注解本身必须保留，否则 R8 无法识别 -keep 里的注解条件
-keep @interface com.getcapacitor.annotation.CapacitorPlugin
-keep @interface com.getcapacitor.annotation.PluginMethod
-keep @interface com.getcapacitor.annotation.PermissionCallback
-keep @interface com.getcapacitor.annotation.ActivityCallback
-keep @interface com.getcapacitor.annotation.Permission

# ── 官方插件 ────────────────────────────────────────────────
# 每个 @capacitor/* 插件都带一个原生实现类，同样走反射。
# 用通配覆盖，避免以后新增插件时忘记加规则。
-keep class com.capacitorjs.plugins.** { *; }
-dontwarn com.capacitorjs.plugins.**

# ── 本项目自研插件与服务 ────────────────────────────────────
# 带 @PluginMethod / @PermissionCallback / @ActivityCallback 的方法
# 由 JS 侧按名字调用，方法名一旦被混淆就调不到。
-keep @com.getcapacitor.annotation.CapacitorPlugin class * {
    @com.getcapacitor.annotation.PluginMethod <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}

# LocalHttpService 在 AndroidManifest.xml 里以全限定名声明，
# R8 不知道 Manifest 的引用关系（AGP 通常会处理，但 service 的
# 内部方法不会被引用到），显式保留最稳妥。
-keep class com.anyframe.app.service.LocalHttpService { *; }
-keep class com.anyframe.app.plugin.LocalServicePlugin { *; }
-keep class com.anyframe.app.MainActivity { *; }

# ── Cordova 兼容层 ──────────────────────────────────────────
# Capacitor 仍然支持 Cordova 插件，模板里带了这个依赖
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**

# ── androidx ────────────────────────────────────────────────
# NotificationCompat 用 ServiceLoader 找实现，混淆后会失效
-keep class androidx.core.app.NotificationCompat** { *; }
-dontwarn androidx.**

# ── 通用 ────────────────────────────────────────────────────
# 保留行号，崩溃栈才有意义。
# 配合 CI 上传 mapping.txt 到 Sentry / Firebase Crashlytics 做还原。
# 不上传 mapping 的话，这两行只能让栈里出现真实行号但类名仍是 a.b.c。
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# 泛型签名不能丢：Gson / kotlinx.serialization 之类靠它反序列化
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# ── 构建产物提醒 ────────────────────────────────────────────
# 开启 minify 后，每次 release 构建都会在
#   android/app/build/outputs/mapping/release/mapping.txt
# 生成混淆映射。发布时必须归档它，否则线上崩溃栈无法还原。
# CI 里已把它作为 artifact 上传（见 .github/workflows/build.yml）。
