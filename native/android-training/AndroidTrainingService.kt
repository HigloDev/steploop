package com.zxn.palou

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet

/** Owned only by an explicitly started workout. No boot receiver, no unattended background start. */
class AndroidTrainingService : Service(), SensorEventListener {
  private lateinit var sensorManager: SensorManager
  private lateinit var worker: HandlerThread
  private lateinit var handler: Handler
  private var wakeLock: PowerManager.WakeLock? = null
  private var gyro = floatArrayOf(0f, 0f, 0f)
  private var orientation = floatArrayOf(0f, 0f, 0f)
  private var steps: Float? = null
  private var lastAccelNanos = 0L
  private var intervalMs = 20L
  private var clockOffsetMs = 0L
  private var running = false
  private val ceiling = Runnable {
    lastError = "session_time_limit"
    stopSelf()
  }

  override fun onCreate() {
    super.onCreate()
    sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
    worker = HandlerThread("palou-training-sensors").apply { start() }
    handler = Handler(worker.looper)
    journal = journal ?: TrainingSensorJournal(applicationContext)
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP || intent == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (running) return START_NOT_STICKY
    val id = intent.getStringExtra("sessionId")?.takeIf { it.isNotBlank() }
    if (id == null) {
      lastError = "missing_session_id"
      stopSelf()
      return START_NOT_STICKY
    }
    try {
      lastError = null
      intervalMs = intent.getLongExtra("intervalMs", 20).coerceIn(20, 1000)
      val notification = createNotification()
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
      } else startForeground(NOTIFICATION_ID, notification)
      journal!!.begin(id)
      clockOffsetMs = System.currentTimeMillis() - SystemClock.elapsedRealtime()
      val power = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "palou:active-training").apply {
        setReferenceCounted(false)
        acquire(MAX_SESSION_MS)
      }
      val accel = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
      val gyroSensor = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
      check(accel != null && gyroSensor != null) { "required_sensor_missing" }
      val micros = (intervalMs * 1000).toInt()
      check(sensorManager.registerListener(this, accel, micros, handler)) { "accelerometer_registration_failed" }
      check(sensorManager.registerListener(this, gyroSensor, micros, handler)) { "gyroscope_registration_failed" }
      registerOptional(Sensor.TYPE_ROTATION_VECTOR, micros)
      registerOptional(Sensor.TYPE_PRESSURE, intent.getIntExtra("barometerIntervalMs", 200).coerceIn(100, 1000) * 1000)
      registerOptional(Sensor.TYPE_STEP_COUNTER, SensorManager.SENSOR_DELAY_NORMAL)
      running = true
      handler.postDelayed(ceiling, MAX_SESSION_MS)
    } catch (error: Exception) {
      lastError = error.message ?: error.javaClass.simpleName
      stopSelf()
    }
    return START_NOT_STICKY
  }

  private fun registerOptional(type: Int, delay: Int) {
    try { sensorManager.getDefaultSensor(type)?.let { sensorManager.registerListener(this, it, delay, handler) } }
    catch (_: Exception) { /* Absence is reflected in capabilities/status, never fabricated. */ }
  }

  override fun onSensorChanged(event: SensorEvent) {
    if (!running) return
    when (event.sensor.type) {
      Sensor.TYPE_GYROSCOPE -> gyro = event.values.copyOf(3)
      Sensor.TYPE_PRESSURE -> {
        val pressure = event.values.firstOrNull()?.takeIf { it.isFinite() && it > 0 } ?: return
        val t = clockOffsetMs + event.timestamp / 1_000_000L
        publish(JSONObject().put("t", t).put("pressureAt", t)
          .put("sensorKind", "pressure").put("pressure", pressure))
      }
      Sensor.TYPE_STEP_COUNTER -> steps = event.values.firstOrNull()
      Sensor.TYPE_ROTATION_VECTOR -> {
        val rotation = FloatArray(9)
        SensorManager.getRotationMatrixFromVector(rotation, event.values)
        SensorManager.getOrientation(rotation, orientation)
      }
      Sensor.TYPE_ACCELEROMETER -> {
        if (event.timestamp - lastAccelNanos < intervalMs * 1_000_000 * 0.8) return
        lastAccelNanos = event.timestamp
        val t = clockOffsetMs + event.timestamp / 1_000_000L
        val frame = JSONObject().put("t", t)
          .put("ax", event.values[0] / SensorManager.GRAVITY_EARTH)
          .put("ay", event.values[1] / SensorManager.GRAVITY_EARTH)
          .put("az", event.values[2] / SensorManager.GRAVITY_EARTH)
          .put("gx", gyro[0]).put("gy", gyro[1]).put("gz", gyro[2])
          .put("alpha", orientation[0]).put("beta", orientation[1]).put("gamma", orientation[2])
        steps?.let { frame.put("steps", it) }
        publish(frame)
      }
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  private fun publish(frame: JSONObject) {
    try {
      journal!!.append(frame)
      listeners.forEach { listener -> try { listener(frame) } catch (_: Exception) { } }
    } catch (error: Exception) {
      lastError = "journal_write_failed: ${error.message}"
      stopSelf()
    }
  }
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    running = false
    if (::sensorManager.isInitialized) sensorManager.unregisterListener(this)
    if (::handler.isInitialized) handler.removeCallbacks(ceiling)
    if (::handler.isInitialized) handler.post {
      try { journal?.close() } catch (error: Exception) { lastError = "journal_close_failed: ${error.message}" }
      worker.quitSafely()
    }
    if (wakeLock?.isHeld == true) wakeLock?.release()
    wakeLock = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    instance = null
    super.onDestroy()
  }

  private fun createNotification(): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "爬楼训练", NotificationManager.IMPORTANCE_LOW).apply {
        description = "训练期间持续采集，结束训练后停止"
        setShowBadge(false)
      }
    )
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pending = launch?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    return builder.setContentTitle("循阶 · 训练进行中")
      .setContentText("锁屏后仍在记录，点击返回训练")
      .setSmallIcon(R.drawable.ic_stat_steploop).setOngoing(true)
      .setCategory(Notification.CATEGORY_SERVICE).setContentIntent(pending).build()
  }

  fun status(): JSONObject = JSONObject().put("running", running)
    .put("sessionId", journal?.sessionId ?: "").put("latestSequence", journal?.sequence ?: 0)
    .put("earliestSequence", journal?.earliestSequence() ?: 1)
    .put("acknowledgedSequence", journal?.acknowledged ?: 0)
    .put("droppedSamples", journal?.droppedSamples ?: 0)
    .put("barometerAvailable", sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE) != null)
    .put("stepsAvailable", sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null)
    .put("lastError", lastError ?: JSONObject.NULL)

  companion object {
    const val ACTION_START = "com.zxn.palou.TRAINING_START"
    const val ACTION_STOP = "com.zxn.palou.TRAINING_STOP"
    private const val CHANNEL_ID = "palou-active-training"
    private const val NOTIFICATION_ID = 27041
    private const val MAX_SESSION_MS = 6L * 60 * 60 * 1000
    @Volatile var instance: AndroidTrainingService? = null
    @Volatile var lastError: String? = null
    @Volatile var journal: TrainingSensorJournal? = null
    val listeners = CopyOnWriteArraySet<(JSONObject) -> Unit>()
  }
}
