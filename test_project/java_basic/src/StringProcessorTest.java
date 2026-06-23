/**
 * Tests for StringProcessor - designed to expose bugs.
 * Run with: javac src/*.java && java -ea StringProcessorTest
 */
public class StringProcessorTest {

    static int passed = 0;
    static int failed = 0;

    static void assertEquals(Object expected, Object actual, String testName) {
        if (expected == null && actual == null || expected != null && expected.equals(actual)) {
            passed++;
            System.out.println("  PASS: " + testName);
        } else {
            failed++;
            System.out.println("  FAIL: " + testName + " - expected " + expected + ", got " + actual);
        }
    }

    static void assertTrue(boolean condition, String testName) {
        if (condition) {
            passed++;
            System.out.println("  PASS: " + testName);
        } else {
            failed++;
            System.out.println("  FAIL: " + testName);
        }
    }

    static void assertFalse(boolean condition, String testName) {
        assertTrue(!condition, testName);
    }

    public static void main(String[] args) {
        System.out.println("=== StringProcessor Tests ===\n");

        // reverse tests
        System.out.println("reverse():");
        assertEquals("olleh", StringProcessor.reverse("hello"), "reverse basic");
        assertEquals("a", StringProcessor.reverse("a"), "reverse single char");
        assertEquals("", StringProcessor.reverse(""), "reverse empty");
        assertEquals(null, StringProcessor.reverse(null), "reverse null");

        // isPalindrome tests - WILL FAIL: not case-insensitive
        System.out.println("\nisPalindrome():");
        assertTrue(StringProcessor.isPalindrome("racecar"), "palindrome lowercase");
        assertTrue(StringProcessor.isPalindrome("Racecar"), "palindrome mixed case"); // BUG: fails
        assertTrue(StringProcessor.isPalindrome("A man a plan a canal Panama"), "palindrome with spaces"); // BUG: fails
        assertFalse(StringProcessor.isPalindrome("hello"), "not palindrome");

        // countWord tests - WILL FAIL: case-sensitive
        System.out.println("\ncountWord():");
        assertEquals(2, StringProcessor.countWord("the cat and the dog", "the"), "count basic");
        assertEquals(2, StringProcessor.countWord("The cat and the dog", "the"), "count case insensitive"); // BUG: fails
        assertEquals(0, StringProcessor.countWord("hello world", "foo"), "count not found");

        System.out.println("\n=== Results: " + passed + " passed, " + failed + " failed ===");
        if (failed > 0) {
            System.exit(1);
        }
    }
}
