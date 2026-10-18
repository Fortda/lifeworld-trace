package com.lifeworldtrace.android.host

import android.content.Context
import com.lifeworldtrace.android.RecordService
import com.lifeworldtrace.android.modules.AppFocusModule
import com.lifeworldtrace.android.modules.DeviceModule
import com.lifeworldtrace.android.modules.EnvModule
import com.lifeworldtrace.android.modules.GpsModule
import com.lifeworldtrace.android.modules.HwModule
import com.lifeworldtrace.android.modules.ImuModule
import com.lifeworldtrace.android.modules.MediaModule
import com.lifeworldtrace.android.modules.PerfModule
import com.lifeworldtrace.android.modules.RadioModule
import com.lifeworldtrace.android.modules.TouchModule
import com.lifeworldtrace.android.modules.UiMapModule

/** 手机采集分模组清单；开关下次开始采集生效。默认全开。 */
object CaptureCatalog {
    data class Mod(val id: String, val label: String)

    val modules: List<Mod> = listOf(
        Mod("hw", "硬件清单"),
        Mod("device", "设备状态"),
        Mod("imu", "惯性"),
        Mod("env", "环境"),
        Mod("gps", "定位"),
        Mod("perf", "性能"),
        Mod("radio", "无线电"),
        Mod("media", "媒体占用"),
        Mod("app_focus", "前台应用"),
        Mod("touch", "点击"),
        Mod("ui_map", "窗栈"),
    )

    fun prefKey(id: String) = "mod_on_$id"

    fun enabled(ctx: Context, id: String): Boolean =
        ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)
            .getBoolean(prefKey(id), true)

    fun setEnabled(ctx: Context, id: String, on: Boolean) {
        ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(prefKey(id), on)
            .apply()
    }

    fun create(id: String): TraceModule? = when (id) {
        "hw" -> HwModule()
        "device" -> DeviceModule()
        "imu" -> ImuModule()
        "env" -> EnvModule()
        "gps" -> GpsModule()
        "perf" -> PerfModule()
        "radio" -> RadioModule()
        "media" -> MediaModule()
        "app_focus" -> AppFocusModule()
        "touch" -> TouchModule()
        "ui_map" -> UiMapModule()
        else -> null
    }

    fun createEnabled(ctx: Context): List<TraceModule> =
        modules.mapNotNull { if (enabled(ctx, it.id)) create(it.id) else null }
}
