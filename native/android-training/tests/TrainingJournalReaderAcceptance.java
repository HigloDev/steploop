import com.zxn.palou.TrainingJournalReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Comparator;
import java.util.Objects;

/** Host JVM acceptance of the actual Kotlin cursor compiled by the Android release task. */
public final class TrainingJournalReaderAcceptance {
  private static void equal(Object actual, Object expected, String scenario) {
    if (!Objects.equals(actual, expected)) throw new AssertionError(scenario + ": " + actual + " != " + expected);
  }

  public static void main(String[] args) throws Exception {
    Path directory = Files.createTempDirectory("palou-native-cursor-");
    TrainingJournalReader reader = new TrainingJournalReader();
    try {
      Path first = directory.resolve("part-a.ndjson");
      String sample1 = "{\"seq\":1,\"t\":1234567890001,\"pressure\":1001.25}";
      String sample2 = "{\"seq\":2,\"t\":1234567890021,\"pressure\":1001.24}";
      String sample3 = "{\"seq\":3,\"t\":1234567890041,\"sessionId\":\"原始记录\"}";
      Files.writeString(first, sample1 + "\n" + sample2 + "\n", StandardCharsets.UTF_8);

      reader.beginPart(first.toFile(), 0);
      equal(reader.readLine(), sample1, "first sample preserves the exact raw line");
      reader.consumed(1);
      reader.beginPart(first.toFile(), 1);
      equal(reader.readLine(), sample2, "forward continuation reads the next line");
      reader.consumed(2);
      equal(reader.readLine(), null, "reached file end");

      Files.writeString(first, sample3 + "\n", StandardCharsets.UTF_8, StandardOpenOption.APPEND);
      reader.beginPart(first.toFile(), 2);
      equal(reader.readLine(), sample3, "a live writer can append after cached EOF, preserving UTF-8");
      reader.consumed(3);

      reader.beginPart(first.toFile(), 0);
      equal(reader.readLine(), sample1, "backward replay resets to the beginning");
      reader.consumed(1);

      Path second = directory.resolve("part-b.ndjson");
      String sample4 = "{\"seq\":4,\"t\":1234567890061}";
      Files.writeString(second, sample4 + "\n", StandardCharsets.UTF_8);
      reader.beginPart(second.toFile(), 3);
      equal(reader.readLine(), sample4, "part rotation changes the cursor");
      reader.consumed(4);
      reader.closePart(first.toFile());
      equal(reader.readLine(), null, "dropping another part does not disturb the current reader");
      reader.closePart(second.toFile());
      equal(reader.readLine(), null, "dropping the current part closes its reader");
      Files.delete(second);

      reader.close();
      Files.writeString(first, sample4 + "\n", StandardCharsets.UTF_8);
      reader.beginPart(first.toFile(), 0);
      equal(reader.readLine(), sample4, "a new session can reuse a filename after close");
      System.out.println("PASS: forward replay, appended EOF, raw UTF-8/time/seq, backward replay, rotation/drop, close/reopen");
    } finally {
      reader.close();
      // Only freshly generated files in this test's own temporary directory are removed.
      try (var files = Files.walk(directory)) {
        for (Path file : files.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(file);
      }
    }
  }
}
