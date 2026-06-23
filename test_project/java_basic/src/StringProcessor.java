/**
 * String processing utility - L2 test case.
 * Contains bugs and missing methods.
 */
public class StringProcessor {

    /**
     * Reverse a string.
     * BUG: off-by-one error in loop
     */
    public static String reverse(String s) {
        if (s == null) return null;
        char[] chars = s.toCharArray();
        // BUG: should be i < chars.length / 2, not chars.length
        for (int i = 0; i < chars.length; i++) {
            char temp = chars[i];
            chars[i] = chars[chars.length - 1 - i];
            chars[chars.length - 1 - i] = temp;
        }
        return new String(chars);
    }

    /**
     * Check if a string is a palindrome (case-insensitive).
     * BUG: not case-insensitive
     */
    public static boolean isPalindrome(String s) {
        if (s == null) return false;
        // BUG: missing toLowerCase()
        String cleaned = s.replaceAll("[^a-zA-Z0-9]", "");
        int left = 0, right = cleaned.length() - 1;
        while (left < right) {
            if (cleaned.charAt(left) != cleaned.charAt(right)) {
                return false;
            }
            left++;
            right--;
        }
        return true;
    }

    /**
     * Count word occurrences in text.
     * BUG: case-sensitive comparison when it shouldn't be
     */
    public static int countWord(String text, String word) {
        if (text == null || word == null || word.isEmpty()) return 0;
        String[] words = text.split("\\s+");
        int count = 0;
        for (String w : words) {
            // BUG: should use equalsIgnoreCase
            if (w.equals(word)) {
                count++;
            }
        }
        return count;
    }

    // TODO: implement capitalize(String s) - capitalize first letter of each word
    // TODO: implement truncate(String s, int maxLen) - truncate with "..." if exceeds maxLen
    // TODO: implement countVowels(String s) - count vowels (a,e,i,o,u)
    // TODO: implement compress(String s) - "aaabbc" -> "a3b2c1"
    // TODO: implement isAnagram(String a, String b) - check if two strings are anagrams

    public static void main(String[] args) {
        // Quick smoke test
        System.out.println("reverse('hello'): " + reverse("hello"));
        System.out.println("isPalindrome('Racecar'): " + isPalindrome("Racecar"));
        System.out.println("countWord('the cat the', 'the'): " + countWord("the cat the", "the"));
    }
}
