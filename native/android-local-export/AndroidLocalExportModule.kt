package com.zxn.palou

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** Only explicit UI export calls publish a copy. Existing files and private source bytes stay intact. */
class AndroidLocalExportModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val worker = Executors.newSingleThreadExecutor()
  @Volatile private var invalidated = false

  override fun getName() = "AndroidLocalExport"

  @ReactMethod
  fun saveToDownloads(sourceUri: String, filename: String, mimeType: String, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.reject("local_export_unsupported", "保存到下载需要 Android 10 或更高版本；你仍可使用系统分享。")
      return
    }
    try {
      worker.execute {
        var created: Uri? = null
        try {
          checkActive()
          val source = ownSourceFile(sourceUri)
          require(validFilename(filename)) { "导出文件名不能包含路径或特殊字符。" }
          val type = mimeType.lowercase(Locale.ROOT)
          require(Regex("^[a-z0-9][a-z0-9!#$&^_.+\\-]*/[a-z0-9][a-z0-9!#$&^_.+\\-]*$").matches(type)) {
            "导出文件类型无效。"
          }
          val resolver = reactApplicationContext.contentResolver
          val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
            put(MediaStore.MediaColumns.MIME_TYPE, type)
            put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/循阶/")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
          }
          val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
          val target = resolver.insert(collection, values) ?: throw IOException("未能创建下载文件。")
          created = target
          val expectedLength = source.length()
          val modifiedAt = source.lastModified()
          var copied = 0L
          FileInputStream(source).use { input ->
            val output = resolver.openOutputStream(target, "w") ?: throw IOException("未能打开下载文件。")
            output.use {
              val buffer = ByteArray(64 * 1024)
              while (true) {
                checkActive()
                val count = input.read(buffer)
                if (count < 0) break
                it.write(buffer, 0, count)
                copied += count
              }
              it.flush()
            }
          }
          checkActive()
          if (copied != expectedLength || source.length() != expectedLength || source.lastModified() != modifiedAt) {
            throw IOException("导出期间源文件发生变化，请重新生成并保存。")
          }
          // Query the new row only; a provider may adjust the requested display name.
          var displayName = filename
          resolver.query(target, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) displayName = cursor.getString(0) ?: filename
          }
          checkActive()
          val published = resolver.update(target, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
          if (published != 1) throw IOException("下载文件写入完成，但未能发布，请重试。")
          promise.resolve(Arguments.createMap().apply {
            putString("uri", target.toString())
            putString("displayName", displayName)
            putString("directory", "Download/循阶")
          })
        } catch (error: Exception) {
          // Delete only the row inserted by this invocation. Never touch source or other downloads.
          val target = created
          if (target != null) {
            try { reactApplicationContext.contentResolver.delete(target, null, null) } catch (_: Exception) { }
          }
          promise.reject("local_export_failed", error.message ?: "保存到下载失败，应用内源文件仍保留。", error)
        }
      }
    } catch (error: RejectedExecutionException) {
      promise.reject("local_export_cancelled", "应用导出服务已停止，请重新打开页面后重试。", error)
    }
  }

  private fun checkActive() {
    if (invalidated || Thread.currentThread().isInterrupted) throw IOException("导出已中断，应用内源文件仍保留。")
  }

  private fun ownSourceFile(sourceUri: String): File {
    val uri = Uri.parse(sourceUri)
    require(uri.scheme == "file" && uri.authority.isNullOrEmpty() && uri.query == null && uri.fragment == null) {
      "只能导出应用自己生成的本地文件。"
    }
    val path = uri.path ?: throw IOException("源文件路径无效。")
    require(path.startsWith("/")) { "源文件必须是应用内的绝对路径。" }
    val source = File(path).canonicalFile
    val roots = listOf(reactApplicationContext.filesDir.canonicalFile, reactApplicationContext.cacheDir.canonicalFile)
    require(roots.any { source.path.startsWith(it.path + File.separator) }) {
      "源文件不属于应用自己的文件或缓存目录。"
    }
    require(source.isFile && source.canRead()) { "应用内源文件不存在或不可读取。" }
    return source
  }

  private fun validFilename(filename: String): Boolean = filename.isNotBlank() && filename.length <= 120 &&
    filename != "." && filename != ".." && !filename.endsWith(".") && !filename.endsWith(" ") &&
    filename.none { it <= '\u001f' || it in "/\\<>:\"|?*" }

  override fun invalidate() {
    invalidated = true
    worker.shutdownNow()
    super.invalidate()
  }
}
