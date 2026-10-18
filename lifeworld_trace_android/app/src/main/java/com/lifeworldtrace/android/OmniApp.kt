package com.lifeworldtrace.android

import android.app.Application
import com.lifeworldtrace.android.host.OmniPaths
import com.lifeworldtrace.android.map.TileStore
import com.lifeworldtrace.android.ui.ShellTheme
import java.io.File

class OmniApp : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
        ShellTheme.apply(this)
        TileStore.init(File(OmniPaths.dataRoot(this), "cache/map_tiles"))
        TileStore.setSource(com.lifeworldtrace.android.map.MapPrefs.source(this))
    }

    companion object {
        lateinit var instance: OmniApp
            private set
    }
}
