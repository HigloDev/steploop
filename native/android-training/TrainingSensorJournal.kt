package com.zxn.palou

import android.content.Context
import org.json.JSONObject
import java.io.BufferedWriter
import java.io.File
import java.io.FileOutputStream

/** A bounded, on-device replay journal. A dropped unacknowledged range is reported, never invented. */
class TrainingSensorJournal(context: Context) {
  private val directory = File(context.filesDir, "training-native-journal").apply { mkdirs() }
  private val metadata = File(directory, "metadata.json")
  private data class Part(val name: String, val first: Long, var last: Long)
  private val parts = mutableListOf<Part>()
  private val replayReader = TrainingJournalReader()
  private var writer: BufferedWriter? = null
  private var lastFlushAt = 0L
  private var nextPart = 0
  var sessionId = ""
    private set
  var sequence = 0L
    private set
  var acknowledged = 0L
    private set
  var droppedSamples = 0L
    private set

  init {
    try {
      if (metadata.isFile) {
        val saved = JSONObject(metadata.readText())
        sessionId = saved.optString("sessionId")
        sequence = saved.optLong("sequence")
        acknowledged = saved.optLong("acknowledged")
        droppedSamples = saved.optLong("droppedSamples")
        nextPart = saved.optInt("nextPart")
        val index = saved.optJSONArray("parts")
        if (index != null) for (i in 0 until index.length()) {
          val part = index.getJSONObject(i)
          val name = part.getString("name")
          if (File(directory, name).isFile) parts.add(Part(name, part.getLong("first"), part.getLong("last")))
        }
        // A crash can happen after data flush but before metadata commit. Recover the true tail.
        parts.lastOrNull()?.let { part ->
          File(directory, part.name).useLines { lines ->
            lines.forEach { line ->
              try { part.last = maxOf(part.last, JSONObject(line).getLong("seq")) } catch (_: Exception) { }
            }
          }
          sequence = maxOf(sequence, part.last)
        }
      }
    } catch (_: Exception) {
      // Leave existing raw files available for support/export; do not pretend they were decoded.
      parts.clear()
    }
  }

  @Synchronized fun begin(id: String) {
    if (sessionId == id && parts.isNotEmpty()) return
    flush()
    writer?.close()
    writer = null
    replayReader.close()
    // Only this application's dedicated native replay journal is rotated here.
    parts.forEach { File(directory, it.name).delete() }
    parts.clear()
    sessionId = id
    sequence = 0
    acknowledged = 0
    droppedSamples = 0
    nextPart = 0
    persist()
  }

  @Synchronized fun append(frame: JSONObject): Long {
    val seq = ++sequence
    frame.put("seq", seq).put("sessionId", sessionId)
    var current = parts.lastOrNull()
    if (current == null || File(directory, current.name).length() >= MAX_PART_BYTES) {
      writer?.flush()
      writer?.close()
      current = Part("part-${nextPart++}.ndjson", seq, seq)
      parts.add(current)
      writer = File(directory, current.name).bufferedWriter()
      while (parts.size > MAX_PARTS) {
        val removed = parts.removeAt(0)
        droppedSamples += (removed.last - maxOf(acknowledged, removed.first - 1)).coerceAtLeast(0)
        replayReader.closePart(File(directory, removed.name))
        File(directory, removed.name).delete()
      }
    }
    if (writer == null) writer = FileOutputStream(File(directory, current.name), true).bufferedWriter()
    current.last = seq
    writer!!.write(frame.toString())
    writer!!.newLine()
    val now = System.currentTimeMillis()
    if (now - lastFlushAt >= 1000) flush()
    return seq
  }

  @Synchronized fun acknowledge(through: Long) {
    acknowledged = maxOf(acknowledged, through.coerceAtMost(sequence))
  }

  @Synchronized fun drain(after: Long, limit: Int): JSONObject {
    flush()
    val result = org.json.JSONArray()
    val count = limit.coerceIn(1, 2000)
    for (part in parts) {
      if (part.last <= after) continue
      replayReader.beginPart(File(directory, part.name), after)
      while (result.length() < count) {
        val line = replayReader.readLine() ?: break
        try {
          val frame = JSONObject(line)
          val seq = frame.getLong("seq")
          replayReader.consumed(seq)
          if (seq > after) result.put(frame)
        } catch (_: Exception) { /* A torn tail is excluded; existing samples stay untouched. */ }
      }
      if (result.length() >= count) break
    }
    return JSONObject().put("sessionId", sessionId).put("samples", result)
      .put("latestSequence", sequence).put("earliestSequence", earliestSequence())
      .put("droppedSamples", droppedSamples).put("acknowledgedSequence", acknowledged)
  }

  @Synchronized fun earliestSequence(): Long = parts.firstOrNull()?.first ?: (sequence + 1)

  @Synchronized fun flush() {
    writer?.flush()
    lastFlushAt = System.currentTimeMillis()
    persist()
  }

  @Synchronized fun close() {
    flush()
    writer?.close()
    writer = null
    replayReader.close()
  }

  private fun persist() {
    val index = org.json.JSONArray()
    parts.forEach { index.put(JSONObject().put("name", it.name).put("first", it.first).put("last", it.last)) }
    val saved = JSONObject().put("sessionId", sessionId).put("sequence", sequence)
      .put("acknowledged", acknowledged).put("droppedSamples", droppedSamples)
      .put("nextPart", nextPart).put("parts", index)
    val temporary = File(directory, "metadata.tmp")
    temporary.writeText(saved.toString())
    if (!temporary.renameTo(metadata)) metadata.writeText(saved.toString())
  }

  companion object {
    private const val MAX_PART_BYTES = 16L * 1024 * 1024
    private const val MAX_PARTS = 4
  }
}
