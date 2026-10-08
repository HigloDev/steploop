package com.zxn.palou

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/** RN bridge matching this app's existing native LocationManager integration. */
class AndroidTrainingModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val handler = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private var listenerCount = 0
  private val listener: (JSONObject) -> Unit = { frame ->
    if (reactApplicationContext.hasActiveReactInstance()) {
      reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_NAME, toMap(frame))
    }
  }

  override fun getName() = "AndroidTrainingSensors"

  /** Local random acceptance scope is deliberately excluded from Android backup and transfer. */
  @ReactMethod fun preparationDeviceKey(promise: Promise) {
    io.execute {
      try {
        val file = java.io.File(reactApplicationContext.noBackupFilesDir, "palou-route-device-v1")
        val existing = if (file.exists()) file.readText().trim() else ""
        val key = if (existing.isNotBlank()) existing else java.util.UUID.randomUUID().toString().also {
          file.parentFile?.mkdirs()
          file.writeText(it)
        }
        promise.resolve(key)
      } catch (error: Exception) {
        promise.reject("route_device_storage_failed", "无法保存本机的路线检查记录，请重试。", error)
      }
    }
  }

  @ReactMethod fun start(options: ReadableMap, promise: Promise) {
    val id = if (options.hasKey("sessionId")) options.getString("sessionId") else null
    if (id.isNullOrBlank()) { promise.reject("missing_session_id", "A user workout id is required"); return }
    if (Build.VERSION.SDK_INT >= 29 && reactApplicationContext.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("activity_permission_denied", "ACTIVITY_RECOGNITION must be granted before workout background recording")
      return
    }
    handler.post {
      try {
        val active = AndroidTrainingService.instance
        if (active != null && active.status().optBoolean("running")) {
          if (active.status().optString("sessionId") != id) {
            promise.reject("training_already_active", "Another workout owns the sensor service")
          } else promise.resolve(toMap(statusJson()))
          return@post
        }
        check(reactApplicationContext.currentActivity != null) { "workout_must_start_in_foreground" }
        val intent = Intent(reactApplicationContext, AndroidTrainingService::class.java)
          .setAction(AndroidTrainingService.ACTION_START).putExtra("sessionId", id)
          .putExtra("intervalMs", if (options.hasKey("intervalMs")) options.getDouble("intervalMs").toLong() else 20)
          .putExtra("barometerIntervalMs", if (options.hasKey("barometerIntervalMs")) options.getDouble("barometerIntervalMs").toInt() else 200)
        AndroidTrainingService.lastError = null
        if (Build.VERSION.SDK_INT >= 26) reactApplicationContext.startForegroundService(intent)
        else reactApplicationContext.startService(intent)
        awaitState(true, promise, 50)
      } catch (error: Exception) { promise.reject("training_start_failed", error.message, error) }
    }
  }

  @ReactMethod fun stop(promise: Promise) {
    handler.post {
      try {
        reactApplicationContext.stopService(Intent(reactApplicationContext, AndroidTrainingService::class.java))
        awaitState(false, promise, 50)
      } catch (error: Exception) { promise.reject("training_stop_failed", error.message, error) }
    }
  }

  private fun awaitState(expected: Boolean, promise: Promise, remaining: Int) {
    val status = statusJson()
    if (status.optBoolean("running") == expected) { promise.resolve(toMap(status)); return }
    if (expected && AndroidTrainingService.lastError != null) {
      promise.reject("training_start_failed", AndroidTrainingService.lastError); return
    }
    if (remaining <= 0) { promise.reject("training_transition_timeout", "Sensor service did not reach requested state"); return }
    handler.postDelayed({ awaitState(expected, promise, remaining - 1) }, 50)
  }

  @ReactMethod fun status(promise: Promise) {
    io.execute { try { promise.resolve(toMap(statusJson())) } catch (error: Exception) { promise.reject("training_status_failed", error) } }
  }

  /** Called only by an explicit user action. Opening the dialog does not imply consent. */
  @ReactMethod fun requestIgnoreBatteryOptimizations(promise: Promise) {
    openPowerSettings(true, promise)
  }

  @ReactMethod fun openBatteryOptimizationSettings(promise: Promise) {
    openPowerSettings(false, promise)
  }

  private fun openPowerSettings(requestExemption: Boolean, promise: Promise) {
    handler.post {
      val appUri = Uri.parse("package:${reactApplicationContext.packageName}")
      val destinations = mutableListOf<Pair<String, Intent>>()
      if (requestExemption) destinations.add("request_ignore" to Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, appUri))
      destinations.add("application_details" to Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, appUri))
      destinations.add("battery_settings" to Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
      for ((destination, intent) in destinations) {
        try {
          val activity = reactApplicationContext.currentActivity
          if (activity != null) activity.startActivity(intent)
          else reactApplicationContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          promise.resolve(Arguments.createMap().apply {
            putBoolean("opened", true)
            putString("destination", destination)
          })
          return@post
        } catch (_: Exception) {
          // Some vendor builds omit the direct dialog. Keep an app-scoped fallback.
        }
      }
      promise.resolve(Arguments.createMap().apply {
        putBoolean("opened", false)
        putString("destination", "unavailable")
      })
    }
  }

  @ReactMethod fun drain(afterSequence: Double, limit: Double, promise: Promise) {
    io.execute {
      try { promise.resolve(toMap(getJournal().drain(afterSequence.toLong().coerceAtLeast(0), limit.toInt()))) }
      catch (error: Exception) { promise.reject("training_replay_failed", error) }
    }
  }

  @ReactMethod fun acknowledge(sequence: Double, promise: Promise) {
    io.execute {
      try { getJournal().acknowledge(sequence.toLong()); promise.resolve(null) }
      catch (error: Exception) { promise.reject("training_ack_failed", error) }
    }
  }

  @ReactMethod fun addListener(eventName: String) {
    listenerCount += 1
    AndroidTrainingService.listeners.add(listener)
  }

  @ReactMethod fun removeListeners(count: Double) {
    listenerCount = (listenerCount - count.toInt()).coerceAtLeast(0)
    if (listenerCount == 0) AndroidTrainingService.listeners.remove(listener)
  }

  override fun invalidate() {
    AndroidTrainingService.listeners.remove(listener)
    listenerCount = 0
    io.shutdown()
    super.invalidate()
  }

  @Synchronized private fun getJournal(): TrainingSensorJournal =
    AndroidTrainingService.journal ?: TrainingSensorJournal(reactApplicationContext).also { AndroidTrainingService.journal = it }

  private fun statusJson(): JSONObject {
    val manager = reactApplicationContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    val journal = getJournal()
    return (AndroidTrainingService.instance?.status() ?: JSONObject()
      .put("running", false).put("sessionId", journal.sessionId)
      .put("latestSequence", journal.sequence).put("earliestSequence", journal.earliestSequence())
      .put("acknowledgedSequence", journal.acknowledged).put("droppedSamples", journal.droppedSamples)
      .put("lastError", AndroidTrainingService.lastError ?: JSONObject.NULL))
      .put("supported", manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null && manager.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null)
      .put("barometerAvailable", manager.getDefaultSensor(Sensor.TYPE_PRESSURE) != null)
      .put("stepsAvailable", manager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null)
      .put("activityPermissionGranted", Build.VERSION.SDK_INT < 29 || reactApplicationContext.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED)
      .put("notificationsAllowed", Build.VERSION.SDK_INT < 33 || reactApplicationContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
      .put("batteryOptimizationIgnored", try {
        (reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager)
          .isIgnoringBatteryOptimizations(reactApplicationContext.packageName)
      } catch (_: Exception) { false })
  }

  private fun toMap(json: JSONObject): WritableMap = Arguments.createMap().apply {
    val keys = json.keys()
    while (keys.hasNext()) {
      val key = keys.next()
      when (val value = json.opt(key)) {
        null, JSONObject.NULL -> putNull(key)
        is Boolean -> putBoolean(key, value)
        is Number -> putDouble(key, value.toDouble())
        is JSONObject -> putMap(key, toMap(value))
        is JSONArray -> putArray(key, toArray(value))
        else -> putString(key, value.toString())
      }
    }
  }

  private fun toArray(json: JSONArray): WritableArray = Arguments.createArray().apply {
    for (i in 0 until json.length()) when (val value = json.opt(i)) {
      null, JSONObject.NULL -> pushNull()
      is JSONObject -> pushMap(toMap(value))
      is Number -> pushDouble(value.toDouble())
      is Boolean -> pushBoolean(value)
      else -> pushString(value.toString())
    }
  }

  companion object { const val EVENT_NAME = "palouTrainingSensor" }
}
