package com.anyframe.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * ─────────────────────────────────────────────────────────────
 * 内嵌本地服务（Android 前台服务）
 * ─────────────────────────────────────────────────────────────
 * 在 App 进程内起一个只监听 127.0.0.1 的 HTTP 服务，
 * 协议与桌面端 / Agent 完全一致：
 *
 *     GET  /healthz                → { ok:true, v, data:{alive:true} }
 *     POST /rpc/<method>           → { ok:true, v, data } | { ok:false, v, error }
 *
 * 所以 WebView 里用的还是同一个 RpcClient，UI 代码五端通用。
 *
 * ── 为什么必须是前台服务 ───────────────────────────────────
 * Android 8.0（API 26）起，后台服务会在几分钟内被系统停止；
 * 应用切到后台后普通 Service 基本等于没有。
 * 唯一能长期存活的方式是 Foreground Service + 常驻通知。
 *
 * ── 为什么类型是 specialUse ────────────────────────────────
 * Android 15（API 35）给 dataSync 加了 6 小时/24 小时 的硬时限，
 * 超时直接杀服务。常驻运行时只能用没有时限的 specialUse。
 * 代价是 AndroidManifest 里要写 <property> 说明用途，
 * 且必须在 Play Console 的「前台服务类型」里同步申报。
 *
 * ── 厂商 ROM 的现实 ────────────────────────────────────────
 * 小米 / 华为 / OPPO / vivo 会无视官方的前台服务豁免，
 * 在息屏后一段时间直接杀进程。代码层面无法根治，
 * 只能引导用户关闭电池优化（见 LocalServicePlugin.requestBatteryExemption）。
 * 这是「移动端 background = foreground-only 而非 persistent」的原因。
 *
 * ── 这个文件是「参考实现」──────────────────────────────────
 * 它把服务生命周期、通知、端口分配、HTTP 解析这些**平台相关的坑**
 * 都填好了；业务方法（fs.* / service.*）目前只实现 capabilities.get，
 * 其余返回 UNSUPPORTED，留给你的实现按 contract.ts 补齐。
 */
class LocalHttpService : Service() {

    private val running = AtomicBoolean(false)
    private var serverSocket: ServerSocket? = null
    private var acceptThread: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val requestedPort = intent?.getIntExtra(EXTRA_PORT, 0) ?: 0

        // 通知权限没拿到就 startForeground 会抛 SecurityException（API 33+），
        // 或者更糟：不抛异常但服务被判为无效前台服务，几秒后被杀。
        try {
            promoteToForeground()
        } catch (e: Exception) {
            currentReason = "无法进入前台状态：${e.message}"
            stopSelf()
            return START_NOT_STICKY
        }

        if (running.get()) return START_STICKY

        try {
            val port = startHttp(requestedPort)
            boundPort.set(port)
            currentReason = null
            updateNotification()
        } catch (e: Exception) {
            currentReason = "监听端口失败：${e.message}"
            stopSelf()
        }

