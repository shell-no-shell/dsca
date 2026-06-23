use crate::lexer::{Lexer, Token};

fn tokenize(input: &str) -> Vec<Token> {
    let mut lex = Lexer::new(input);
    lex.tokenize()
        .unwrap()
        .into_iter()
        .map(|t| t.token)
        .filter(|t| *t != Token::Eof)
        .collect()
}

#[test]
fn test_integer_literal() {
    let tokens = tokenize("42");
    assert_eq!(tokens, vec![Token::Int(42)]);
}

#[test]
fn test_float_literal() {
    let tokens = tokenize("3.14");
    assert_eq!(tokens, vec![Token::Float(3.14)]);
}

#[test]
fn test_string_basic() {
    let tokens = tokenize(r#""hello world""#);
    assert_eq!(tokens, vec![Token::Str("hello world".to_string())]);
}

#[test]
fn test_string_escape_newline() {
    let tokens = tokenize(r#""hello\nworld""#);
    assert_eq!(tokens, vec![Token::Str("hello\nworld".to_string())]);
}

#[test]
fn test_string_escape_tab() {
    let tokens = tokenize(r#""col1\tcol2""#);
    assert_eq!(tokens, vec![Token::Str("col1\tcol2".to_string())]);
}

#[test]
fn test_string_escape_backslash() {
    let tokens = tokenize(r#""path\\file""#);
    assert_eq!(tokens, vec![Token::Str("path\\file".to_string())]);
}

#[test]
fn test_string_escape_quote() {
    let tokens = tokenize(r#""say \"hi\"""#);
    assert_eq!(tokens, vec![Token::Str("say \"hi\"".to_string())]);
}

// BUG TEST: \r escape is not handled
#[test]
fn test_string_escape_carriage_return() {
    let tokens = tokenize(r#""line\r\n""#);
    assert_eq!(tokens, vec![Token::Str("line\r\n".to_string())]);
}

// BUG TEST: Unknown escape should error
#[test]
fn test_string_unknown_escape_errors() {
    let mut lex = Lexer::new(r#""bad\qescape""#);
    let result = lex.tokenize();
    assert!(result.is_err(), "unknown escape \\q should produce an error");
}

#[test]
fn test_unterminated_string() {
    let mut lex = Lexer::new(r#""unterminated"#);
    let result = lex.tokenize();
    assert!(result.is_err());
}

#[test]
fn test_keywords() {
    let tokens = tokenize("let fn if else while return print true false");
    assert_eq!(tokens, vec![
        Token::Let, Token::Fn, Token::If, Token::Else,
        Token::While, Token::Return, Token::Print,
        Token::Bool(true), Token::Bool(false),
    ]);
}

#[test]
fn test_operators() {
    let tokens = tokenize("+ - * / % == != < > <= >= && || !");
    assert_eq!(tokens, vec![
        Token::Plus, Token::Minus, Token::Star, Token::Slash, Token::Percent,
        Token::Eq, Token::Ne, Token::Lt, Token::Gt, Token::Le, Token::Ge,
        Token::And, Token::Or, Token::Not,
    ]);
}

#[test]
fn test_arrow() {
    let tokens = tokenize("->");
    assert_eq!(tokens, vec![Token::Arrow]);
}

#[test]
fn test_delimiters() {
    let tokens = tokenize("( ) { } [ ] , ; : =");
    assert_eq!(tokens, vec![
        Token::LParen, Token::RParen, Token::LBrace, Token::RBrace,
        Token::LBracket, Token::RBracket, Token::Comma, Token::Semicolon,
        Token::Colon, Token::Assign,
    ]);
}

#[test]
fn test_line_comment() {
    let tokens = tokenize("42 // this is a comment\n43");
    assert_eq!(tokens, vec![Token::Int(42), Token::Int(43)]);
}

// BUG TEST: "123." should not be parsed as valid float
#[test]
fn test_number_with_trailing_dot() {
    // "123." followed by non-digit should NOT be a float
    // It should be Int(123) followed by whatever comes after
    let mut lex = Lexer::new("123.abc");
    let result = lex.tokenize();
    // The lexer currently tries to parse "123." as a float, which may fail
    // or produce an incorrect result
    assert!(result.is_err() || {
        let tokens: Vec<Token> = result.unwrap().into_iter().map(|t| t.token).collect();
        // Should NOT produce a Float token for "123."
        !matches!(tokens.first(), Some(Token::Float(_)))
    });
}
