use crate::lexer::Lexer;
use crate::parser::Parser;
use crate::typechecker::TypeChecker;

fn check(input: &str) -> Result<(), Vec<String>> {
    let mut lex = Lexer::new(input);
    let tokens = lex.tokenize().unwrap();
    let mut parser = Parser::new(tokens);
    let program = parser.parse_program().unwrap();
    let mut checker = TypeChecker::new();
    checker.check_program(&program)
}

fn check_ok(input: &str) {
    match check(input) {
        Ok(()) => {}
        Err(errors) => panic!("expected ok, got errors: {:?}", errors),
    }
}

fn check_err(input: &str) {
    match check(input) {
        Ok(()) => panic!("expected errors, but type check succeeded"),
        Err(_) => {}
    }
}

#[test]
fn test_let_int() {
    check_ok("let x = 42;");
}

#[test]
fn test_let_with_type_annotation() {
    check_ok("let x: int = 42;");
}

#[test]
fn test_let_type_mismatch() {
    check_err("let x: string = 42;");
}

#[test]
fn test_arithmetic() {
    check_ok("let x = 1 + 2 * 3;");
}

#[test]
fn test_comparison_returns_bool() {
    check_ok("let x: bool = 1 < 2;");
}

#[test]
fn test_undefined_variable() {
    check_err("let x = y;");
}

#[test]
fn test_function_basic() {
    check_ok("fn add(a: int, b: int) -> int { a + b }");
}

// BUG TEST: Function return type should be checked
#[test]
fn test_function_return_type_mismatch() {
    // Function declares int return but body returns string
    check_err(r#"fn bad() -> int { "hello" }"#);
}

// BUG TEST: If/else branch type mismatch with int/float should unify to float
#[test]
fn test_if_else_int_float_unification() {
    // int in then-branch, float in else-branch should be ok (both numeric)
    check_ok("let x = if true { 1 } else { 2.5 };");
}

// BUG TEST: String concatenation with +
#[test]
fn test_string_concatenation() {
    check_ok(r#"let s = "hello" + " world";"#);
}

#[test]
fn test_while_condition_must_be_bool() {
    check_err("while 42 { let x = 1; }");
}

#[test]
fn test_array_type() {
    check_ok("let arr = [1, 2, 3];");
}

#[test]
fn test_array_mixed_types() {
    check_err(r#"let arr = [1, "two", 3];"#);
}

#[test]
fn test_array_index_type() {
    check_ok(r#"
        let arr = [1, 2, 3];
        let x = arr[0];
    "#);
}

#[test]
fn test_nested_scopes() {
    check_ok(r#"
        let x = 1;
        let y = {
            let z = x + 1;
            z * 2
        };
    "#);
}

#[test]
fn test_scope_isolation() {
    // z should not be visible outside the block
    check_err(r#"
        let y = { let z = 1; z };
        let w = z;
    "#);
}

#[test]
fn test_function_call_type_check() {
    check_ok(r#"
        fn double(x: int) -> int { x * 2 }
        let result = double(21);
    "#);
}

#[test]
fn test_function_call_wrong_arg_type() {
    check_err(r#"
        fn double(x: int) -> int { x * 2 }
        let result = double("hello");
    "#);
}

#[test]
fn test_function_call_wrong_arg_count() {
    check_err(r#"
        fn add(a: int, b: int) -> int { a + b }
        let result = add(1);
    "#);
}

#[test]
fn test_logical_operators() {
    check_ok("let x = true && false || true;");
}

#[test]
fn test_logical_with_non_bool() {
    check_err("let x = 1 && 2;");
}

#[test]
fn test_negation() {
    check_ok("let x = -42;");
    check_ok("let y = !true;");
}

#[test]
fn test_negation_type_error() {
    check_err(r#"let x = -"hello";"#);
    check_err("let y = !42;");
}
