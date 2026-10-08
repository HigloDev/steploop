package com.zxn.palou

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.AudioRouting
import android.media.MediaPlayer
import android.media.PlaybackParams
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import java.io.File
import java.util.Locale

/**
 * Plays bundled speech clips and NUMBER-ONLY TTS as a single interrupted-safe playlist.
 * No arbitrary text, server URL, or sentence synthesis is exposed over the bridge.
 */
@Suppress("DEPRECATION")
class AndroidVoiceModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "AndroidWorkoutVoice"

  private data class Segment(val kind: String, val value: String)
  private data class PlaybackOptions(
    val rate: Float = 1f,
    val bluetoothOnly: Boolean = false,
    val duckMusic: Boolean = true,
    val speaker: String = "serena",
  )
  private data class Playback(
    val generation: Long,
    val promise: Promise,
    val segments: MutableList<Segment>,
    val volume: Float,
    val options: PlaybackOptions,
    var index: Int = 0,
    var played: Int = 0,
    var numericFallback: Boolean = false,
    var recordedNumberUsed: Boolean = false,
    var numberTtsUsed: Boolean = false,
    val numberTtsTexts: MutableList<String> = mutableListOf(),
  )

  private val handler = Handler(Looper.getMainLooper())
  private val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val attributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()
  private var focusRequest: AudioFocusRequest? = null
  private var focusHeld = false
  private var player: MediaPlayer? = null
  private var validatedBluetoothPlayer: MediaPlayer? = null
  private var playback: Playback? = null
  private var generation = 0L
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private var ttsInitializing = false
  private var ttsGeneration = 0L
  private val ttsWaiters = mutableListOf<(Boolean) -> Unit>()
  private var numericId: String? = null
  private var numericFile: File? = null
  private var watchdog: Runnable? = null
  private var routeProbe: Runnable? = null
  private var deviceCallbackRegistered = false

  private val deviceCallback = object : AudioDeviceCallback() {
    override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
      val state = playback ?: return
      if (!state.options.bluetoothOnly) return
      val currentPlayer = player
      // Mute before checking a route which Android may have redirected to the speaker.
      try { currentPlayer?.setVolume(0f, 0f) } catch (_: Exception) { }
      if (bluetoothOutput() == null) finishSuppressed("bluetooth_unavailable")
      else if (currentPlayer != null) confirmBluetoothRoute(currentPlayer, state)
    }
  }

  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    handler.post {
      if (change == AudioManager.AUDIOFOCUS_LOSS ||
        change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
        change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
        finish("audio_focus_lost", "Voice interrupted by another audio source")
      }
    }
  }

  @ReactMethod
  fun getCapabilities(promise: Promise) {
    handler.post {
      run {
        val assets = try { reactApplicationContext.assets.list("voice/serena")?.toSet() ?: emptySet() }
          catch (_: Exception) { emptySet() }
        val clips = assets.contains("workout_done.mp3")
        val numberClips = (0..9).map { "n$it.mp3" } +
          listOf("n10.mp3", "n100.mp3", "n1000.mp3", "n10000.mp3", "n_point.mp3", "n_minus.mp3")
        promise.resolve(Arguments.createMap().apply {
          putBoolean("prerecorded", clips)
          putBoolean("numberTts", false)
          putArray("speakers", Arguments.createArray().apply {
            listOf("serena", "vivian", "uncle_fu", "dylan").forEach { speaker ->
              if (reactApplicationContext.assets.list("voice/$speaker")?.contains("workout_done.mp3") == true) pushString(speaker)
            }
          })
          putBoolean("recordedNumbers", numberClips.all { assets.contains(it) })
          putString("platform", "android")
          putBoolean("playbackOptions", true)
          putBoolean("bluetoothOnly", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
        })
      }
    }
  }

  @ReactMethod
  fun playSegments(input: ReadableArray, volume: Double, promise: Promise) {
    beginPlayback(input, volume, PlaybackOptions(), promise)
  }

  /** Keep the original bridge arity for older JavaScript clients. */
  @ReactMethod
  fun playSegmentsWithOptions(input: ReadableArray, volume: Double, options: ReadableMap, promise: Promise) {
    val parsed = try {
      val rate = if (options.hasKey("rate") && !options.isNull("rate")) options.getDouble("rate") else 1.0
      require(rate.isFinite() && listOf(0.8, 1.0, 1.2).any { kotlin.math.abs(it - rate) < 0.001 }) {
        "Voice rate must be 0.8, 1.0, or 1.2"
      }
      val speaker = if (options.hasKey("speaker") && !options.isNull("speaker")) options.getString("speaker") else "serena"
      require(speaker in listOf("serena", "vivian", "uncle_fu", "dylan")) { "Invalid voice speaker" }
      PlaybackOptions(
        rate.toFloat(),
        options.hasKey("bluetoothOnly") && !options.isNull("bluetoothOnly") && options.getBoolean("bluetoothOnly"),
        !options.hasKey("duckMusic") || options.isNull("duckMusic") || options.getBoolean("duckMusic"),
        speaker!!,
      )
    } catch (error: Exception) {
      promise.reject("invalid_voice_options", error.message)
      return
    }
    beginPlayback(input, volume, parsed, promise)
  }

  private fun beginPlayback(input: ReadableArray, volume: Double, options: PlaybackOptions, promise: Promise) {
    val segments = mutableListOf<Segment>()
    try {
      require(volume.isFinite()) { "Voice volume must be finite" }
      require(input.size() in 1..40) { "Voice playlist must contain 1 to 40 segments" }
      for (index in 0 until input.size()) {
        val item = requireNotNull(input.getMap(index))
        val kind = requireNotNull(item.getString("kind"))
        when (kind) {
          "clip" -> {
            val id = requireNotNull(item.getString("id"))
            require(id.matches(Regex("^[a-z][a-z0-9_]{0,60}$"))) { "Invalid clip ID" }
            segments.add(Segment(kind, id))
          }
          "number" -> {
            val number = requireNotNull(item.getString("value"))
            require(number.matches(Regex("^-?\\d{1,6}(\\.\\d{1,2})?$"))) {
              "TTS accepts numeric tokens only"
            }
            segments.add(Segment(kind, number))
          }
          else -> error("Unsupported voice segment")
        }
      }
    } catch (error: Exception) {
      promise.reject("invalid_voice_segments", error.message)
      return
    }
    handler.post {
      finish("cancelled", "Replaced by a new voice playlist")
      generation += 1
      val next = Playback(generation, promise, segments, volume.toFloat().coerceIn(0f, 1f), options)
      playback = next
      if (options.bluetoothOnly && bluetoothOutput() == null) {
        finishSuppressed("bluetooth_unavailable")
      } else if (!options.duckMusic && audioManager.isMusicActive) {
        finishSuppressed("music_active")
      } else if (!requestFocus(options.duckMusic)) {
        finish("audio_focus_unavailable", "Audio focus could not be acquired")
      } else {
        if (options.bluetoothOnly) {
          try {
            audioManager.registerAudioDeviceCallback(deviceCallback, handler)
            deviceCallbackRegistered = true
          } catch (_: Exception) {
            finishSuppressed("bluetooth_unavailable")
            return@post
          }
        }
        playNext(next)
      }
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    handler.post {
      finish("cancelled", "Voice playback stopped")
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun release(promise: Promise) {
    handler.post {
      finish("cancelled", "Voice playback released")
      tts?.shutdown()
      ttsGeneration += 1
      tts = null
      ttsReady = false
      ttsInitializing = false
      val waiting = ttsWaiters.toList()
      ttsWaiters.clear()
      waiting.forEach { it(false) }
      promise.resolve(null)
    }
  }

  private fun requestFocus(duckMusic: Boolean): Boolean {
    return try {
      // A non-ducking request is made only after confirming there is no active music.
      // It still receives call/other-app focus interruptions instead of playing unmanaged audio.
      val gain = if (duckMusic) AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
        else AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
      val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val request = AudioFocusRequest.Builder(gain)
          .setAudioAttributes(attributes)
          .setWillPauseWhenDucked(true)
          .setAcceptsDelayedFocusGain(false)
          .setOnAudioFocusChangeListener(focusListener, handler)
          .build()
        focusRequest = request
        audioManager.requestAudioFocus(request)
      } else {
        audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, gain)
      }
      focusHeld = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      focusHeld
    } catch (_: Exception) { false }
  }

  private fun abandonFocus() {
    if (!focusHeld) return
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
      } else {
        audioManager.abandonAudioFocus(focusListener)
      }
    } catch (_: Exception) { /* The device may already have released focus. */ }
    focusRequest = null
    focusHeld = false
  }

  private fun isCurrent(state: Playback): Boolean = playback === state && state.generation == generation

  private fun isBluetoothOutput(device: AudioDeviceInfo): Boolean =
    device.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
      device.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
      (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && device.type == AudioDeviceInfo.TYPE_BLE_HEADSET)

  private fun bluetoothOutput(): AudioDeviceInfo? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null
    return try {
      val devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).filter { isBluetoothOutput(it) }
      devices.firstOrNull { it.type != AudioDeviceInfo.TYPE_BLUETOOTH_SCO } ?: devices.firstOrNull()
    } catch (_: Exception) { null }
  }

  /** A preferred device is only a request: playback stays muted until its actual route is safe. */
  private fun confirmBluetoothRoute(mp: MediaPlayer, state: Playback): Boolean {
    if (!isCurrent(state) || player !== mp) return false
    return try {
      val routed = if (Build.VERSION.SDK_INT >= 36) mp.routedDevices else listOfNotNull(mp.routedDevice)
      if (routed.isEmpty()) return false
      if (routed.any { !isBluetoothOutput(it) }) {
        finishSuppressed("bluetooth_unavailable")
        false
      } else {
        validatedBluetoothPlayer = mp
        mp.setVolume(state.volume, state.volume)
        true
      }
    } catch (_: Exception) {
      finishSuppressed("bluetooth_unavailable")
      false
    }
  }

  private fun awaitBluetoothRoute(mp: MediaPlayer, state: Playback, deadline: Long) {
    if (!isCurrent(state) || player !== mp) return
    routeProbe?.let { handler.removeCallbacks(it) }
    routeProbe = null
    if (confirmBluetoothRoute(mp, state)) return
    if (!isCurrent(state)) return
    if (SystemClock.elapsedRealtime() >= deadline) {
      finishSuppressed("bluetooth_unavailable")
      return
    }
    val next = Runnable { awaitBluetoothRoute(mp, state, deadline) }
    routeProbe = next
    handler.postDelayed(next, 25)
  }

  private fun configurePlayer(mp: MediaPlayer, state: Playback): Boolean {
    mp.setAudioAttributes(attributes)
    if (!state.options.bluetoothOnly) {
      mp.setVolume(state.volume, state.volume)
      return true
    }
    mp.setVolume(0f, 0f)
    val output = bluetoothOutput()
    if (output == null || !mp.setPreferredDevice(output)) {
      finishSuppressed("bluetooth_unavailable")
      return false
    }
    mp.addOnRoutingChangedListener(AudioRouting.OnRoutingChangedListener {
      if (!isCurrent(state) || player !== mp) return@OnRoutingChangedListener
      validatedBluetoothPlayer = null
      try { mp.setVolume(0f, 0f) } catch (_: Exception) { }
      awaitBluetoothRoute(mp, state, SystemClock.elapsedRealtime() + 1000)
    }, handler)
    return true
  }

  private fun playNext(state: Playback) {
    if (!isCurrent(state)) return
    clearWatchdog()
    routeProbe?.let { handler.removeCallbacks(it) }
    routeProbe = null
    player?.release()
    player = null
    validatedBluetoothPlayer = null
    if (state.index >= state.segments.size) {
      finish()
      return
    }
    val segment = state.segments[state.index]
    if (segment.kind == "number") {
      // Match the selected voice for every numeric token; no system-voice switch mid-sentence.
      useRecordedNumber(state, segment.value, false)
      return
    }
    try {
      val asset = "voice/${state.options.speaker}/${segment.value}.mp3"
      val mp = MediaPlayer()
      player = mp
      if (!configurePlayer(mp, state)) return
      try {
        reactApplicationContext.assets.openFd(asset).use { fd ->
          mp.setDataSource(fd.fileDescriptor, fd.startOffset, fd.length)
        }
      } catch (_: Exception) {
        // Also supports APKs whose assets were compressed by another build system.
        val file = File(reactApplicationContext.cacheDir, "palou_voice_${state.options.speaker}_${segment.value}.mp3")
        // Refresh after an APK update; a cached file must not pin an old voice library.
        reactApplicationContext.assets.open(asset).use { source ->
          file.outputStream().use { source.copyTo(it) }
        }
        mp.setDataSource(file.absolutePath)
      }
      preparePlayer(mp, state)
    } catch (error: Exception) {
      finish("voice_clip_failed", error.message ?: "Recorded audio is unavailable")
    }
  }

  private fun preparePlayer(mp: MediaPlayer, state: Playback, synthesizedNumber: Boolean = false) {
    mp.setOnPreparedListener {
      if (isCurrent(state) && player === mp) {
        try {
          armWatchdog(20_000) { finish("voice_timeout", "Voice segment playback timed out") }
          // Number TTS has already applied its speech rate to the synthesized waveform.
          val rate = if (synthesizedNumber) 1f else state.options.rate
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            it.playbackParams = PlaybackParams().allowDefaults().setPitch(1f).setSpeed(rate)
          }
          it.start()
          if (state.options.bluetoothOnly) awaitBluetoothRoute(it, state, SystemClock.elapsedRealtime() + 1000)
        } catch (error: Exception) {
          finish("voice_player_error", error.message ?: "Voice segment could not start")
        }
      }
    }
    mp.setOnCompletionListener {
      if (isCurrent(state) && player === mp) {
        if (state.options.bluetoothOnly && validatedBluetoothPlayer !== mp) {
          finishSuppressed("bluetooth_unavailable")
          return@setOnCompletionListener
        }
        state.played += 1
        if (synthesizedNumber) {
          state.numberTtsTexts.add(state.segments[state.index].value)
          state.numberTtsUsed = true
        }
        state.index += 1
        numericFile?.delete()
        numericFile = null
        playNext(state)
      }
    }
    mp.setOnErrorListener { _, what, extra ->
      if (isCurrent(state) && player === mp) finish("voice_player_error", "MediaPlayer $what/$extra")
      true
    }
    armWatchdog(8_000) { finish("voice_prepare_timeout", "Voice segment preparation timed out") }
    mp.prepareAsync()
  }

  private fun ensureTts(callback: (Boolean) -> Unit) {
    if (ttsReady) { callback(true); return }
    if (tts != null && !ttsInitializing) { callback(false); return }
    ttsWaiters.add(callback)
    if (ttsInitializing) return
    ttsInitializing = true
    ttsGeneration += 1
    val token = ttsGeneration
    // Initialisation cannot hold up fixed audio indefinitely.
    handler.postDelayed({
      if (ttsInitializing && token == ttsGeneration) completeTtsInit(false)
    }, 2500)
    try {
      tts = TextToSpeech(reactApplicationContext) { status ->
        handler.post {
          if (token != ttsGeneration) return@post
          val engine = tts
          val language = if (status == TextToSpeech.SUCCESS && engine != null)
            engine.setLanguage(Locale.SIMPLIFIED_CHINESE) else TextToSpeech.LANG_NOT_SUPPORTED
          val ready = language != TextToSpeech.LANG_MISSING_DATA && language != TextToSpeech.LANG_NOT_SUPPORTED
          if (ready) {
            engine?.setAudioAttributes(attributes)
            engine?.setSpeechRate(1.0f)
            engine?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
              override fun onStart(utteranceId: String?) = Unit
              override fun onDone(utteranceId: String?) {
                handler.post { numberSynthesized(utteranceId) }
              }
              override fun onError(utteranceId: String?) {
                handler.post { numberFailed(utteranceId) }
              }
              override fun onError(utteranceId: String?, errorCode: Int) {
                handler.post { numberFailed(utteranceId) }
              }
            })
          }
          completeTtsInit(ready)
        }
      }
    } catch (_: Exception) { completeTtsInit(false) }
  }

  private fun completeTtsInit(ready: Boolean) {
    ttsReady = ready
    ttsInitializing = false
    val waiting = ttsWaiters.toList()
    ttsWaiters.clear()
    waiting.forEach { it(ready) }
  }

  private fun synthesizeNumber(state: Playback, number: String) {
    val engine = tts
    if (engine == null) { useRecordedNumber(state, number); return }
    val id = "palou-number-${state.generation}-${state.index}"
    numericId = id
    numericFile = File(reactApplicationContext.cacheDir, "$id.wav")
    val result = try {
      // The bridge validates this numeric-only string before it reaches the engine.
      if (engine.setSpeechRate(state.options.rate) != TextToSpeech.SUCCESS) throw IllegalStateException("Numeric speech rate unavailable")
      engine.synthesizeToFile(number, Bundle(), numericFile!!, id)
    } catch (_: Exception) { TextToSpeech.ERROR }
    if (result != TextToSpeech.SUCCESS) {
      numberFailed(id)
    } else {
      armWatchdog(5000) { numberFailed(id) }
    }
  }

  private fun numberSynthesized(id: String?) {
    val state = playback ?: return
    if (id == null || id != numericId || !isCurrent(state)) return
    clearWatchdog()
    numericId = null
    val file = numericFile
    if (file == null || !file.exists() || file.length() < 44) {
      useRecordedNumber(state, state.segments[state.index].value)
      return
    }
    try {
      val mp = MediaPlayer()
      player = mp
      if (!configurePlayer(mp, state)) return
      mp.setDataSource(file.absolutePath)
      preparePlayer(mp, state, synthesizedNumber = true)
    } catch (_: Exception) {
      player?.release()
      player = null
      useRecordedNumber(state, state.segments[state.index].value)
    }
  }

  private fun numberFailed(id: String?) {
    val state = playback ?: return
    if (id == null || id != numericId || !isCurrent(state)) return
    clearWatchdog()
    numericId = null
    tts?.stop()
    numericFile?.delete()
    numericFile = null
    useRecordedNumber(state, state.segments[state.index].value)
  }

  private fun useRecordedNumber(state: Playback, number: String, fallback: Boolean = true) {
    if (!isCurrent(state)) return
    state.numericFallback = state.numericFallback || fallback
    state.recordedNumberUsed = true
    val clips = recordedNumberIds(number).map { Segment("clip", it) }
    state.segments.removeAt(state.index)
    state.segments.addAll(state.index, clips)
    playNext(state)
  }

  private fun recordedNumberIds(value: String): List<String> {
    val negative = value.startsWith("-")
    val pieces = value.removePrefix("-").split(".")
    val integer = pieces[0].toInt()
    val ids = mutableListOf<String>()
    if (negative) ids.add("n_minus")
    fun group(number: Int, omitLeadingOne: Boolean): List<String> {
      if (number == 0) return listOf("n0")
      val output = mutableListOf<String>()
      var zero = false
      for (unit in listOf(1000, 100, 10, 1)) {
        val digit = (number / unit) % 10
        if (digit == 0) { if (output.isNotEmpty()) zero = true; continue }
        if (zero) output.add("n0")
        zero = false
        if (!(unit == 10 && digit == 1 && output.isEmpty() && omitLeadingOne)) output.add("n$digit")
        if (unit > 1) output.add("n$unit")
      }
      return output
    }
    if (integer >= 10000) {
      ids.addAll(group(integer / 10000, true))
      ids.add("n10000")
      val rest = integer % 10000
      if (rest > 0) {
        if (rest < 1000) ids.add("n0")
        ids.addAll(group(rest, false))
      }
    } else ids.addAll(group(integer, true))
    if (pieces.size > 1) {
      ids.add("n_point")
      pieces[1].forEach { ids.add("n$it") }
    }
    return ids
  }

  private fun clearWatchdog() {
    watchdog?.let { handler.removeCallbacks(it) }
    watchdog = null
  }

  private fun armWatchdog(timeoutMs: Long, action: () -> Unit) {
    clearWatchdog()
    val token = generation
    val next = Runnable { if (generation == token && playback != null) action() }
    watchdog = next
    handler.postDelayed(next, timeoutMs)
  }

  private fun finishSuppressed(reason: String) {
    finish(suppressed = reason)
  }

  private fun finish(code: String? = null, message: String? = null, suppressed: String? = null) {
    val state = playback
    playback = null
    generation += 1
    clearWatchdog()
    routeProbe?.let { handler.removeCallbacks(it) }
    routeProbe = null
    if (deviceCallbackRegistered) {
      try { audioManager.unregisterAudioDeviceCallback(deviceCallback) } catch (_: Exception) { }
      deviceCallbackRegistered = false
    }
    numericId = null
    try { player?.release() } catch (_: Exception) { }
    player = null
    validatedBluetoothPlayer = null
    try { tts?.stop() } catch (_: Exception) { }
    numericFile?.delete()
    numericFile = null
    abandonFocus()
    if (state != null) {
      if (code != null) state.promise.reject(code, message ?: code)
      else state.promise.resolve(Arguments.createMap().apply {
        putInt("playedSegments", if (suppressed == null) state.played else 0)
        if (suppressed != null) {
          putString("suppressed", suppressed)
          putInt("partialPlayedSegments", state.played)
        }
        putBoolean("numericFallback", state.numericFallback)
        putBoolean("recordedNumberUsed", state.recordedNumberUsed)
        putBoolean("numberTtsUsed", state.numberTtsUsed)
        putArray("numberTtsTexts", Arguments.createArray().apply {
          state.numberTtsTexts.forEach { pushString(it) }
        })
        if (state.numberTtsUsed) putString("numberTtsEngine", "android_text_to_speech")
      })
    }
  }

  override fun invalidate() {
    handler.post {
      finish("cancelled", "React context invalidated")
      tts?.shutdown()
      ttsGeneration += 1
      tts = null
      ttsReady = false
      ttsInitializing = false
      val waiting = ttsWaiters.toList()
      ttsWaiters.clear()
      waiting.forEach { it(false) }
    }
    super.invalidate()
  }
}
