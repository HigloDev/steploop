package com.zxn.palou

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 直接读取 Android 系统 LocationManager。
 *
 * 部分国产 Android 机型的系统已经有网络/GPS位置，但 Google Fused Location
 * 不会把结果交给 Expo。地图选点使用此模块绕开 Fused Location 的兼容问题。
 */
@Suppress("DEPRECATION")
class AndroidLocationModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "AndroidSystemLocation"

  @ReactMethod
  fun getCurrentLocation(timeoutMs: Double, promise: Promise) {
    val context = reactApplicationContext
    val fineGranted =
      context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED
    val coarseGranted =
      context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED
    if (!fineGranted && !coarseGranted) {
      promise.reject("permission_denied", "location permission denied")
      return
    }

    val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val providers =
      listOf(
        LocationManager.NETWORK_PROVIDER,
        LocationManager.GPS_PROVIDER,
        LocationManager.PASSIVE_PROVIDER,
      ).filter { provider ->
        try {
          manager.isProviderEnabled(provider)
        } catch (_: Exception) {
          false
        }
      }

    if (providers.isEmpty()) {
      promise.reject("provider_disabled", "all location providers are disabled")
      return
    }

    val cached =
      providers.mapNotNull { provider ->
        try {
          manager.getLastKnownLocation(provider)
        } catch (_: SecurityException) {
          null
        }
      }.maxByOrNull { it.elapsedRealtimeNanos }

    // 系统两分钟内已经获得过位置时直接使用，避免每次都在室内等卫星。
    if (cached != null && ageMs(cached) <= 120_000L && cached.accuracy <= 500f) {
      promise.resolve(toMap(cached))
      return
    }

    val completed = AtomicBoolean(false)
    val handler = Handler(Looper.getMainLooper())
    lateinit var listener: LocationListener

    fun finish(location: Location?, code: String? = null, message: String? = null) {
      if (!completed.compareAndSet(false, true)) return
      try {
        manager.removeUpdates(listener)
      } catch (_: Exception) {
        // 定位已经结束，无需再处理清理异常。
      }
      if (location != null) {
        promise.resolve(toMap(location))
      } else {
        promise.reject(code ?: "location_unavailable", message ?: "location unavailable")
      }
    }

    listener =
      object : LocationListener {
        override fun onLocationChanged(location: Location) {
          finish(location)
        }

        override fun onProviderDisabled(provider: String) = Unit

        override fun onProviderEnabled(provider: String) = Unit

        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
      }

    handler.post {
      try {
        // 网络定位通常可在室内快速返回；GPS可在室外提供更精确的位置。
        providers
          .filter { it != LocationManager.PASSIVE_PROVIDER }
          .forEach { provider ->
            manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
          }
        handler.postDelayed(
          {
            // 实时位置未返回时，允许使用三十分钟内的系统缓存位置。
            val fallback = cached?.takeIf { ageMs(it) <= 1_800_000L && it.accuracy <= 1000f }
            finish(fallback, "location_timeout", "location timeout")
          },
          timeoutMs.toLong().coerceIn(5_000L, 15_000L),
        )
      } catch (error: SecurityException) {
        finish(null, "permission_denied", error.message)
      } catch (error: Exception) {
        finish(null, "location_error", error.message)
      }
    }
  }

  private fun ageMs(location: Location): Long {
    return ((SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000L)
      .coerceAtLeast(0L)
  }

  private fun toMap(location: Location) =
    Arguments.createMap().apply {
      putDouble("latitude", location.latitude)
      putDouble("longitude", location.longitude)
      putDouble("accuracy", location.accuracy.toDouble())
      if (location.hasAltitude()) putDouble("altitude", location.altitude) else putNull("altitude")
      putString("provider", location.provider ?: "android")
      putDouble("timestamp", location.time.toDouble())
    }
}
