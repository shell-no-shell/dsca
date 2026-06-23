use crate::lexer::Lexer;
use crate::parser::Parser;
use crate::ast::*;

fn parse_expr(input: &str) -> Expr {
    let mut lex = Lexer::new(input);
    let tokens = lex.tokenize().unwrap();
    let mut parser = Parser::new(tokens);
    parser.parse_expr().unwrap()
}

fn parse_program(input: &str) -> Vec<Stmt> {
    let mut lex = Lexer::new(input);
    let tokens = lex.tokenize().unwrap();
    let mut parser = Parser::new(tokens);
    parser.parse_program().unwrap()
}

#[test]
fn test_parse_integer() {
    let expr = parse_expr("42");
    match expr {
        Expr::IntLit(n, _) => assert_eq!(n, 42),
        _ => panic!("expected IntLit, got {:?}", expr),
    }
}

#[test]
fn test_parse_binary_add() {
    let expr = parse_expr("1 + 2");
    match expr {
        Expr::BinaryOp { op: BinOp::Add, .. } => {}
        _ => panic!("expected Add, got {:?}", expr),
    }
}

#[test]
fn test_parse_precedence_mul_over_add() {
    // 1 + 2 * 3 should parse as 1 + (2 * 3)
    let expr = parse_expr("1 + 2 * 3");
    match expr {
        Expr::BinaryOp { op: BinOp::Add, right, .. } => {
            match *right {
                Expr::BinaryOp { op: BinOp::Mul, .. } => {}
                _ => panic!("right should be Mul, got {:?}", right),
            }
        }
        _ => panic!("expected Add at top, got {:?}", expr),
    }
}

#[test]
fn test_parse_precedence_comparison() {
    // 1 + 2 < 3 + 4 should parse as (1+2) < (3+4)
    let expr = parse_expr("1 + 2 < 3 + 4");
    match expr {
        Expr::BinaryOp { op: BinOp::Lt, .. } => {}
        _ => panic!("expected Lt at top, got {:?}", expr),
    }
}

// BUG TEST: && should have higher precedence than ||
#[test]
fn test_parse_precedence_and_over_or() {
    // a || b && c should parse as a || (b && c)
    // NOT (a || b) && c
    let expr = parse_expr("a || b && c");
    match &expr {
        Expr::BinaryOp { op: BinOp::Or, right, .. } => {
            match right.as_ref() {
                Expr::BinaryOp { op: BinOp::And, .. } => {} // correct
                _ => panic!("expected && on right side of ||, got {:?}", right),
            }
        }
        _ => panic!("expected || at top level, got {:?}", expr),
    }
}

// BUG TEST: Mixed && and || precedence
#[test]
fn test_parse_precedence_complex_logical() {
    // a && b || c && d should parse as (a && b) || (c && d)
    let expr = parse_expr("a && b || c && d");
    match &expr {
        Expr::BinaryOp { op: BinOp::Or, left, right, .. } => {
            match (left.as_ref(), right.as_ref()) {
                (Expr::BinaryOp { op: BinOp::And, .. }, Expr::BinaryOp { op: BinOp::And, .. }) => {}
                _ => panic!("expected && on both sides of ||"),
            }
        }
        _ => panic!("expected || at top level, got {:?}", expr),
    }
}

#[test]
fn test_parse_unary_neg() {
    let expr = parse_expr("-42");
    match expr {
        Expr::UnaryOp { op: UnaryOp::Neg, .. } => {}
        _ => panic!("expected UnaryNeg, got {:?}", expr),
    }
}

#[test]
fn test_parse_unary_not() {
    let expr = parse_expr("!true");
    match expr {
        Expr::UnaryOp { op: UnaryOp::Not, .. } => {}
        _ => panic!("expected UnaryNot, got {:?}", expr),
    }
}

#[test]
fn test_parse_function_call() {
    let expr = parse_expr("foo(1, 2, 3)");
    match expr {
        Expr::Call { callee, args, .. } => {
            match *callee {
                Expr::Ident(name, _) => assert_eq!(name, "foo"),
                _ => panic!("expected Ident callee"),
            }
            assert_eq!(args.len(), 3);
        }
        _ => panic!("expected Call, got {:?}", expr),
    }
}

