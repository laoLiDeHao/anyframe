package com.anyframe.app.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.io.File
import java.util.UUID
import java.net.Inet4Address
import java.net.NetworkInterface
import org.json.JSONArray

/** Runs libnode once in the dedicated :node process; the WebView process never loads it. */
class LocalHttpService : Service() {
    private var started = false
    private external fun runNode(args: Array<String>): Int

    private fun copyAssetTree(source: String, target: File) {
        val children = assets.list(source) ?: emptyArray()
        if (children.isEmpty()) {
            target.parentFile?.mkdirs()
            assets.open(source).use { input -> target.outputStream().use { input.copyTo(it) } }
        } else {
            target.mkdirs()
            children.forEach { copyAssetTree("$source/$it", File(target, it)) }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, "Node 服务", NotificationManager.IMPORTANCE_LOW))
            val open = packageManager.getLaunchIntentForPackage(packageName)
            val notification = NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("AnyFrame · Node 服务运行中")
                .setContentText("在应用内管理 HTTP / WebSocket 服务")
                .setOngoing(true)
                .apply { if (open != null) setContentIntent(PendingIntent.getActivity(this@LocalHttpService, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)) }
                .build()
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(NOTIFICATION_ID, notification)
        } catch (e: Exception) {
            File(filesDir, ERROR_FILE).writeText("前台服务启动失败：${e.message}")
            stopSelf()
            return START_NOT_STICKY
        }
        if (started) return START_NOT_STICKY
        started = true
        File(filesDir, READY_FILE).delete()
        File(filesDir, ERROR_FILE).delete()
        File(filesDir, "node-console.log").delete()
        Thread(null, Runnable {
            try {
                val runtime = File(filesDir, "node-runtime").apply { mkdirs() }
                val script = File(runtime, "main.cjs")
                  copyAssetTree("node-runtime/services", File(runtime, "services"))
                assets.open("node-runtime/main.cjs").use { input -> script.outputStream().use { input.copyTo(it) } }
                val bootstrap = File(runtime, "bootstrap.cjs")
                assets.open("node-runtime/bootstrap.cjs").use { input -> bootstrap.outputStream().use { input.copyTo(it) } }
                File(filesDir, "node-stage.txt").writeText("加载内嵌 libnode")
                System.loadLibrary("node")
                System.loadLibrary("anyframe_node")
                val version = packageManager.getPackageInfo(packageName, 0).versionName ?: "0.0.2"
                val addresses = JSONArray()
                try {
                    NetworkInterface.getNetworkInterfaces()?.toList()?.forEach { network ->
                        network.inetAddresses.toList().filter { it is Inet4Address && !it.isLoopbackAddress }
                            .forEach { addresses.put(it.hostAddress) }
                    }
                } catch (_: Exception) { /* The service can still listen even if enumeration is restricted. */ }
                File(filesDir, "node-stage.txt").writeText("已加载原生库，进入 Node 启动入口")
                val code = runNode(arrayOf("node", bootstrap.absolutePath, filesDir.absolutePath,
                    File(filesDir, READY_FILE).absolutePath, UUID.randomUUID().toString(), version, addresses.toString()))
                if (code != 0 && !File(filesDir, ERROR_FILE).exists()) File(filesDir, ERROR_FILE).writeText("Node 退出码：$code")
            } catch (e: Throwable) {
                File(filesDir, ERROR_FILE).writeText("Node 启动失败：${e.stackTraceToString()}")
            } finally {
                File(filesDir, READY_FILE).delete()
                stopSelf()
            }
        }, "anyframe-node", 8L * 1024 * 1024).start()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        File(filesDir, READY_FILE).delete()
        super.onDestroy()
        // node::Start cannot run twice in one process. Kill only :node for a fresh VM next start.
        android.os.Process.killProcess(android.os.Process.myPid())
    }

    companion object {
        const val EXTRA_PORT = "port" // legacy option; RPC now uses an ephemeral loopback port
        const val READY_FILE = "node-ready.json"
        const val ERROR_FILE = "node-error.txt"
        private const val CHANNEL = "anyframe-local-service"
        private const val NOTIFICATION_ID = 0x4146
    }
}
