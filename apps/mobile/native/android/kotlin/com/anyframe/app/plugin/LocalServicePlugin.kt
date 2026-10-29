package com.anyframe.app.plugin

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import com.anyframe.app.service.LocalHttpService
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * ─────────────────────────────────────────────────────────────
 * AnyFrameLocalService —— Capacitor 插件（Android 侧）
 * ─────────────────────────────────────────────────────────────
 * TS 绑定见 apps/mobile/src/native/local-service.ts，
 * 两边的方法名与返回结构必须逐字一致，否则前端拿到 undefined。
 *
 * 这个插件只负责「把服务拉起来 + 报告状态」，
 * HTTP 协议实现全在 LocalHttpService.kt 里。
 *
 * ── 注册方式 ───────────────────────────────────────────────
 * 在 MainActivity 里注册（setup-native.mjs 会自动插入）：
 *
 *     override fun onCreate(savedInstanceState: Bundle?) {
 *         registerPlugin(LocalServicePlugin::class.java)
 *         super.onCreate(savedInstanceState)
 *     }
 *
 * ⚠️ registerPlugin 必须在 super.onCreate() **之前**调用。
 *    放在之后的话插件注册不上，前端调用会一直挂在 promise 上
 *    既不 resolve 也不 reject —— 这是 Capacitor 最难查的问题之一。
 */
@CapacitorPlugin(
    name = "AnyFrameLocalService",
    permissions = [
        Permission(
            alias = LocalServicePlugin.ALIAS_NOTIFICATIONS,
            strings = [Manifest.permission.POST_NOTIFICATIONS],
        ),
    ],
)
class LocalServicePlugin : Plugin() {

    @PluginMethod
    fun start(call: PluginCall) {
        val port = call.getInt("port") ?: 0

        val intent = Intent(context, LocalHttpService::class.java).apply {
            putExtra(LocalHttpService.EXTRA_PORT, port)
        }

        // API 26+ 必须用 startForegroundService，用普通 startService 会抛
        // IllegalStateException: Not allowed to start service Intent ...
        // app is in background。
        //
        // 另外 Android 12（API 31）起，应用在后台时不允许启动前台服务，
        // 会抛 ForegroundServiceStartNotAllowedException。
        // 我们的调用来自 WebView 的用户操作，此时必然在前台，所以安全；
        // 但如果你想做「开机自启服务」，那需要用 WorkManager 或
        // BOOT_COMPLETED 广播 + 豁免，不能直接调这里。
        try {
            ContextCompat.startForegroundService(context, intent)
        } catch (e: Exception) {
            call.resolve(statusObject().put("reason", "启动前台服务被系统拒绝：${e.message}"))
            return
        }

        // startForegroundService 是异步的，服务真正监听端口需要几十毫秒。
        // 轮询等待而不是立即返回 —— 前端拿到 running=false 就会走降级 UI，
        // 造成「点一下没反应、再点一下就好了」的诡异体验。
        val deadline = System.currentTimeMillis() + 5_000
        Thread {
            while (System.currentTimeMillis() < deadline) {
                if (LocalHttpService.isRunning()) break
                Thread.sleep(50)
            }
            call.resolve(statusObject())
        }.start()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        context.stopService(Intent(context, LocalHttpService::class.java))
        // stopService → onDestroy 是异步的，稍等一下让端口真正释放，
        // 否则前端立刻再 start 会撞上 TIME_WAIT / 端口占用。
        Thread {
            Thread.sleep(200)
            call.resolve(statusObject())
        }.start()
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        call.resolve(statusObject())
    }

    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        // API 33 以下通知权限在安装时即授予，无需运行时申请
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(JSObject().put("granted", true))
            return
        }

        if (getPermissionState(ALIAS_NOTIFICATIONS) == PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true))
            return
        }

        // 异步：结果回到 @PermissionCallback 标注的方法
        requestPermissionForAlias(ALIAS_NOTIFICATIONS, call, "onNotificationPermission")
    }

    @PermissionCallback
    private fun onNotificationPermission(call: PluginCall) {
        val granted = getPermissionState(ALIAS_NOTIFICATIONS) == PermissionState.GRANTED
        call.resolve(JSObject().put("granted", granted))
    }

    @PluginMethod
    fun requestBatteryExemption(call: PluginCall) {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (pm == null) {
            call.resolve(JSObject().put("granted", false).put("supported", false))
            return
        }

        if (pm.isIgnoringBatteryOptimizations(context.packageName)) {
            call.resolve(JSObject().put("granted", true).put("supported", true))
            return
        }

        // 这个 Intent 需要 REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 权限。
        // 注意它弹的是系统对话框，不是设置页；部分厂商 ROM 会直接吞掉，
        // 所以 catch 之后退回打开设置页。
        try {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:${context.packageName}")
            }
            startActivityForResult(call, intent, "onBatteryExemption")
        } catch (e: Exception) {
            try {
                startActivityForResult(
                    call,
                    Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
                    "onBatteryExemption",
                )
            } catch (e2: Exception) {
                call.resolve(
                    JSObject()
                        .put("granted", false)
                        .put("supported", true)
                        .put("reason", "该 ROM 不支持直接跳转电池优化设置，请手动前往系统设置"),
                )
            }
        }
    }

    @ActivityCallback
    private fun onBatteryExemption(call: PluginCall, result: ActivityResult) {
        // 不管 resultCode 是什么，都以系统的真实状态为准 ——
        // 用户可能在设置页里绕了一圈才找到开关。
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val granted = pm?.isIgnoringBatteryOptimizations(context.packageName) ?: false
        call.resolve(JSObject().put("granted", granted).put("supported", true))
    }

    private fun statusObject(): JSObject {
        val port = LocalHttpService.boundPort.get()
        return JSObject().apply {
            put("running", port > 0)
            put("port", if (port > 0) port else JSObject.NULL)
            put("url", LocalHttpService.url() ?: JSObject.NULL)
            put("foreground", port > 0)
            put("platform", "android")
            LocalHttpService.currentReason?.let { put("reason", it) }
        }
    }

    companion object {
        const val ALIAS_NOTIFICATIONS = "notifications"
    }
}
