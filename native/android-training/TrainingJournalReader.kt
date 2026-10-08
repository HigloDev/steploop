package com.zxn.palou

import java.io.BufferedReader
import java.io.Closeable
import java.io.File

/** One bounded cursor for forward replay; a backwards request deliberately starts again. */
class TrainingJournalReader : Closeable {
  private var filePath: String? = null
  private var reader: BufferedReader? = null
  private var lastSequence = -1L

  @Synchronized fun beginPart(file: File, after: Long) {
    val path = file.absolutePath
    if (reader != null && path == filePath && after >= lastSequence) return
    close()
    reader = file.bufferedReader(Charsets.UTF_8)
    filePath = path
  }

  @Synchronized fun readLine(): String? = reader?.readLine()

  @Synchronized fun consumed(sequence: Long) {
    lastSequence = maxOf(lastSequence, sequence)
  }

  @Synchronized fun closePart(file: File) {
    if (filePath == file.absolutePath) close()
  }

  @Synchronized override fun close() {
    reader?.close()
    reader = null
    filePath = null
    lastSequence = -1L
  }
}