#[test]
fn test_parse_array_literal() {
    let expr = parse_expr("[1, 2, 3]");
    match expr {
        Expr::Array(elements, _) => assert_eq!(elements.len(), 3),
        _ => panic!("expected Array, got {:?}", expr),
    }
}

#[test]
fn test_parse_array_index() {
    let expr = parse_expr("arr[0]");
    match expr {
        Expr::Index { .. } => {}
        _ => panic!("expected Index, got {:?}", expr),
    }
}

#[test]
fn test_parse_if_expression() {
    let expr = parse_expr("if true { 1 } else { 2 }");
    match expr {
        Expr::If { else_branch: Some(_), .. } => {}
        _ => panic!("expected If with else, got {:?}", expr),
    }
}

#[test]
fn test_parse_if_no_else() {
    let expr = parse_expr("if x > 0 { x }");
    match expr {
        Expr::If { else_branch: None, .. } => {}
        _ => panic!("expected If without else, got {:?}", expr),
    }
}

#[test]
fn test_parse_nested_if_else() {
    let expr = parse_expr("if a { 1 } else if b { 2 } else { 3 }");
    match expr {
        Expr::If { else_branch: Some(else_expr), .. } => {
            match *else_expr {
                Expr::If { else_branch: Some(_), .. } => {}
                _ => panic!("expected nested If in else"),
            }
        }
        _ => panic!("expected If with else if"),
    }
}

#[test]
fn test_parse_let_statement() {
    let stmts = parse_program("let x = 42;");
    assert_eq!(stmts.len(), 1);
    match &stmts[0] {
        Stmt::Let { name, type_ann: None, .. } => assert_eq!(name, "x"),
        _ => panic!("expected Let, got {:?}", stmts[0]),
    }
}

#[test]
fn test_parse_let_with_type() {
    let stmts = parse_program("let x: int = 42;");
    assert_eq!(stmts.len(), 1);
    match &stmts[0] {
        Stmt::Let { name, type_ann: Some(Type::Int), .. } => assert_eq!(name, "x"),
        _ => panic!("expected Let with int type, got {:?}", stmts[0]),
    }
}

#[test]
fn test_parse_function_def() {
    let stmts = parse_program("fn add(a: int, b: int) -> int { a + b }");
    assert_eq!(stmts.len(), 1);
    match &stmts[0] {
        Stmt::Fn { name, params, return_type: Type::Int, .. } => {
            assert_eq!(name, "add");
            assert_eq!(params.len(), 2);
        }
        _ => panic!("expected Fn, got {:?}", stmts[0]),
    }
}

#[test]
fn test_parse_while_loop() {
    let stmts = parse_program("while x > 0 { x = x - 1; }");
    assert_eq!(stmts.len(), 1);
    match &stmts[0] {
        Stmt::While { .. } => {}
        _ => panic!("expected While, got {:?}", stmts[0]),
    }
}

#[test]
fn test_parse_block_expression() {
    let expr = parse_expr("{ let x = 1; x + 1 }");
    match expr {
        Expr::Block(stmts, Some(_), _) => {
            assert_eq!(stmts.len(), 1);
        }
        _ => panic!("expected Block with final expr, got {:?}", expr),
    }
}

#[test]
fn test_parse_assignment() {
    let expr = parse_expr("x = 42");
    match expr {
        Expr::Assign { name, .. } => assert_eq!(name, "x"),
        _ => panic!("expected Assign, got {:?}", expr),
    }
}

#[test]
fn test_parse_parenthesized() {
    // (1 + 2) * 3 should have Mul at top
    let expr = parse_expr("(1 + 2) * 3");
    match expr {
        Expr::BinaryOp { op: BinOp::Mul, left, .. } => {
            match *left {
                Expr::BinaryOp { op: BinOp::Add, .. } => {}
                _ => panic!("left should be Add"),
            }
        }
        _ => panic!("expected Mul at top"),
    }
}
