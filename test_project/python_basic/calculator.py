"""
Python Basic Calculator - L1/L2 test case for dsca.
Contains intentional bugs and missing features.
"""

def add(a, b):
    return a + b

def subtract(a, b):
    return a - b

def divide(a, b):
    return a / b

def power(base, exp):
    if exp < 0:
        return 1 / power(base, -exp)
    result = 1
    for _ in range(exp):
        result *= base
    return result


class Calculator:
    def __init__(self):
        self.history = []
        self.result = 0

    def add(self, value):
        self.result += value
        self.history.append(('add', value))
        return self.result

    def subtract(self, value):
        self.result -= value
        self.history.append(('subtract', value))
        return self.result

    # BUG: undo pops but doesn't return the entry
    def undo(self):
        if not self.history:
            return None
        entry = self.history.pop()
        if len(entry) == 3:
            # Entry from calculate() - 3-tuple (op, b, a)
            op, b, a = entry
            self.result = a
        else:
            # Entry from instance methods - 2-tuple (op, value)
            op, value = entry
            if op == 'add':
                self.result -= value
            elif op == 'subtract':
                self.result += value
            elif op == 'multiply':
                self.result /= value
            elif op == 'modulo':
                self._replay_from_scratch()
        return entry

    def reset(self):
        self.result = 0
        self.history = []

    def calculate(self, operation, a, b=None):
        """Perform a calculation and record it in history.
        Sets result to a <op> b, then records the operation.
        """
        if operation == 'add':
            self.result = a + b
            self.history.append(('add', b, a))
        elif operation == 'subtract':
            self.result = a - b
            self.history.append(('subtract', b, a))
        elif operation == 'multiply':
            self.result = a * b
            self.history.append(('multiply', b, a))
        elif operation == 'divide':
            self.result = a / b
            self.history.append(('divide', b, a))
        return self.result

    def multiply(self, value):
        """Multiply current result by value."""
        self.result *= value
        self.history.append(('multiply', value))
        return self.result

    def modulo(self, value):
        """Compute current result modulo value. Raises ZeroDivisionError if value is 0."""
        if value == 0:
            raise ZeroDivisionError("modulo by zero")
        self.result %= value
        self.history.append(('modulo', value))
        return self.result

    def square_root(self):
        """Return square root of current result. Raises ValueError if negative."""
        if self.result < 0:
            raise ValueError("Cannot compute square root of negative number")
        import math
        self.result = math.sqrt(self.result)
        self.history.append(('square_root', None))
        return self.result

    def gcd(self, a, b):
        """Compute greatest common divisor using Euclidean algorithm."""
        a, b = abs(a), abs(b)
        while b:
            a, b = b, a % b
        return a

    def get_history(self):
        """Return formatted history list like ['add 5', 'subtract 3']."""
        formatted = []
        for entry in self.history:
            op = entry[0]
            if len(entry) == 3:
                # Entry from calculate() - (op, b, a)
                _, b, a = entry
                formatted.append(f"{op} {a} {b}")
            else:
                # Entry from instance methods - (op, value)
                value = entry[1]
                if value is None:
                    formatted.append(f"{op}")
                else:
                    formatted.append(f"{op} {value}")
        return formatted

    def clear_history(self):
        """Clear history but keep current result."""
        self.history = []

    def _replay_from_scratch(self):
        """Replay all history operations from scratch to reconstruct result."""
        saved_history = list(self.history)
        self.result = 0
        for entry in saved_history:
            op = entry[0]
            if len(entry) == 3:
                # Entry from calculate() - (op, b, a)
                _, b, a = entry
                if op == 'add':
                    self.result = a + b
                elif op == 'subtract':
                    self.result = a - b
                elif op == 'multiply':
                    self.result = a * b
                elif op == 'divide':
                    self.result = a / b
            else:
                value = entry[1]
                if op == 'add':
                    self.result += value
                elif op == 'subtract':
                    self.result -= value
                elif op == 'multiply':
                    self.result *= value
                elif op == 'modulo':
                    if value != 0:
                        self.result %= value
                elif op == 'square_root':
                    import math
                    if self.result >= 0:
                        self.result = math.sqrt(self.result)

    def replay(self):
        """Replay all history operations from scratch and return the final result."""
        saved_history = list(self.history)
        self.result = 0
        self.history = []
        for entry in saved_history:
            op = entry[0]
            if len(entry) == 3:
                # Entry from calculate() - replay via calculate
                _, b, a = entry
                self.calculate(op, a, b)
            else:
                value = entry[1]
                if op == 'add':
                    self.add(value)
                elif op == 'subtract':
                    self.subtract(value)
                elif op == 'multiply':
                    self.multiply(value)
                elif op == 'modulo':
                    self.modulo(value)
                elif op == 'square_root':
                    self.square_root()
        return self.result
