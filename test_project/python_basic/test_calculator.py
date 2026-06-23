"""
Unit tests for calculator - some tests intentionally FAIL to test dsca's fix ability.
"""
import unittest
from calculator import add, subtract, divide, power, Calculator


class TestBasicOps(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(2, 3), 5)
        self.assertEqual(add(-1, 1), 0)

    def test_subtract(self):
        self.assertEqual(subtract(5, 3), 2)

    def test_divide_float(self):
        self.assertEqual(divide(7, 2), 3.5)

    def test_divide_by_zero(self):
        with self.assertRaises(ZeroDivisionError):
            divide(5, 0)

    def test_power_negative(self):
        self.assertAlmostEqual(power(2, -1), 0.5)


class TestCalculator(unittest.TestCase):
    def setUp(self):
        self.calc = Calculator()

    def test_calculate_add(self):
        result = self.calc.calculate("add", 3, 4)
        self.assertEqual(result, 7)

    def test_history_recorded(self):
        self.calc.calculate("add", 1, 2)
        self.assertEqual(len(self.calc.history), 1)

    def test_undo_returns_entry(self):
        self.calc.calculate("add", 1, 2)
        entry = self.calc.undo()
        self.assertIsNotNone(entry)


class TestCalculatorMultiply(unittest.TestCase):
    def setUp(self):
        self.calc = Calculator()
        self.calc.result = 10

    def test_multiply_positive(self):
        result = self.calc.multiply(5)
        self.assertEqual(result, 50)
        self.assertEqual(self.calc.result, 50)

    def test_multiply_negative(self):
        result = self.calc.multiply(-3)
        self.assertEqual(result, -30)
        self.assertEqual(self.calc.result, -30)

    def test_multiply_zero(self):
        result = self.calc.multiply(0)
        self.assertEqual(result, 0)
        self.assertEqual(self.calc.result, 0)

    def test_multiply_history_recorded(self):
        self.calc.multiply(4)
        self.assertEqual(len(self.calc.history), 1)
        self.assertEqual(self.calc.history[0], ('multiply', 4))


class TestCalculatorModulo(unittest.TestCase):
    def setUp(self):
        self.calc = Calculator()
        self.calc.result = 17

    def test_modulo_positive(self):
        result = self.calc.modulo(5)
        self.assertEqual(result, 2)
        self.assertEqual(self.calc.result, 2)

    def test_modulo_larger_divisor(self):
        self.calc.result = 3
        result = self.calc.modulo(10)
        self.assertEqual(result, 3)

    def test_modulo_by_zero(self):
        with self.assertRaises(ZeroDivisionError):
            self.calc.modulo(0)

    def test_modulo_history_recorded(self):
        self.calc.modulo(5)
        self.assertEqual(self.calc.history[0], ('modulo', 5))


class TestCalculatorSquareRoot(unittest.TestCase):
    def setUp(self):
        self.calc = Calculator()

    def test_square_root_perfect_square(self):
        self.calc.result = 25
        result = self.calc.square_root()
        self.assertEqual(result, 5.0)

    def test_square_root_non_perfect(self):
        self.calc.result = 2
        result = self.calc.square_root()
        self.assertAlmostEqual(result, 1.41421356, places=5)

    def test_square_root_zero(self):
        self.calc.result = 0
        result = self.calc.square_root()
        self.assertEqual(result, 0.0)

    def test_square_root_negative_raises_error(self):
        self.calc.result = -9
        with self.assertRaises(ValueError):
            self.calc.square_root()

    def test_square_root_history_recorded(self):
        self.calc.result = 16
        self.calc.square_root()
        self.assertEqual(self.calc.history[0], ('square_root', None))


class TestCalculatorGCD(unittest.TestCase):
    def test_gcd_positive_numbers(self):
        self.assertEqual(Calculator().gcd(12, 8), 4)

    def test_gcd_coprime(self):
        self.assertEqual(Calculator().gcd(7, 13), 1)

    def test_gcd_with_zero(self):
        self.assertEqual(Calculator().gcd(0, 5), 5)
        self.assertEqual(Calculator().gcd(5, 0), 5)

    def test_gcd_negative_numbers(self):
        self.assertEqual(Calculator().gcd(-12, 8), 4)
        self.assertEqual(Calculator().gcd(12, -8), 4)
        self.assertEqual(Calculator().gcd(-12, -8), 4)

    def test_gcd_same_numbers(self):
        self.assertEqual(Calculator().gcd(7, 7), 7)


class TestCalculatorGetHistory(unittest.TestCase):
    def setUp(self):
        self.calc = Calculator()

    def test_get_history_empty(self):
        self.assertEqual(self.calc.get_history(), [])

    def test_get_history_single_entry(self):
        self.calc.add(5)
        self.assertEqual(self.calc.get_history(), ["add 5"])

    def test_get_history_multiple_entries(self):
        self.calc.add(10)
        self.calc.subtract(3)
        self.calc.multiply(2)
        self.assertEqual(self.calc.get_history(), ["add 10", "subtract 3", "multiply 2"])

    def test_get_history_with_square_root(self):
        self.calc.add(9)
        self.calc.square_root()
        self.assertEqual(self.calc.get_history(), ["add 9", "square_root"])


class TestCalculatorClearHistory(unittest.TestCase):
    def setUp(self):
        self.calc = Calculator()

    def test_clear_history_removes_entries(self):
        self.calc.add(5)
        self.calc.subtract(2)
        self.calc.clear_history()
        self.assertEqual(self.calc.history, [])

    def test_clear_history_preserves_result(self):
        self.calc.add(10)
        self.calc.subtract(3)
        self.calc.clear_history()
        self.assertEqual(self.calc.result, 7)

    def test_clear_history_empty(self):
        self.calc.clear_history()
        self.assertEqual(self.calc.history, [])


class TestCalculatorReplay(unittest.TestCase):
    def setUp(self):
        self.calc = Calculator()

    def test_replay_empty_history(self):
        result = self.calc.replay()
        self.assertEqual(result, 0)

    def test_replay_single_operation(self):
        self.calc.add(5)
        result = self.calc.replay()
        self.assertEqual(result, 5)

    def test_replay_multiple_operations(self):
        self.calc.add(10)
        self.calc.subtract(3)
        self.calc.multiply(2)
        result = self.calc.replay()
        self.assertEqual(result, 14)

    def test_replay_resets_result_and_history(self):
        self.calc.add(5)
        self.calc.add(3)
        self.calc.replay()
        # After replay, history should be repopulated
        self.assertEqual(len(self.calc.history), 2)
        self.assertEqual(self.calc.result, 8)

    def test_replay_with_modulo(self):
        self.calc.add(17)
        self.calc.modulo(5)
        result = self.calc.replay()
        self.assertEqual(result, 2)


if __name__ == "__main__":
    unittest.main()