        // START_STICKY：被系统杀掉后尝试重建。
        // 注意国产 ROM 上这条经常不生效，别把它当成保活手段。
        return START_STICKY
    }

    override fun onDestroy() {
        stopHttp()
        super.onDestroy()
    }

    // ── 前台通知 ────────────────────────────────────────────

    private fun promoteToForeground() {
        val notification = buildNotification()

        // API 34（UPSIDE_DOWN_CAKE）起，startForeground 必须显式传类型，
        // 且该类型必须在 Manifest 里声明过，否则抛
        // MissingForegroundServiceTypeException。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
        mgr.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "本地服务",
                // 用 LOW 而不是 HIGH：常驻通知不该发声、不该弹出横幅
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "AnyFrame 内嵌本地服务的运行状态"
                setShowBadge(false)
            },
        )
    }

    private fun buildNotification(): Notification {
        val port = boundPort.get()
        val text = if (port > 0) "运行中 · 127.0.0.1:$port" else "正在启动…"

        // 点击通知回到 App。FLAG_IMMUTABLE 在 API 31+ 是强制的，
        // 不传会直接抛 IllegalArgumentException。
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pending = openIntent?.let {
            PendingIntent.getActivity(
                this, 0, it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("AnyFrame 本地服务")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .apply { if (pending != null) setContentIntent(pending) }
            .build()
    }

    private fun updateNotification() {
        val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        mgr.notify(NOTIFICATION_ID, buildNotification())
    }

    // ── HTTP 服务 ───────────────────────────────────────────

    /**
     * 从 startPort 开始探测空闲端口。
     * 端口冲突在移动端并不罕见：同一个 App 被多开（分身/工作资料）时，
     * 两个进程会抢同一个端口，所以必须能自动往后挪。
     */
    private fun startHttp(startPort: Int): Int {
        val loopback = InetAddress.getByName("127.0.0.1")
        val base = if (startPort in 1..65535) startPort else DEFAULT_PORT

        var socket: ServerSocket? = null
        var port = base
        for (attempt in 0 until PORT_SPAN) {
            try {
                socket = ServerSocket(port, 16, loopback)
                break
            } catch (e: Exception) {
                socket = null
                port++
            }
        }
        if (socket == null) error("在 $base..${base + PORT_SPAN - 1} 内找不到空闲端口")

        serverSocket = socket
        running.set(true)

        acceptThread = Thread({
            // 降低优先级：这是辅助设施，不该和 UI 线程抢 CPU
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)
            while (running.get()) {
                // 写成语句形式而不是 `val client = try {...} catch {...}`：
                // Kotlin 不允许在「作为表达式的 try」里用 break / continue。
                val client: Socket
                try {
                    client = socket.accept()
                } catch (e: Exception) {
                    if (!running.get()) break
                    continue
                }
                // 每个连接一个线程。本地回环、单用户、并发极低，
                // 不值得引入协程或线程池的复杂度。
                Thread({ handle(client) }, "anyframe-http").start()
            }
        }, "anyframe-accept").apply { isDaemon = true; start() }

        return socket.localPort
    }

    private fun stopHttp() {
        running.set(false)
        boundPort.set(0)
        try { serverSocket?.close() } catch (_: Exception) {}
        try { acceptThread?.interrupt() } catch (_: Exception) {}
        serverSocket = null
        acceptThread = null
    }

    private fun handle(client: Socket) {
        client.use { sock ->
            sock.tcpNoDelay = true
            // 读超时必须有：否则一个不完整的请求就能永久占住一个线程
            sock.soTimeout = 10_000

            val reader = BufferedReader(InputStreamReader(sock.inputStream, Charsets.UTF_8))
            val requestLine = reader.readLine() ?: return
            val parts = requestLine.split(" ")
            if (parts.size < 2) return
            val method = parts[0]
            val path = parts[1]

            var contentLength = 0
            var origin: String? = null
            while (true) {
                val line = reader.readLine() ?: break
                if (line.isEmpty()) break
                val idx = line.indexOf(':')
                if (idx <= 0) continue
                val key = line.substring(0, idx).trim().lowercase()
                val value = line.substring(idx + 1).trim()
                when (key) {
                    "content-length" -> contentLength = value.toIntOrNull() ?: 0
                    "origin" -> origin = value
                }
            }

            val body = if (contentLength > 0) {
                if (contentLength > MAX_BODY) {
                    write(sock, 413, envelope(false, JSONObject().put("code", "VALIDATION").put("message", "请求体超过 8MB 上限")), origin)
                    return
                }
                val buf = CharArray(contentLength)
                var read = 0
                while (read < contentLength) {
                    val n = reader.read(buf, read, contentLength - read)
                    if (n < 0) break
                    read += n
                }
                String(buf, 0, read)
            } else ""

            when {
                method == "OPTIONS" -> write(sock, 204, "", origin)
                method == "GET" && path == "/healthz" ->
                    write(sock, 200, envelope(true, JSONObject().put("alive", true).put("v", PROTOCOL_VERSION)), origin)
                method == "POST" && path.startsWith("/rpc/") ->
                    dispatch(sock, path.removePrefix("/rpc/"), body, origin)
                else ->
                    write(sock, 404, envelope(false, JSONObject().put("code", "NOT_FOUND").put("message", "未知路由")), origin)
            }
        }
    }

    /**
     * 方法分发。
     *
     * 只有 capabilities.get 是必须实现的 —— 前端靠它决定 UI 形态。
     * 其余方法在填实现之前一律返回 UNSUPPORTED，
     * 前端会显示 reason() 的平台说明文案，而不是一个裸的报错。
     *
     * 要补的方法见 packages/core/src/contract.ts 的 methods 表：
     *   fs.read / fs.write / fs.list / fs.remove
     *   service.start / service.stop / service.list / service.logs
     * 入参出参必须与桌面端 NodeFsProvider / ServiceManager 一致，
     * 这样五端可以共用同一套集成测试。
     */
    private fun dispatch(sock: Socket, methodName: String, body: String, origin: String?) {
        when (methodName) {
            "capabilities.get" -> {
                val caps = JSONObject()
                    .put("host", "capacitor")
                    .put("platform", "android")
                    .put("arch", System.getProperty("os.arch") ?: "arm64")
                    .put("version", Build.VERSION.RELEASE ?: "0")
                    .put("service", "embedded")
                    .put("background", "foreground-only")
                    .put("fileSystem", "scoped")
                    .put("device", JSONObject()
                        .put("serial", false)
                        .put("usb", false)
                        .put("hid", false)
                        // BLE 是移动端唯一五端通用的硬件通道
                        .put("ble", packageManager.hasSystemFeature("android.hardware.bluetooth_le")))
                write(sock, 200, envelope(true, caps), origin)
            }
            else -> write(
                sock, 501,
                envelope(false, JSONObject()
                    .put("code", "UNSUPPORTED")
                    .put("message", "$methodName 在 Android 端尚未实现")),
                origin,
            )
        }
    }

    private fun envelope(ok: Boolean, payload: JSONObject): String {
        return JSONObject()
            .put("ok", ok)
            .put("v", PROTOCOL_VERSION)
            .put(if (ok) "data" else "error", payload)
            .toString()
    }

    private fun write(sock: Socket, status: Int, body: String, origin: String?) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        val reason = STATUS_TEXT[status] ?: "OK"
        val head = buildString {
            append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n")
            append("Content-Type: application/json; charset=utf-8\r\n")
            append("Content-Length: ").append(bytes.size).append("\r\n")
            // 常驻服务禁止缓存，否则前端拿到旧的能力表
            append("Cache-Control: no-store\r\n")
            // WebView 的源是 https://localhost，服务是 http://127.0.0.1，
            // 属于跨源请求，必须回 CORS 头，否则 fetch 直接失败。
            // 这里回显请求的 Origin 而不是 '*'：带凭据时 '*' 无效，
            // 且回显便于将来加白名单。
            if (origin != null) {
                append("Access-Control-Allow-Origin: ").append(origin).append("\r\n")
                append("Vary: Origin\r\n")
                append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
                append("Access-Control-Allow-Headers: Content-Type, X-AnyFrame-Token\r\n")
                append("Access-Control-Max-Age: 86400\r\n")
            }
            append("Connection: close\r\n\r\n")
        }
        try {
            sock.getOutputStream().apply {
                write(head.toByteArray(Charsets.UTF_8))
                if (bytes.isNotEmpty()) write(bytes)
                flush()
            }
        } catch (_: Exception) {
            // 客户端提前断开是常态，不需要上报
        }
    }

    companion object {
        private const val CHANNEL_ID = "anyframe-local-service"
        private const val NOTIFICATION_ID = 0x4146
        const val EXTRA_PORT = "port"
        /** 与 packages/core 的桌面端 47800、Agent 47900 错开 */
        const val DEFAULT_PORT = 47810
        const val PORT_SPAN = 40
        const val PROTOCOL_VERSION = "1"
        private const val MAX_BODY = 8 * 1024 * 1024

        private val STATUS_TEXT = mapOf(
            200 to "OK", 204 to "No Content", 404 to "Not Found",
            413 to "Payload Too Large", 501 to "Not Implemented",
        )

        /** 插件通过 companion 读状态，避免为此实现 bindService */
        val boundPort = AtomicInteger(0)

        /**
         * 最近一次启动失败的原因，直接透传给前端展示。
         * 移动端服务起不来的原因五花八门（通知权限、端口占用、ROM 限制），
         * 只返回 running=false 等于让用户和开发者都无从下手。
         * 不加 private set：外层类的实例方法需要写它。
         */
        var currentReason: String? = null

        fun isRunning(): Boolean = boundPort.get() > 0

        fun url(): String? = boundPort.get().takeIf { it > 0 }?.let { "http://127.0.0.1:$it" }

        fun isIgnoringBatteryOptimizations(ctx: Context): Boolean {
            val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
            return pm.isIgnoringBatteryOptimizations(ctx.packageName)
        }
    }
}
